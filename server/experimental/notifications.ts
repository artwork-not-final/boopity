import { Hono } from "hono";
import type { SqlDatabase } from "../core/contracts";
import { z } from "zod";
import type { AppEnv, Bindings } from "../core/env";
import {
  deliverEmail,
  EmailDeliveryError,
  type FrozenEmail,
} from "../auth/email";
import { validationMessage } from "../business/domain";
import { emailConfigured } from "../auth/config";

export function notificationsEnabled(env: Bindings) {
  return env.NOTIFICATIONS_ENABLED === "true" && emailConfigured(env);
}
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
export function emailTemplate(
  title: string,
  paragraphs: string[],
  link?: { url: string; label: string },
) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#38243f;padding:28px"><p style="font-weight:bold;color:#725184">boopity</p><h1 style="font-size:24px">${escapeHtml(title)}</h1>${paragraphs.map((p) => `<p style="line-height:1.6">${escapeHtml(p)}</p>`).join("")}${link ? `<p><a href="${escapeHtml(link.url)}" style="color:#725184">${escapeHtml(link.label)}</a></p>` : ""}</div>`;
}

export function bookingNoticeStatement(
  db: SqlDatabase,
  sitter: string,
  booking: string,
  kind: "booking-confirmation" | "booking-cancellation",
  now: number,
) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO notification_outbox (id, sitter_id, booking_id, kind, recipient_role, expires_at, created_at)
    SELECT ?1 || ':' || id, sitter_id, id, ?1, 'client', ?4 + 86400000, ?4 FROM bookings
    WHERE sitter_id = ?2 AND id = ?3 AND status = ?5 AND updated_at = ?4`,
    )
    .bind(
      kind,
      sitter,
      booking,
      now,
      kind === "booking-confirmation" ? "active" : "cancelled",
    );
}

type OutboxRow = {
  id: string;
  sitter_id: string;
  booking_id: string | null;
  kind: string;
  recipient_role: string;
  payload: string | null;
  status: string;
  attempts: number;
  first_attempt_at: number | null;
  expires_at: number;
  lease_token: string | null;
};

export async function discoverBookingReminders(env: Bindings, now: number) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO notification_outbox (id, sitter_id, booking_id, kind, recipient_role, expires_at, created_at)
    SELECT 'booking-reminder:' || b.id || ':' || b.start_at || ':' || role.value, b.sitter_id, b.id,
      'booking-reminder', role.value, b.start_at, ?1
    FROM bookings b CROSS JOIN json_each('["client","sitter"]') role
    WHERE b.status = 'active' AND b.reminder_sent_at IS NULL AND b.start_at > ?1 AND b.start_at <= ?2
      AND NOT EXISTS (SELECT 1 FROM notification_outbox o WHERE o.id = 'booking-reminder:' || b.id || ':' || b.start_at || ':' || role.value)
    ORDER BY b.start_at, b.id LIMIT 20`,
  )
    .bind(now, now + 86_400_000)
    .run();
}

