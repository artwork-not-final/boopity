import { parseInput, readJson } from "../core/http-input";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../core/env";
import { clientsApi } from "./client-routes";
import { petsApi } from "./pet-routes";
import { servicesApi } from "./service-routes";
import { policySchema, calendarDate, clockTime } from "../../src/shared/portal";
import type { FirstBookingProgress } from "../../src/shared/first-booking";
import { ownerOnly, requireBusiness } from "./access";
import { portalOpenSql } from "./admission";
import { readPolicy, bookingWindow, type ServiceRate } from "./booking-rules";
import { bookingRoutes, expireRequests } from "./bookings";
import { invitationDigest, randomInvite } from "./invitations";
import { paymentRoutes } from "../payments/routes";
import type { PaymentService } from "../payments/service";
import type { PaymentAdmin } from "../payments/provider";
import {
  clientDetail,
  clientList,
  petList,
  readPetPage,
  serviceList,
  serviceDetail,
} from "./lists";
import {
  listQuery,
  pageInfo,
  PAGE_SIZE,
  searchPattern,
} from "../../src/shared/pagination";

export function businessRoutes(
  payments?: PaymentService,
  paymentAdmin?: PaymentAdmin,
) {
  const api = new Hono<AppEnv>(),
    owner = new Hono<AppEnv>();
  api.use("*", requireBusiness);
  api.use("*", async (c, next) => {
    await expireRequests(c.env.DB);
    await next();
  });
  owner.use("*", ownerOnly);
  owner.get("/first-booking", async (c) => {
    const progress = await c.env.DB.prepare(
      `WITH active_clients AS (
        SELECT id FROM clients WHERE sitter_id=?1 AND status='active'
        ORDER BY created_at,id LIMIT 2
      )
      SELECT
        EXISTS(SELECT 1 FROM services WHERE sitter_id=?1 AND is_active=1) AS service,
        EXISTS(SELECT 1 FROM active_clients) AS client,
        EXISTS(SELECT 1 FROM pets p JOIN clients c ON c.id=p.client_id
          WHERE c.sitter_id=?1 AND c.status='active' AND p.is_active=1) AS pet,
        EXISTS(SELECT 1 FROM bookings WHERE sitter_id=?1) AS booking,
        CASE WHEN (SELECT count(*) FROM active_clients)=1
          THEN (SELECT id FROM active_clients LIMIT 1) ELSE NULL END AS clientId`,
    )
      .bind(c.get("sitterId"))
      .first<{
        service: number;
        client: number;
        pet: number;
        booking: number;
        clientId: string | null;
      }>();
    return c.json({
      progress: {
        service: Boolean(progress!.service),
        client: Boolean(progress!.client),
        pet: Boolean(progress!.pet),
        booking: Boolean(progress!.booking),
        clientId: progress!.clientId,
      } satisfies FirstBookingProgress,
    });
  });
  // One paginated read handler per resource; CRM routers add mutations and pet detail only.
  owner.get("/clients", clientList);
  owner.get("/clients/:id", clientDetail);
  owner.get("/pets", petList);
  owner.get("/services", serviceList);
  owner.get("/services/:id", serviceDetail);
  owner.route("/clients", clientsApi);
  // Owner-only CRM. Photo/document prototypes are deliberately not mounted here.
  owner.route("/pets", petsApi);
  owner.route("/services", servicesApi);
  owner.put("/policy", async (c) => {
    const { version, ...policy } = parseInput(
      policySchema.safeExtend({ version: z.number().int().positive() }),
      await readJson(c.req),
    );
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE booking_policy SET config=?1,version=version+1 WHERE id=1 AND version=?2",
      ).bind(JSON.stringify(policy), version),
      c.env.DB.prepare(
        "INSERT INTO installation_audit SELECT ?1,'booking-policy-saved',?2,?3 WHERE changes()>0",
      ).bind(crypto.randomUUID(), c.get("userId"), Date.now()),
      c.env.DB
        .prepare(`DELETE FROM session WHERE user_id IN (SELECT user_id FROM business_memberships WHERE role='client')
        AND (SELECT json_extract(config,'$.portalEnabled') FROM booking_policy WHERE id=1)=0`),
    ]);
    if (!results[0].meta.changes)
      throw new HTTPException(409, {
        message: "Policy changed. Reload before saving.",
      });
    return c.json({ policy: await readPolicy(c.env.DB) });
  });
  owner.put("/services/:id/visibility", async (c) => {
    const { visible } = parseInput(
      z.object({ visible: z.boolean() }).strict(),
      await readJson(c.req),
    );
    const result = await c.env.DB.prepare(
      "UPDATE services SET portal_visible=?1 WHERE id=?2 AND sitter_id=?3",
    )
      .bind(visible, c.req.param("id"), c.get("sitterId"))
      .run();
    if (!result.meta.changes)
      throw new HTTPException(404, { message: "Service not found." });
    return c.json({ ok: true });
  });
  owner.get("/access", async (c) => {
    const input = parseInput(listQuery, c.req.query());
    const clients = await c.env.DB.prepare(
      `SELECT c.id,c.first_name||' '||c.last_name AS name,c.email,c.status,
      (SELECT count(*) FROM business_memberships m WHERE m.client_id=c.id AND m.role='client' AND m.revoked_at IS NULL) AS members,
      (SELECT max(expires_at) FROM client_invitations v WHERE v.client_id=c.id AND v.consumed_at IS NULL AND v.revoked_at IS NULL AND v.expires_at>?2) AS invitationExpiresAt
      FROM clients c WHERE c.sitter_id=?1 AND (?3='' OR lower(c.first_name||' '||c.last_name) LIKE ?4 ESCAPE '\\' OR lower(c.email) LIKE ?4 ESCAPE '\\')
      ORDER BY c.first_name,c.id LIMIT ?5 OFFSET ?6`,
    )
      .bind(
        c.get("sitterId"),
        Date.now(),
        input.search,
        searchPattern(input.search),
        PAGE_SIZE + 1,
        input.offset,
      )
      .all();
    return c.json({
      clients: clients.results.slice(0, PAGE_SIZE),
      pagination: pageInfo(input.offset, clients.results.length),
    });
  });
  owner.post("/clients/:id/invitation", async (c) => {
    parseInput(z.object({}).strict(), await readJson(c.req));
    const client = await c.env.DB.prepare(
      "SELECT id,lower(email) AS email FROM clients WHERE id=?1 AND sitter_id=?2 AND status='active'",
    )
      .bind(c.req.param("id"), c.get("sitterId"))
      .first<{ id: string; email: string }>();
    if (!client || !z.email().safeParse(client.email).success)
      throw new HTTPException(400, {
        message: "Set an active client's valid email before inviting them.",
      });
    const conflict = await c.env.DB.prepare(
      `SELECT 1 FROM business_memberships m JOIN user u ON u.id=m.user_id
      WHERE lower(u.email)=?1 AND (m.role='owner' OR m.revoked_at IS NULL)`,
    )
      .bind(client.email)
      .first();
    if (conflict)
      throw new HTTPException(409, {
        message:
          "This email already has access. Revoke its client access before re-inviting; owners cannot be invited as clients.",
      });
    const token = randomInvite(),
      id = crypto.randomUUID(),
      now = Date.now(),
      expiresAt = now + 7 * 86_400_000;
    const hash = await invitationDigest(c.env.BETTER_AUTH_SECRET, token);
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE client_invitations SET revoked_at=?1 WHERE (client_id=?2 OR email=?3) AND consumed_at IS NULL AND revoked_at IS NULL
        AND ${portalOpenSql}`,
      ).bind(now, client.id, client.email),
      c.env.DB.prepare(
        `INSERT INTO client_invitations(id,client_id,email,digest,expires_at,created_at) SELECT ?1,?2,?3,?4,?5,?6
        WHERE ${portalOpenSql} AND EXISTS(SELECT 1 FROM clients WHERE id=?2 AND status='active' AND lower(email)=?3)
        AND NOT EXISTS(SELECT 1 FROM business_memberships m JOIN user u ON u.id=m.user_id WHERE lower(u.email)=?3 AND (m.role='owner' OR m.revoked_at IS NULL))`,
      ).bind(id, client.id, client.email, hash, expiresAt, now),
      c.env.DB.prepare(
        "INSERT INTO installation_audit SELECT ?1,'client-invitation-issued',?2,?3 WHERE changes()>0",
      ).bind(crypto.randomUUID(), c.get("userId"), now),
    ]);
    if (!results[1].meta.changes)
      throw new HTTPException(409, {
        message:
          "Enable the client portal first, or refresh the changed contact.",
      });
    // Explicit owner action; this link is shown once for private sharing. No automatic email delivery.
    return c.json(
      { url: `${c.env.APP_URL}/login#invite=${token}`, expiresAt },
      201,
    );
  });
  owner.post("/clients/:id/revoke", async (c) => {
    const client = await c.env.DB.prepare(
      "SELECT id FROM clients WHERE id=?1 AND sitter_id=?2",
    )
      .bind(c.req.param("id"), c.get("sitterId"))
      .first();
    if (!client) throw new HTTPException(404, { message: "Client not found." });
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "DELETE FROM session WHERE user_id IN (SELECT user_id FROM business_memberships WHERE client_id=?1 AND role='client')",
      ).bind(c.req.param("id")),
      c.env.DB.prepare(
        "UPDATE business_memberships SET revoked_at=?1 WHERE client_id=?2 AND role='client'",
      ).bind(now, c.req.param("id")),
      c.env.DB.prepare(
        "UPDATE client_invitations SET revoked_at=?1 WHERE client_id=?2 AND consumed_at IS NULL AND revoked_at IS NULL",
      ).bind(now, c.req.param("id")),
      c.env.DB.prepare(
        "INSERT INTO installation_audit VALUES (?1,'client-access-revoked',?2,?3)",
      ).bind(crypto.randomUUID(), c.get("userId"), now),
    ]);
    return c.json({ ok: true });
  });
  const followupSelect = `SELECT f.booking_id AS bookingId,b.service_name AS serviceName,c.first_name||' '||c.last_name AS clientName,
    b.status AS bookingStatus,
    b.start_date AS startDate,b.end_date AS endDate,b.start_time AS startTime,json_extract(b.policy_snapshot,'$.timeZone') AS timeZone,
    f.reason,f.created_at AS createdAt,f.resolved_at AS resolvedAt,f.resolution FROM booking_financial_followups f
    JOIN bookings b ON b.id=f.booking_id JOIN clients c ON c.id=b.client_id WHERE b.sitter_id=?1`;
  owner.get("/financial-followups", async (c) => {
    const input = parseInput(
      listQuery.extend({
        status: z.enum(["all", "open", "resolved"]).default("all"),
      }),
      c.req.query(),
    );
    const rows = await c.env.DB.prepare(
      `${followupSelect}
      AND (?2='all' OR ?2='open' AND f.resolved_at IS NULL OR ?2='resolved' AND f.resolved_at IS NOT NULL)
      AND (?3='' OR lower(c.first_name||' '||c.last_name||' '||b.service_name) LIKE ?4 ESCAPE '\\')
      ORDER BY f.created_at DESC,f.booking_id LIMIT ?5 OFFSET ?6`,
    )
      .bind(
        c.get("sitterId"),
        input.status,
        input.search,
        searchPattern(input.search),
        PAGE_SIZE + 1,
        input.offset,
      )
      .all();
    return c.json({
      followups: rows.results.slice(0, PAGE_SIZE),
      pagination: pageInfo(input.offset, rows.results.length),
    });
  });
  owner.get("/financial-followups/:id", async (c) => {
    const followup = await c.env.DB.prepare(
      `${followupSelect} AND f.booking_id=?2`,
    )
      .bind(c.get("sitterId"), c.req.param("id"))
      .first();
    if (!followup)
      throw new HTTPException(404, { message: "Cancellation not found." });
    return c.json({ followup });
  });
  owner.post("/financial-followups/:id/resolve", async (c) => {
    const { resolution, expectedCreatedAt, expectedReason } = parseInput(
      z
        .object({
          resolution: z.string().trim().min(1).max(1000),
          expectedCreatedAt: z.number().int().nonnegative(),
          expectedReason: z.string().max(4000),
        })
        .strict(),
      await readJson(c.req),
    );
    const result = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE booking_financial_followups SET resolved_at=?1,resolution=?2 WHERE booking_id=?3 AND resolved_at IS NULL
      AND booking_id IN (SELECT id FROM bookings WHERE sitter_id=?4)
      AND created_at=?5 AND reason=?6`,
      ).bind(
        Date.now(),
        resolution,
        c.req.param("id"),
        c.get("sitterId"),
        expectedCreatedAt,
        expectedReason,
      ),
      c.env.DB.prepare(
        "INSERT INTO installation_audit SELECT ?1,'cancellation-financial-review-recorded',?2,?3 WHERE changes()>0",
      ).bind(crypto.randomUUID(), c.get("userId"), Date.now()),
    ]);
    if (!result[0].meta.changes)
      throw new HTTPException(409, {
        message:
          "This review changed or was already resolved. Reload it before continuing.",
      });
    return c.json({ ok: true });
  });
  api.route("/owner", owner);
  api.get("/policy", async (c) =>
    c.json({
      policy: await readPolicy(c.env.DB),
      regional: await c.env.DB.prepare(
        "SELECT time_zone AS timeZone,currency FROM installation WHERE id=1",
      ).first(),
    }),
  );
  api.get("/services", serviceList);
  api.get("/pets", petList);
  api.get("/household", async (c) => {
    if (c.get("businessRole") !== "client")
      throw new HTTPException(403, {
        message: "This page is for invited clients.",
      });
    // Deliberate whitelist: CRM/sitter notes, addresses, health data, documents and private object keys never cross this boundary.
    const household = await c.env.DB.prepare(
      "SELECT id,first_name AS firstName,last_name AS lastName FROM clients WHERE id=?1 AND sitter_id=?2",
    )
      .bind(c.get("clientId"), c.get("sitterId"))
      .first();
    const pets = await readPetPage(c);
    return c.json({ household, ...pets });
  });
  api.get("/availability", async (c) => {
    const input = parseInput(
      z
        .object({
          serviceId: z.string().min(1).max(100),
          startDate: calendarDate,
          endDate: calendarDate.optional(),
          startTime: clockTime.optional(),
          outsideHours: z.literal("true").optional(),
          waiveNotice: z.literal("true").optional(),
        })
        .strict(),
      c.req.query(),
    );
    const owner = c.get("businessRole") === "owner",
      policy = await readPolicy(c.env.DB),
      now = Date.now();
    const overrides =
      input.outsideHours || input.waiveNotice
        ? {
            outsideHours: input.outsideHours === "true",
            waiveNotice: input.waiveNotice === "true",
          }
        : undefined;
    if (!owner && overrides)
      throw new HTTPException(403, {
        message: "Only the sitter can make a booking exception.",
      });
    const zone = (await c.env.DB.prepare(
      "SELECT time_zone AS zone FROM installation WHERE id=1",
    ).first<{ zone: string }>())!.zone;
    const service = await c.env.DB.prepare(
      `SELECT id,name,duration_minutes AS durationMinutes,price_cents AS priceCents,additional_pet_price_cents AS additionalPetPriceCents
      FROM services WHERE id=?1 AND sitter_id=?2 AND is_active=1 AND (?3=1 OR portal_visible=1)`,
    )
      .bind(input.serviceId, c.get("sitterId"), owner)
      .first<ServiceRate>();
    if (!service)
      throw new HTTPException(400, { message: "Choose an available service." });
    const busy = await c.env.DB.prepare(
      `SELECT start_at AS startAt,end_at AS endAt,status FROM bookings WHERE sitter_id=?1 AND
      (status IN ('active','completed') OR status='requested' AND request_expires_at>?2) AND end_at>?3 AND start_at<?4`,
    )
      .bind(
        c.get("sitterId"),
        now,
        Date.parse(input.startDate) - 2 * 86_400_000,
        Date.parse(input.endDate ?? input.startDate) + 2 * 86_400_000,
      )
      .all<{ startAt: number; endAt: number; status: string }>();
    // Exact owner previews allow recording the actual time, not just a free slot.
    // The server infers historical eligibility; future exceptions still enforce capacity.
    if (
      owner &&
      (input.startTime !== undefined || service.durationMinutes === null)
    ) {
      const window = bookingWindow(
        {
          ...input,
          overrides,
          requestId: crypto.randomUUID(),
          petIds: ["availability-only"],
          message: "",
        },
        service,
        policy,
        zone,
        false,
        now,
      );
      const overlaps = busy.results.some(
        (b) =>
          (window.historical || b.status !== "completed") &&
          b.startAt < window.endAt &&
          b.endAt > window.startAt,
      );
      return c.json({
        slots:
          window.historical || !overlaps
            ? [{ startTime: window.startTime }]
            : [],
        historical: window.historical,
        overlaps,
        timeZone: zone,
        provisional: true,
      });
    }
    const slots: { startTime: string | null }[] = [];
    for (
      let minute = 0;
      minute < (service.durationMinutes === null ? 1 : 1440);
      minute += 15
    ) {
      const startTime =
        service.durationMinutes === null
          ? undefined
          : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      try {
        const window = bookingWindow(
          {
            ...input,
            overrides,
            requestId: crypto.randomUUID(),
            petIds: ["availability-only"],
            startTime,
            message: "",
          },
          service,
          policy,
          zone,
          !owner,
          now,
        );
        if (
          window.historical ||
          !busy.results.some(
            (b) =>
              b.status !== "completed" &&
              b.startAt < window.endAt &&
              b.endAt > window.startAt,
          )
        )
          slots.push({ startTime: startTime ?? null });
      } catch (error) {
        if (!(error instanceof HTTPException)) throw error;
      }
    }
    // Only free choices are returned, never another household's identity, booking or blocked-date reason.
    return c.json({ slots, timeZone: zone, provisional: true });
  });
  api.route("/bookings", bookingRoutes());
  if (payments && paymentAdmin)
    api.route("/payments", paymentRoutes(payments, paymentAdmin));
  return api;
}
