import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alice, manual, owner, paymentFixture } from "./payment-fixture";
const fixtures: ReturnType<typeof paymentFixture>[] = [];
function fixture() {
  const f = paymentFixture();
  fixtures.push(f);
  return f;
}
beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("External network blocked");
    }),
  ),
);
afterEach(() => {
  fixtures.splice(0).forEach((f) => f.close());
  vi.unstubAllGlobals();
});
describe("authenticated payment API", () => {
  it("cannot resolve a newer payment warning from a stale review screen", async () => {
    const f = fixture(),
      browser = f.browser();
    await browser.login("owner@example.test");
    await f.service.review("booking-a", "First payment warning").run();
    const path = "/api/business/owner/financial-followups/booking-a";
    const first = (await (await browser.req(path)).json()).followup;
    expect(first).toMatchObject({
      bookingStatus: "active",
      reason: "First payment warning",
    });
    await f.service
      .review("booking-a", "New refund outcome needs attention")
      .run();
    const stale = await browser.req(path + "/resolve", "POST", {
      resolution: "Reviewed first warning",
      expectedCreatedAt: first.createdAt,
      expectedReason: first.reason,
    });
    expect(stale.status).toBe(409);
    const current = (await (await browser.req(path)).json()).followup;
    expect(current.resolvedAt).toBeNull();
    expect(current.reason).toBe("New refund outcome needs attention");
    const fresh = await browser.req(path + "/resolve", "POST", {
      resolution: "Reviewed new warning",
      expectedCreatedAt: current.createdAt,
      expectedReason: current.reason,
    });
    expect(fresh.status).toBe(200);
  });
  it("enforces owner/client permissions, hides private notes and rejects forged amounts and cross-household checkout", async () => {
    const f = fixture(),
      a = f.browser(),
      b = f.browser(),
      o = f.browser();
    await a.login("alice@example.test");
    await b.login("bob@example.test");
    await o.login("owner@example.test");
    expect(
      (await f.browser().req("/api/business/payments/bookings/booking-a"))
        .status,
    ).toBe(401);
    expect(
      (await b.req("/api/business/payments/bookings/booking-a")).status,
    ).toBe(404);
    expect((await a.req("/api/business/payments/integrations")).status).toBe(
      403,
    );
    expect(
      (
        await a.req(
          "/api/business/payments/bookings/booking-a/manual",
          "POST",
          manual(),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await a.req("/api/business/payments/credits/unknown/reverse", "POST", {
          note: "forbidden",
          confirm: true,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await a.req(
          "/api/business/payments/bookings/booking-b/checkout",
          "POST",
          { requestId: crypto.randomUUID() },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await a.req(
          "/api/business/payments/bookings/booking-a/checkout",
          "POST",
          { requestId: crypto.randomUUID(), amountCents: 1 },
        )
      ).status,
    ).toBe(400);
    const record = await o.req(
      "/api/business/payments/bookings/booking-a/manual",
      "POST",
      manual(),
    );
    expect(record.status).toBe(200);
    const detail = await (
      await a.req("/api/business/payments/bookings/booking-a")
    ).json();
    expect(detail.balances[0]).toMatchObject({
      outstandingCents: 2000,
      status: "partial",
    });
    expect(JSON.stringify(detail)).not.toMatch(
      /PRIVATE|provider_ref|request_key|actor_id|checkout_url/,
    );
    const id = (await record.json()).id;
    for (const action of ["refund", "void", "expire"])
      expect(
        (
          await a.req(
            `/api/business/payments/attempts/${id}/${action}`,
            "POST",
            {},
          )
        ).status,
      ).toBe(403);
    expect(
      (
        await o.req(
          "/api/business/payments/bookings/booking-a/manual",
          "POST",
          manual(),
          { origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await o.req(
          "/api/business/payments/bookings/booking-a/manual",
          "POST",
          { ...manual(), amountCents: 10.1 },
        )
      ).status,
    ).toBe(400);
  });
  it("allows only the exact signed POST webhook exception and does not grant public payment mutations", async () => {
    const f = fixture(),
      anon = f.browser();
    const payload = { id: "evt_probe", type: "test.event", mode: "test" };
    expect(
      (
        await anon.req("/api/payments/webhooks/stripe/test", "POST", payload, {
          origin: "",
          "stripe-signature": "bad",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await anon.req("/api/payments/webhooks/stripe/test", "POST", payload, {
          origin: "",
          "stripe-signature": "local-verified",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await anon.req("/api/payments/webhooks/stripe/test", "PUT", payload, {
          origin: "",
          "stripe-signature": "local-verified",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await anon.req(
          "/api/payments/webhooks/stripe/test/extra",
          "POST",
          payload,
          { origin: "", "stripe-signature": "local-verified" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await anon.req("/api/business/payments/mode", "PUT", {
          mode: "live",
          confirmLive: true,
          version: 1,
        })
      ).status,
    ).toBe(401);
    expect((await anon.req("/api/billing/checkout", "POST", {})).status).toBe(
      404,
    );
  });
  it("ignores a forged return URL, supports same-refund retry and loses access immediately after client revocation", async () => {
    const f = fixture(),
      a = f.browser(),
      o = f.browser();
    await a.login("alice@example.test");
    await o.login("owner@example.test");
    const start = await f.service.checkout(
      "booking-a",
      alice,
      crypto.randomUUID(),
    );
    await a.req("/app/bookings/booking-a/payments?paid=true");
    expect(
      (await (await a.req("/api/business/payments/bookings/booking-a")).json())
        .balances[1].status,
    ).toBe("unpaid");
    f.test.paid();
    await f.service.sync(start.id, owner);
    f.test.failBeforeRefund = true;
    await o.req(`/api/business/payments/attempts/${start.id}/refund`, "POST", {
      requestId: crypto.randomUUID(),
      amountCents: 1000,
      note: "Synthetic refund",
      confirm: true,
    });
    const row = (await f.db
      .prepare("SELECT id FROM payment_refunds")
      .first<{ id: string }>())!;
    f.test.failBeforeRefund = false;
    expect(
      (
        await o.req(`/api/business/payments/refunds/${row.id}/retry`, "POST", {
          confirm: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await a.req(`/api/business/payments/refunds/${row.id}/retry`, "POST", {
          confirm: true,
        })
      ).status,
    ).toBe(403);
    await o.req("/api/business/owner/clients/a/revoke", "POST", {});
    expect(
      (await a.req("/api/business/payments/bookings/booking-a")).status,
    ).toBe(401);
  });
});