async function prepareBookingEmail(
  env: Bindings,
  row: OutboxRow,
  now: number,
): Promise<FrozenEmail | string> {
  const booking = await env.DB.prepare(
    `SELECT b.status, b.service_name AS service, b.start_at AS startAt, b.end_at AS endAt,
    b.start_date AS startDate, b.end_date AS endDate, b.start_time AS startTime, b.recurrence_rule AS recurrenceRule,
    s.business_name AS business, s.time_zone AS zone, u.email AS sitterEmail,
    c.email AS clientEmail, c.first_name || ' ' || c.last_name AS clientName
    FROM bookings b JOIN sitter_profiles s ON s.id = b.sitter_id JOIN user u ON u.id = s.user_id
    JOIN clients c ON c.id = b.client_id WHERE b.id = ?1 AND b.sitter_id = ?2`,
  )
    .bind(row.booking_id, row.sitter_id)
    .first<{
      status: string;
      service: string;
      startAt: number;
      endAt: number;
      startDate: string;
      endDate: string;
      startTime: string | null;
      recurrenceRule: string | null;
      business: string;
      zone: string;
      sitterEmail: string;
      clientEmail: string;
      clientName: string;
    }>();
  if (!booking) return "Booking no longer exists";
  if (
    row.kind === "booking-cancellation"
      ? booking.status !== "cancelled"
      : booking.status !== "active"
  )
    return "Booking status changed";
  if (row.kind !== "booking-cancellation" && booking.startAt <= now)
    return "Visit has already started";
  const recipient =
    row.recipient_role === "sitter" ? booking.sitterEmail : booking.clientEmail;
  if (!recipient) return "No recipient email address";
  if (row.payload) {
    const frozen = JSON.parse(row.payload) as FrozenEmail;
    return frozen.to === recipient
      ? frozen
      : "Recipient address changed after delivery started";
  }
  const pets = await env.DB.prepare(
    `SELECT p.name FROM booking_pets bp JOIN pets p ON p.id = bp.pet_id WHERE bp.booking_id = ?1 ORDER BY p.name`,
  )
    .bind(row.booking_id)
    .all<{ name: string }>();
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: booking.zone,
    dateStyle: "full",
    ...(booking.startTime ? { timeStyle: "short" as const } : {}),
  });
  const date =
    format.format(booking.startAt) +
    (booking.endDate !== booking.startDate
      ? ` – ${format.format(booking.endAt)}`
      : "") +
    ` (${booking.zone})`;
  const title =
    row.kind === "booking-reminder"
      ? "Your upcoming visit"
      : row.kind === "booking-cancellation"
        ? "Visit cancelled"
        : "Visit scheduled";
  const paragraphs = [
    `${booking.business}: ${booking.service}${booking.recurrenceRule && row.kind !== "booking-reminder" ? " (recurring series)" : ""}`,
    `When: ${date}`,
    ...(row.recipient_role === "sitter"
      ? [`Client: ${booking.clientName}`]
      : []),
    ...(pets.results.length
      ? [`Pets: ${pets.results.map((pet) => pet.name).join(", ")}`]
      : []),
  ];
  return {
    from: env.EMAIL_FROM,
    to: recipient,
    subject: `${title} — ${booking.service}`,
    html: emailTemplate(
      title,
      paragraphs,
      row.recipient_role === "sitter"
        ? {
            url: `${env.APP_URL}/app/sitter/bookings/${row.booking_id}`,
            label: "Open booking",
          }
        : undefined,
    ),
  };
}

async function stillRelevant(
  env: Bindings,
  row: OutboxRow,
  now: number,
): Promise<FrozenEmail | string> {
  if (row.booking_id) return prepareBookingEmail(env, row, now);
  if (!row.payload) return "Notification details are missing";
  const payload = JSON.parse(row.payload) as FrozenEmail;
  const user = await env.DB.prepare(
    `SELECT u.email FROM sitter_profiles s JOIN user u ON u.id = s.user_id WHERE s.id = ?1`,
  )
    .bind(row.sitter_id)
    .first<{ email: string }>();
  if (user?.email !== payload.to) return "Recipient address changed";
  if (
    [
      "subscription-welcome",
      "subscription-ended",
      "subscription-cancellation",
    ].includes(row.kind)
  ) {
    const billing = await env.DB.prepare(
      "SELECT subscription_id, status, current_period_end, cancel_at_period_end, cancel_at FROM billing_accounts WHERE sitter_id = ?1",
    )
      .bind(row.sitter_id)
      .first<{
        subscription_id: string | null;
        status: string;
        current_period_end: number | null;
        cancel_at_period_end: number;
        cancel_at: number | null;
      }>();
    const active = billing && ["active", "trialing"].includes(billing.status);
    if (
      (row.kind === "subscription-welcome" &&
        (!active ||
          row.id !== `subscription-welcome:${billing.subscription_id}`)) ||
      (row.kind === "subscription-ended" &&
        billing?.subscription_id &&
        (!["canceled", "incomplete_expired"].includes(billing.status) ||
          row.id !== `subscription-ended:${billing.subscription_id}`)) ||
      (row.kind === "subscription-cancellation" &&
        (!active ||
          (!billing.cancel_at && !billing.cancel_at_period_end) ||
          row.id !==
            `subscription-cancellation:${billing.subscription_id}:${billing.cancel_at ?? billing.current_period_end}`))
    )
      return "Subscription state changed";
  }
  if (row.kind === "invoice-failed") {
    const invoice = await env.DB.prepare(
      "SELECT status FROM stripe_invoices WHERE id = ?1 AND sitter_id = ?2",
    )
      .bind(row.id.split(":")[1], row.sitter_id)
      .first<{ status: string }>();
    if (invoice?.status !== "open") return "Invoice no longer needs payment";
  }
  if (row.kind === "subscription-renewal") {
    const billing = await env.DB.prepare(
      `SELECT subscription_id, current_period_end, cancel_at_period_end, cancel_at, status FROM billing_accounts WHERE sitter_id = ?1`,
    )
      .bind(row.sitter_id)
      .first<{
        subscription_id: string;
        current_period_end: number;
        cancel_at_period_end: number;
        cancel_at: number | null;
        status: string;
      }>();
    if (
      !billing ||
      !["active", "trialing"].includes(billing.status) ||
      billing.cancel_at_period_end ||
      billing.cancel_at ||
      billing.current_period_end <= now ||
      row.id !==
        `subscription-renewal:${billing.subscription_id}:${billing.current_period_end}`
    )
      return "Subscription renewal changed";
  }
  return payload;
}

