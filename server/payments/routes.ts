import { parseInput, readJson } from "../core/http-input";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../core/env";
import { ownerOnly } from "../business/access";
import type { PaymentActor } from "./ledger";
import { error } from "./ledger";
import type { PaymentService } from "./service";
import type { PaymentAdmin } from "./provider";
import { paymentKey, paymentMode } from "../../src/shared/payments";
import { paymentRecords } from "./records";

export function paymentRoutes(service: PaymentService, admin: PaymentAdmin) {
  const api = new Hono<AppEnv>();
  const actor = (c: Parameters<typeof ownerOnly>[0]): PaymentActor => ({
    id: c.get("userId"),
    role: c.get("businessRole"),
    sitterId: c.get("sitterId"),
    clientId: c.get("clientId"),
  });
  api.get("/records", ownerOnly, async (c) =>
    c.json(await paymentRecords(service.db, actor(c), c.req.query())),
  );
  api.get("/integrations", ownerOnly, async (c) =>
    c.json({
      integrations: await admin.views(),
      settings: await service.db
        .prepare("SELECT mode,version FROM payment_settings WHERE id=1")
        .first(),
    }),
  );
  api.put("/integrations/stripe/:mode", ownerOnly, async (c) => {
    await admin.save(
      parseInput(paymentMode, c.req.param("mode")),
      await readJson(c.req),
      c.get("userId"),
    );
    return c.json({ ok: true });
  });
  api.post("/integrations/stripe/:mode/verify", ownerOnly, async (c) => {
    parseInput(z.object({}).strict(), await readJson(c.req));
    await admin.verify(
      parseInput(paymentMode, c.req.param("mode")),
      c.get("userId"),
    );
    return c.json({ ok: true });
  });
  api.put("/integrations/stripe/:mode/enabled", ownerOnly, async (c) => {
    const input = parseInput(
      z
        .object({ enabled: z.boolean(), version: z.number().int().positive() })
        .strict(),
      await readJson(c.req),
    );
    await admin.enable(
      parseInput(paymentMode, c.req.param("mode")),
      input.enabled,
      input.version,
      c.get("userId"),
    );
    return c.json({ ok: true });
  });
  api.put("/mode", ownerOnly, async (c) => {
    const input = parseInput(
      z
        .object({
          mode: paymentMode,
          version: z.number().int().positive(),
          confirmLive: z.boolean(),
        })
        .strict(),
      await readJson(c.req),
    );
    if (input.mode === "live") {
      const provider = await service.integrations.get("live");
      if (
        !input.confirmLive ||
        !provider?.enabled ||
        !provider.verified ||
        !provider.webhookVerified
      )
        error(
          "Verify and enable the live integration, then explicitly confirm live payments.",
        );
    }
    const result = await service.db.batch([
      service.db
        .prepare(
          "UPDATE payment_settings SET mode=?1,version=version+1 WHERE id=1 AND version=?2",
        )
        .bind(input.mode, input.version),
      service.db
        .prepare(
          "INSERT INTO payment_audit SELECT ?1,NULL,NULL,?2,?3,?4 WHERE changes()>0",
        )
        .bind(
          crypto.randomUUID(),
          `checkout-mode-${input.mode}`,
          c.get("userId"),
          Date.now(),
        ),
    ]);
    if (!result[0].meta.changes)
      error("Payment settings changed. Refresh first.");
    return c.json({ ok: true });
  });
  api.get("/bookings/:id", async (c) =>
    c.json(await service.view(c.req.param("id"), actor(c), c.req.query())),
  );
  api.get("/attempts/:id/refunds", async (c) =>
    c.json(
      await service.refundPage(
        c.req.param("id"),
        actor(c),
        c.req.query("offset"),
      ),
    ),
  );
  api.post("/bookings/:id/manual", ownerOnly, async (c) =>
    c.json({
      id: await service.manual(
        c.req.param("id"),
        actor(c),
        await readJson(c.req),
      ),
    }),
  );
  api.post("/bookings/:id/credit", ownerOnly, async (c) => {
    await service.credit(c.req.param("id"), actor(c), await readJson(c.req));
    return c.json({ ok: true });
  });
  api.post("/bookings/:id/checkout", async (c) => {
    const input = parseInput(
      z.object({ requestId: paymentKey }).strict(),
      await readJson(c.req),
    );
    return c.json(
      await service.checkout(c.req.param("id"), actor(c), input.requestId),
    );
  });
  api.post("/credits/:id/reverse", ownerOnly, async (c) => {
    const input = parseInput(
      z
        .object({
          note: z.string().trim().min(1).max(1000),
          confirm: z.literal(true),
        })
        .strict(),
      await readJson(c.req),
    );
    await service.reverseCredit(c.req.param("id"), actor(c), input.note);
    return c.json({ ok: true });
  });
  api.post("/attempts/:id/reconcile", async (c) => {
    parseInput(z.object({}).strict(), await readJson(c.req));
    await service.sync(c.req.param("id"), actor(c));
    return c.json({ ok: true });
  });
  api.post("/attempts/:id/expire", ownerOnly, async (c) => {
    parseInput(z.object({}).strict(), await readJson(c.req));
    await service.expire(c.req.param("id"), actor(c));
    return c.json({ ok: true });
  });
  api.post("/attempts/:id/refund", ownerOnly, async (c) =>
    c.json({
      id: await service.refund(
        c.req.param("id"),
        actor(c),
        await readJson(c.req),
      ),
    }),
  );
  api.post("/refunds/:id/retry", ownerOnly, async (c) => {
    parseInput(
      z.object({ confirm: z.literal(true) }).strict(),
      await readJson(c.req),
    );
    return c.json({
      id: await service.retryRefund(c.req.param("id"), actor(c)),
    });
  });
  api.post("/attempts/:id/void", ownerOnly, async (c) => {
    const input = parseInput(
      z
        .object({
          note: z.string().trim().min(1).max(1000),
          confirm: z.literal(true),
        })
        .strict(),
      await readJson(c.req),
    );
    await service.voidManual(c.req.param("id"), actor(c), input.note);
    return c.json({ ok: true });
  });
  return api;
}
