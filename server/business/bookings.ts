import { parseInput, readJson } from "../core/http-input";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  bookingRequestSchema,
  calendarDate,
  transitionSchema,
  type BookingPolicy,
} from "../../src/shared/portal";
import { authDigest } from "../auth/policy";
import type { AppEnv } from "../core/env";
import type { SqlDatabase } from "../core/contracts";
import { bookingWindow, readPolicy, type ServiceRate } from "./booking-rules";
import { ownerOnly } from "./access";
import {
  listQuery,
  pageOffset,
  pageInfo,
  PAGE_SIZE,
  searchPattern,
} from "../../src/shared/pagination";

type Row = {
  id: string;
  sitter_id: string;
  client_id: string;
  service_id: string;
  service_name: string;
  status: string;
  start_at: number;
  end_at: number;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  total_amount_cents: number;
  payment_status: string;
  policy_snapshot: string | null;
  price_snapshot: string | null;
  request_expires_at: number | null;
  version: number;
  notes: string;
  post_service_notes: string;
  client_request: string;
  client_update: string;
  request_digest: string;
  created_by: string;
  client_name: string;
};
const select = `SELECT b.*,c.first_name||' '||c.last_name AS client_name FROM bookings b JOIN clients c ON c.id=b.client_id`;
type Ctx = Parameters<typeof ownerOnly>[0];
async function getRow(c: Ctx, id: string) {
  const row = await c.env.DB.prepare(
    `${select} WHERE b.id=?1 AND b.sitter_id=?2 AND (?3=1 OR b.client_id=?4)`,
  )
    .bind(
      id,
      c.get("sitterId"),
      c.get("businessRole") === "owner",
      c.get("clientId"),
    )
    .first<Row>();
  if (!row) throw new HTTPException(404, { message: "Booking not found." });
  return row;
}
async function present(c: Ctx, b: Row, pagePets?: Record<string, unknown>[]) {
  const owner = c.get("businessRole") === "owner";
  const policy = b.policy_snapshot ? JSON.parse(b.policy_snapshot) : null;
  const pets =
    pagePets ??
    (
      await c.env.DB.prepare(
        "SELECT p.id,p.name,p.species FROM booking_pets bp JOIN pets p ON p.id=bp.pet_id WHERE bp.booking_id=?1 AND p.client_id=?2",
      )
        .bind(b.id, b.client_id)
        .all()
    ).results;
  return {
    id: b.id,
    clientId: b.client_id,
    ...(owner
      ? {
          clientName: b.client_name,
          privateNotes: b.notes,
          postServiceNotes: b.post_service_notes,
        }
      : {}),
    serviceName: b.service_name,
    status: b.status,
    startAt: b.start_at,
    endAt: b.end_at,
    startDate: b.start_date,
    endDate: b.end_date,
    startTime: b.start_time,
    endTime: b.end_time,
    totalAmountCents: b.total_amount_cents,
    price: b.price_snapshot ? JSON.parse(b.price_snapshot) : null,
    // Publish only contractual policy fields, not historical scheduling configuration.
    policy: policy
      ? {
          cancelHours: policy.cancelHours,
          timeZone: policy.timeZone,
          approvalMode: policy.approvalMode,
        }
      : null,
    requestExpiresAt: b.request_expires_at,
    version: b.version,
    clientRequest: b.client_request,
    clientUpdate: b.client_update,
    canCancel:
      ["active", "requested"].includes(b.status) &&
      (owner ||
        (Boolean(policy) &&
          Date.now() <= b.start_at - policy.cancelHours * 3_600_000)),
    pets,
  };
}
export async function expireRequests(db: SqlDatabase, now = Date.now()) {
  await db.batch([
    db
      .prepare(
        `INSERT INTO booking_history(id,booking_id,actor_role,event,reason,created_at)
      SELECT lower(hex(randomblob(16))),id,'system','expired','The approval hold expired.',?1 FROM bookings
      WHERE status='requested' AND request_expires_at<=?1`,
      )
      .bind(now),
    db
      .prepare(
        "UPDATE bookings SET status='expired',version=version+1,updated_at=?1 WHERE status='requested' AND request_expires_at<=?1",
      )
      .bind(now),
  ]);
}
export function bookingRoutes() {
  const api = new Hono<AppEnv>();
  api.get("/", async (c) => {
    const input = parseInput(
      listQuery.extend({
        from: calendarDate.optional(),
        to: calendarDate.optional(),
        status: z
          .enum([
            "all",
            "requested",
            "active",
            "completed",
            "cancelled",
            "declined",
            "expired",
          ])
          .default("all"),
      }),
      c.req.query(),
    );
    if (input.from && input.to && input.from > input.to)
      throw new HTTPException(400, {
        message: "End date must follow start date.",
      });
    const rows = await c.env.DB.prepare(
      `${select} WHERE b.sitter_id=?1 AND (?2=1 OR b.client_id=?3)
      AND (?4 IS NULL OR b.end_date>=?4) AND (?5 IS NULL OR b.start_date<=?5)
      AND (?7='all' OR b.status=?7)
      AND (?8='' OR lower(b.service_name) LIKE ?9 ESCAPE '\\'
        OR (?2=1 AND lower(c.first_name||' '||c.last_name) LIKE ?9 ESCAPE '\\')
        OR EXISTS(SELECT 1 FROM booking_pets bp JOIN pets p ON p.id=bp.pet_id WHERE bp.booking_id=b.id AND p.client_id=b.client_id AND lower(p.name) LIKE ?9 ESCAPE '\\'))
      ORDER BY b.start_at DESC,b.id LIMIT ?10 OFFSET ?6`,
    )
      .bind(
        c.get("sitterId"),
        c.get("businessRole") === "owner",
        c.get("clientId"),
        input.from ?? null,
        input.to ?? null,
        input.offset,
        input.status,
        input.search,
        searchPattern(input.search),
        PAGE_SIZE + 1,
      )
      .all<Row>();
    const page = rows.results.slice(0, PAGE_SIZE);
    const pets = page.length
      ? await c.env.DB.prepare(
          `SELECT bp.booking_id AS bookingId,p.id,p.name,p.species
      FROM booking_pets bp JOIN pets p ON p.id=bp.pet_id JOIN bookings b ON b.id=bp.booking_id
      WHERE bp.booking_id IN (${page.map((_, i) => `?${i + 1}`).join(",")}) AND p.client_id=b.client_id ORDER BY p.name,p.id`,
        )
          .bind(...page.map((b) => b.id))
          .all<{
            bookingId: string;
            id: string;
            name: string;
            species: string;
          }>()
      : { results: [] };
    const byBooking = new Map<string, Record<string, unknown>[]>();
    for (const { bookingId, ...pet } of pets.results) {
      const group = byBooking.get(bookingId) ?? [];
      group.push(pet);
      byBooking.set(bookingId, group);
    }
    return c.json({
      bookings: await Promise.all(
        page.map((row) => present(c, row, byBooking.get(row.id) ?? [])),
      ),
      hasMore: rows.results.length > PAGE_SIZE,
      pagination: pageInfo(input.offset, rows.results.length),
    });
  });
  api.get("/:id", async (c) => {
    const offset = parseInput(
      pageOffset,
      c.req.query("historyOffset") ?? c.req.query("offset"),
    );
    const row = await getRow(c, c.req.param("id"));
    const history = await c.env.DB.prepare(
      "SELECT event,actor_role AS actorRole,reason,created_at AS createdAt FROM booking_history WHERE booking_id=?1 ORDER BY created_at,id LIMIT ?2 OFFSET ?3",
    )
      .bind(row.id, PAGE_SIZE + 1, offset)
      .all();
    return c.json({
      booking: await present(c, row),
      history: history.results.slice(0, PAGE_SIZE),
      historyPagination: pageInfo(offset, history.results.length),
      pagination: pageInfo(offset, history.results.length),
    });
  });
  api.post("/", async (c) => {
    const input = parseInput(bookingRequestSchema, await readJson(c.req));
    const isOwner = c.get("businessRole") === "owner";
    const clientId = isOwner ? input.clientId : c.get("clientId");
    if (
      !clientId ||
      (!isOwner && input.clientId && input.clientId !== clientId)
    )
      throw new HTTPException(403, { message: "Choose your own household." });
    const hash = await authDigest(
      c.env.BETTER_AUTH_SECRET,
      `booking:${JSON.stringify({ ...input, clientId })}`,
    );
    const prior = await c.env.DB.prepare(
      "SELECT id,request_digest FROM bookings WHERE created_by=?1 AND request_key=?2",
    )
      .bind(c.get("userId"), input.requestId)
      .first<{ id: string; request_digest: string }>();
    if (prior) {
      if (prior.request_digest !== hash)
        throw new HTTPException(409, {
          message: "This request ID was already used for a different booking.",
        });
      return c.json({
        booking: await present(c, await getRow(c, prior.id)),
        replay: true,
      });
    }
    const policy = await readPolicy(c.env.DB);
    const installation = (await c.env.DB.prepare(
      "SELECT time_zone AS timeZone,currency,version FROM installation WHERE id=1",
    ).first<{ timeZone: string; currency: string; version: number }>())!;
    const service = await c.env.DB.prepare(
      `SELECT id,name,duration_minutes AS durationMinutes,price_cents AS priceCents,additional_pet_price_cents AS additionalPetPriceCents
      FROM services WHERE id=?1 AND sitter_id=?2 AND is_active=1 AND (?3=1 OR portal_visible=1)`,
    )
      .bind(input.serviceId, c.get("sitterId"), isOwner)
      .first<ServiceRate>();
    if (!service)
      throw new HTTPException(400, { message: "Choose an available service." });
    const now = Date.now(),
      window = bookingWindow(
        input,
        service,
        policy,
        installation.timeZone,
        !isOwner,
        now,
      );
    const id = crypto.randomUUID(),
      status = window.historical
        ? "completed"
        : !isOwner && policy.approvalMode === "request"
          ? "requested"
          : "active";
    const snapshot = {
      cancelHours: policy.cancelHours,
      approvalMode: policy.approvalMode,
      leadHours: policy.leadHours,
      horizonDays: policy.horizonDays,
      requestHoldHours: policy.requestHoldHours,
      timeZone: installation.timeZone,
      version: policy.version,
    };
    const rate = {
      baseCents: service.priceCents,
      additionalPetCents: service.additionalPetPriceCents,
      petCount: input.petIds.length,
      days: window.days,
      durationMinutes: service.durationMinutes,
      currency: installation.currency,
      pricingRule:
        service.additionalPetPriceCents > 0
          ? "base-plus-additional-pets"
          : "per-pet",
    };
    const record = {
      ...window,
      id,
      clientId,
      service,
      status,
      policy: snapshot,
      price: rate,
      message: input.message,
      petIds: input.petIds,
      expires:
        status === "requested"
          ? Math.min(now + policy.requestHoldHours * 3_600_000, window.startAt)
          : null,
    };
    // The decision and capacity reservation commit in ONE batch. No check-then-insert window.
    // Version/value predicates also prevent stale policy, rates, household/pet state or authorization from committing.
    const result = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO bookings(id,sitter_id,client_id,service_id,service_name,service_duration_minutes,status,start_at,end_at,start_date,end_date,start_time,end_time,
        total_amount_cents,created_at,updated_at,policy_snapshot,price_snapshot,request_expires_at,created_by,request_key,request_digest,client_request)
        SELECT json_extract(?1,'$.id'),?2,?3,s.id,s.name,s.duration_minutes,json_extract(?1,'$.status'),json_extract(?1,'$.startAt'),json_extract(?1,'$.endAt'),
          json_extract(?1,'$.startDate'),json_extract(?1,'$.endDate'),json_extract(?1,'$.startTime'),json_extract(?1,'$.endTime'),json_extract(?1,'$.total'),?4,?4,
          json_extract(?1,'$.policy'),json_extract(?1,'$.price'),json_extract(?1,'$.expires'),?5,?6,?7,json_extract(?1,'$.message')
        FROM services s JOIN clients c ON c.id=?3 AND c.sitter_id=s.sitter_id
        WHERE s.id=json_extract(?1,'$.service.id') AND s.sitter_id=?2 AND s.is_active=1 AND c.status='active' AND (?8=1 OR s.portal_visible=1)
          AND s.price_cents=json_extract(?1,'$.service.priceCents') AND s.additional_pet_price_cents=json_extract(?1,'$.service.additionalPetPriceCents')
          AND s.duration_minutes IS json_extract(?1,'$.service.durationMinutes') AND s.name=json_extract(?1,'$.service.name')
          AND (SELECT version FROM booking_policy WHERE id=1)=?9 AND (SELECT version FROM installation WHERE id=1 AND setup_state='ready')=?10
          AND EXISTS(SELECT 1 FROM business_memberships m JOIN user u ON u.id=m.user_id WHERE m.user_id=?5 AND m.revoked_at IS NULL AND u.email_verified=1
            AND ((?8=1 AND m.role='owner') OR (?8=0 AND m.role='client' AND m.client_id=?3 AND lower(c.email)=lower(u.email))))
          AND (?8=1 OR (SELECT json_extract(config,'$.portalEnabled') FROM booking_policy WHERE id=1)=1)
          AND (SELECT count(*) FROM pets p WHERE p.client_id=?3 AND p.is_active=1 AND p.id IN (SELECT value FROM json_each(?1,'$.petIds')))=json_array_length(?1,'$.petIds')
          AND ((?8=1 AND json_extract(?1,'$.historical')=1 AND json_extract(?1,'$.endAt')<=?4)
            OR NOT EXISTS(SELECT 1 FROM bookings b WHERE b.sitter_id=?2 AND (b.status='active' OR (b.status='requested' AND b.request_expires_at>?4))
              AND b.start_at<json_extract(?1,'$.endAt') AND b.end_at>json_extract(?1,'$.startAt')))
          AND NOT EXISTS(SELECT 1 FROM bookings WHERE created_by=?5 AND request_key=?6)`,
      ).bind(
        JSON.stringify(record),
        c.get("sitterId"),
        clientId,
        now,
        c.get("userId"),
        input.requestId,
        hash,
        isOwner,
        policy.version,
        installation.version,
      ),
      c.env.DB.prepare(
        "INSERT INTO booking_pets(booking_id,pet_id) SELECT ?1,value FROM json_each(?2) WHERE EXISTS(SELECT 1 FROM bookings WHERE id=?1)",
      ).bind(id, JSON.stringify(input.petIds)),
      c.env.DB.prepare(
        "INSERT INTO booking_history SELECT ?1,?2,?3,?4,?5,'',?6 WHERE EXISTS(SELECT 1 FROM bookings WHERE id=?2)",
      ).bind(
        crypto.randomUUID(),
        id,
        c.get("userId"),
        c.get("businessRole"),
        window.historical
          ? "recorded-past"
          : status === "requested"
            ? "requested"
            : "confirmed",
        now,
      ),
    ]);
    if (!result[0].meta.changes) {
      const replay = await c.env.DB.prepare(
        "SELECT id,request_digest FROM bookings WHERE created_by=?1 AND request_key=?2",
      )
        .bind(c.get("userId"), input.requestId)
        .first<{ id: string; request_digest: string }>();
      if (replay?.request_digest === hash)
        return c.json({
          booking: await present(c, await getRow(c, replay.id)),
          replay: true,
        });
      throw new HTTPException(409, {
        message:
          "The slot, household, service or settings changed. Refresh and choose an available time.",
      });
    }
    return c.json({ booking: await present(c, await getRow(c, id)) }, 201);
  });
  api.post("/:id/transition", async (c) => {
    const input = parseInput(transitionSchema, await readJson(c.req)),
      row = await getRow(c, c.req.param("id"));
    const owner = c.get("businessRole") === "owner",
      now = Date.now();
    if (!owner && input.action !== "cancel")
      throw new HTTPException(403, {
        message: "Only the sitter can approve or complete a booking.",
      });
    if (["cancel", "decline"].includes(input.action) && !input.reason)
      throw new HTTPException(400, {
        message: "Enter a reason; it will be visible to the client and sitter.",
      });
    const policy = row.policy_snapshot
      ? (JSON.parse(row.policy_snapshot) as BookingPolicy)
      : null;
    if (
      !owner &&
      (!policy || now > row.start_at - policy.cancelHours * 3_600_000)
    )
      throw new HTTPException(409, {
        message: "The cancellation window has closed. Contact your sitter.",
      });
    const allowed =
      input.action === "approve" || input.action === "decline"
        ? row.status === "requested" && row.request_expires_at! > now
        : input.action === "complete"
          ? row.status === "active" && row.end_at <= now
          : ["active", "requested"].includes(row.status);
    if (!allowed || row.version !== input.version)
      throw new HTTPException(409, {
        message:
          "This booking changed or cannot make that transition. Refresh it.",
      });
    const status = {
      approve: "active",
      decline: "declined",
      cancel: "cancelled",
      complete: "completed",
    }[input.action];
    const historyId = crypto.randomUUID();
    const result = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE bookings SET status=?1,version=version+1,updated_at=?2 WHERE id=?3 AND sitter_id=?4 AND version=?5 AND status=?6
        AND (?7<>'approve' OR request_expires_at>?2 AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.sitter_id=?4 AND b.id<>?3
          AND (b.status='active' OR b.status='requested' AND b.request_expires_at>?2) AND b.start_at<bookings.end_at AND b.end_at>bookings.start_at))
        AND EXISTS(SELECT 1 FROM business_memberships m JOIN user u ON u.id=m.user_id JOIN clients c ON c.id=bookings.client_id
          WHERE m.user_id=?8 AND m.revoked_at IS NULL AND u.email_verified=1 AND ((?9=1 AND m.role='owner') OR (?9=0 AND m.role='client' AND m.client_id=bookings.client_id
          AND c.status='active' AND lower(c.email)=lower(u.email) AND (SELECT json_extract(config,'$.portalEnabled') FROM booking_policy WHERE id=1)=1
          AND ?2<=bookings.start_at-json_extract(bookings.policy_snapshot,'$.cancelHours')*3600000)))`,
      ).bind(
        status,
        now,
        row.id,
        c.get("sitterId"),
        input.version,
        row.status,
        input.action,
        c.get("userId"),
        owner,
      ),
      c.env.DB.prepare(
        "INSERT INTO booking_history SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE changes()>0",
      ).bind(
        historyId,
        row.id,
        c.get("userId"),
        c.get("businessRole"),
        status === "active" ? "approved" : status,
        input.reason,
        now,
      ),
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO booking_financial_followups(booking_id,reason,created_at)
        SELECT ?1,'Review cancellation; no refund or payment change has been performed.',?2 WHERE ?3='cancelled' AND EXISTS(SELECT 1 FROM booking_history WHERE id=?4)`,
      ).bind(row.id, now, status, historyId),
    ]);
    if (!result[0].meta.changes)
      throw new HTTPException(409, {
        message:
          "The booking or your access changed. Refresh before trying again.",
      });
    return c.json({ booking: await present(c, await getRow(c, row.id)) });
  });
  api.put("/:id/notes", ownerOnly, async (c) => {
    const input = parseInput(
      z
        .object({
          version: z.number().int().positive(),
          privateNotes: z.string().trim().max(4000),
          clientUpdate: z.string().trim().max(2000),
        })
        .strict(),
      await readJson(c.req),
    );
    const row = await getRow(c, c.req.param("id"));
    const result = await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE bookings SET notes=?1,client_update=?2,version=version+1,updated_at=?3 WHERE id=?4 AND sitter_id=?5 AND version=?6",
      ).bind(
        input.privateNotes,
        input.clientUpdate,
        Date.now(),
        row.id,
        c.get("sitterId"),
        input.version,
      ),
      c.env.DB.prepare(
        "INSERT INTO booking_history SELECT ?1,?2,?3,'owner','notes-updated','',?4 WHERE changes()>0",
      ).bind(crypto.randomUUID(), row.id, c.get("userId"), Date.now()),
    ]);
    if (!result[0].meta.changes)
      throw new HTTPException(409, {
        message: "Notes changed. Refresh before saving.",
      });
    return c.json({ ok: true });
  });
  return api;
}