function markReminderComplete(
  db: SqlDatabase,
  bookingId: string | null,
  now: number,
) {
  return db
    .prepare(
      `UPDATE bookings SET reminder_sent_at = ?2 WHERE id = ?1 AND status = 'active'
    AND (SELECT COUNT(*) FROM notification_outbox WHERE booking_id = ?1 AND kind = 'booking-reminder') >= 2
    AND EXISTS (SELECT 1 FROM notification_outbox WHERE booking_id = ?1 AND kind = 'booking-reminder' AND status = 'sent')
    AND NOT EXISTS (SELECT 1 FROM notification_outbox WHERE booking_id = ?1 AND kind = 'booking-reminder' AND status NOT IN ('sent','skipped'))`,
    )
    .bind(bookingId, now);
}

export async function processNotifications(env: Bindings, now = Date.now()) {
  // Never retry an ambiguous send beyond the provider's 24-hour idempotency window.
  await env.DB.prepare(
    `UPDATE notification_outbox SET status = CASE WHEN first_attempt_at IS NULL THEN 'expired' ELSE 'needs_review' END,
    last_error = CASE WHEN first_attempt_at IS NULL THEN 'Notification window ended' ELSE 'Delivery confirmation window ended; inspect the provider before resending' END,
    lease_token = NULL, lease_until = 0 WHERE status IN ('pending','sending') AND lease_until <= ?1
    AND (expires_at <= ?1 OR (first_attempt_at IS NOT NULL AND first_attempt_at < ?2))`,
  )
    .bind(now, now - 23 * 3_600_000)
    .run();
  if (!notificationsEnabled(env))
    return { enabled: false, accepted: 0, failed: 0 };
  if (env.MAIL_TRANSPORT && !env.MAIL_TRANSPORT.idempotent) {
    // SMTP can accept a message just before the process dies. An expired lease with a
    // recorded attempt is ambiguous, not permission to send that message again.
    await env.DB.prepare(
      `UPDATE notification_outbox SET status = 'needs_review', lease_token = NULL,
      lease_until = 0, last_error = 'Inspect SMTP delivery before resending' WHERE status IN ('pending','sending')
      AND attempts > 0 AND lease_until <= ?1`,
    )
      .bind(now)
      .run();
  }
  const candidates = await env.DB.prepare(
    `SELECT id FROM notification_outbox WHERE status IN ('pending','sending')
    AND next_attempt_at <= ?1 AND lease_until <= ?1 AND expires_at > ?1 ORDER BY next_attempt_at, created_at, id LIMIT 5`,
  )
    .bind(now)
    .all<{ id: string }>();
  let accepted = 0,
    failed = 0;
  for (const candidate of candidates.results) {
    const token = crypto.randomUUID();
    const claimed = await env.DB.prepare(
      `UPDATE notification_outbox SET status = 'sending', lease_token = ?2, lease_until = ?3
      WHERE id = ?1 AND status IN ('pending','sending') AND lease_until <= ?4 AND next_attempt_at <= ?4`,
    )
      .bind(candidate.id, token, now + 120_000, now)
      .run();
    if (!claimed.meta.changes) continue;
    const row = await env.DB.prepare(
      "SELECT * FROM notification_outbox WHERE id = ?1 AND lease_token = ?2",
    )
      .bind(candidate.id, token)
      .first<OutboxRow>();
    try {
      if (row!.attempts >= 6) {
        await env.DB.prepare(
          "UPDATE notification_outbox SET status = 'needs_review', last_error = 'Retry limit reached; inspect email provider', lease_until = 0, lease_token = NULL WHERE id = ?1 AND lease_token = ?2",
        )
          .bind(candidate.id, token)
          .run();
        failed++;
        continue;
      }
      const message = await stillRelevant(env, row!, now);
      if (typeof message === "string") {
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE notification_outbox SET status = 'skipped', last_error = ?3, lease_until = 0, lease_token = NULL WHERE id = ?1 AND lease_token = ?2",
          ).bind(candidate.id, token, message),
          markReminderComplete(env.DB, row!.booking_id, now),
        ]);
        continue;
      }
      const frozen = await env.DB.prepare(
        `UPDATE notification_outbox SET payload = ?3, attempts = attempts + 1,
        first_attempt_at = COALESCE(first_attempt_at, ?4) WHERE id = ?1 AND lease_token = ?2 AND lease_until > ?4`,
      )
        .bind(candidate.id, token, JSON.stringify(message), now)
        .run();
      if (!frozen.meta.changes) continue;
      const providerId = await deliverEmail(
        env,
        message,
        `boopity/${candidate.id}`,
      );
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE notification_outbox SET status = 'sent', sent_at = ?3, provider_id = ?4, last_error = NULL,
          lease_until = 0, lease_token = NULL WHERE id = ?1 AND lease_token = ?2`,
        ).bind(candidate.id, token, now, providerId),
        markReminderComplete(env.DB, row!.booking_id, now),
      ]);
      accepted++;
    } catch (error) {
      const permanent =
        error instanceof EmailDeliveryError &&
        [400, 401, 403, 404, 422].includes(error.status);
      await env.DB.prepare(
        `UPDATE notification_outbox SET status = ?3, next_attempt_at = ?4, last_error = ?5,
        lease_token = NULL, lease_until = 0 WHERE id = ?1 AND lease_token = ?2`,
      )
        .bind(
          candidate.id,
          token,
          permanent
            ? "failed"
            : env.MAIL_TRANSPORT && !env.MAIL_TRANSPORT.idempotent
              ? "needs_review"
              : "pending",
          now + Math.min(60, 15 * 2 ** (row?.attempts ?? 0)) * 60_000,
          error instanceof EmailDeliveryError
            ? error.message
            : env.MAIL_TRANSPORT && !env.MAIL_TRANSPORT.idempotent
              ? "Inspect SMTP delivery before resending"
              : "Delivery was not confirmed; retry scheduled",
        )
        .run();
      failed++;
    }
  }
  return { enabled: true, accepted, failed };
}

export const notificationsApi = new Hono<AppEnv>();
notificationsApi.get("/", async (c) => {
  const parsed = z
    .object({
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    })
    .safeParse(c.req.query());
  if (!parsed.success)
    return c.json({ error: validationMessage(parsed.error) }, 400);
  const rows = await c.env.DB.prepare(
    `SELECT id, booking_id AS bookingId, kind, recipient_role AS recipientRole, status,
    attempts, last_error AS lastError, created_at AS createdAt, sent_at AS sentAt, next_attempt_at AS nextAttemptAt,
    json_extract(payload, '$.to') AS recipient FROM notification_outbox WHERE sitter_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 51 OFFSET ?2`,
  )
    .bind(c.get("sitterId"), parsed.data.offset)
    .all();
  const summary = await c.env.DB.prepare(
    "SELECT status, COUNT(*) AS count FROM notification_outbox WHERE sitter_id = ?1 GROUP BY status",
  )
    .bind(c.get("sitterId"))
    .all();
  return c.json({
    enabled: notificationsEnabled(c.env),
    notifications: rows.results.slice(0, 50),
    hasMore: rows.results.length > 50,
    summary: summary.results,
  });
});
