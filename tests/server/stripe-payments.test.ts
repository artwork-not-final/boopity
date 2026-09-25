import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../../server/runtime/runtime";
import { createNodeApp } from "../../server/runtime/app";
import { StripePayments, stripeApiVersion } from "../../server/payments/stripe";
import { alice, origin, paymentFixture } from "../support/payment-fixture";

const fixtures: ReturnType<typeof paymentFixture>[] = [];
const restricted = (mode = "test") =>
  ["rk", mode, crypto.randomUUID().replaceAll("-", "")].join("_");
let key: string,
  secret: string,
  account: string,
  live: boolean,
  paid: boolean,
  refunds: Record<string, unknown>[],
  session: Record<string, any>,
  calls: {
    url: URL;
    method: string;
    headers: Headers;
    params: URLSearchParams;
  }[];
beforeEach(() => {
  key = restricted();
  secret = ["whsec", crypto.randomUUID().replaceAll("-", "")].join("_");
  account = "acct_synthetic";
  live = false;
  paid = false;
  refunds = [];
  calls = [];
  session = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | Request | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "object" && "url" in input ? input.url : String(input),
      );
      if (url.origin !== "https://api.stripe.com")
        throw new Error("External network blocked");
      const method = init?.method ?? "GET",
        params = new URLSearchParams(String(init?.body ?? ""));
      calls.push({ url, method, headers: new Headers(init?.headers), params });
      if (url.pathname === "/v1/account")
        return Response.json({
          id: account,
          object: "account",
          charges_enabled: true,
        });
      if (url.pathname === "/v1/balance")
        return Response.json({
          object: "balance",
          livemode: live,
          available: [],
          pending: [],
        });
      if (url.pathname === "/v1/checkout/sessions" && method === "POST") {
        const attempt = params.get("metadata[boopity_attempt]");
        session = {
          id: `cs_${attempt}`,
          object: "checkout.session",
          mode: "payment",
          status: "open",
          payment_status: "unpaid",
          amount_total: Number(
            params.get("line_items[0][price_data][unit_amount]"),
          ),
          currency: params.get("line_items[0][price_data][currency]"),
          livemode: live,
          metadata: {
            boopity_attempt: attempt,
            boopity_integration: params.get("metadata[boopity_integration]"),
          },
          payment_intent: null,
          url: `https://checkout.stripe.com/c/pay/cs_${attempt}`,
        };
        return Response.json(session);
      }
      if (url.pathname.startsWith("/v1/checkout/sessions/")) {
        if (url.pathname.endsWith("/expire")) {
          session.status = "expired";
          session.url = null;
        }
        if (paid) {
          session.status = "complete";
          session.payment_status = "paid";
          session.url = null;
          session.payment_intent = {
            id: "pi_synthetic",
            status: "succeeded",
            amount_received: session.amount_total,
            currency: session.currency,
            livemode: live,
            metadata: session.metadata,
            latest_charge: { id: "ch_synthetic", disputed: false },
          };
        }
        return Response.json(session);
      }
      if (url.pathname === "/v1/refunds") {
        if (method === "POST") {
          const r = {
            id: "re_synthetic",
            object: "refund",
            amount: Number(params.get("amount")),
            currency: session.currency,
            status: "pending",
            payment_intent: "pi_synthetic",
            metadata: {
              boopity_refund: params.get("metadata[boopity_refund]"),
            },
          };
          refunds.push(r);
          return Response.json(r);
        }
        return Response.json({
          object: "list",
          url: "/v1/refunds",
          data: refunds,
          has_more: false,
        });
      }
      throw new Error(`Unexpected synthetic request ${url.pathname}`);
    }),
  );
});
afterEach(() => {
  fixtures.splice(0).forEach((f) => f.close());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture() {
  const f = paymentFixture();
  f.db.connection.exec("DELETE FROM payment_integrations");
  fixtures.push(f);
  return f;
}
async function saved(f: ReturnType<typeof fixture>) {
  await f.runtime.control.payments.save(
    "test",
    { version: 0, key, webhookSecret: secret },
    "owner",
  );
}
async function sign(raw: string, timestamp?: number) {
  return new StripePayments(
    key,
    secret,
  ).client.webhooks.generateTestHeaderStringAsync({
    payload: raw,
    secret,
    timestamp,
    cryptoProvider: undefined,
  });
}
describe("Stripe SDK and credential boundary", () => {
  it("uses current hosted Checkout, saved amounts, dynamic methods and stable idempotency; never Connect, SaaS, tax or card storage", async () => {
    const adapter = new StripePayments(key, secret),
      input = {
        attemptId: crypto.randomUUID(),
        integrationId: "integration",
        amountCents: 2500,
        currency: "USD",
        name: "Dog visit",
        returnUrl: origin + "/app/bookings/booking-a/payments",
        expiresAt: Date.now() + 3600000,
        integrationLabel: "boopity_abcdefgh",
      };
    await adapter.createCheckout(input);
    const call = calls[0];
    expect(call.headers.get("stripe-version")).toBe(stripeApiVersion);
    expect(call.headers.get("idempotency-key")).toBe(
      `boopity:checkout:${input.attemptId}`,
    );
    expect(call.params.get("ui_mode")).toBe("hosted_page");
    expect(call.params.get("mode")).toBe("payment");
    expect(call.params.get("success_url")).toBe(input.returnUrl);
    expect(call.params.get("cancel_url")).toBe(input.returnUrl);
    expect(call.params.get("line_items[0][price_data][unit_amount]")).toBe(
      "2500",
    );
    expect(call.params.get("integration_identifier")).toBe("boopity_abcdefgh");
    expect(call.params.get("adaptive_pricing[enabled]")).toBe("false");
    expect([...call.params.keys()].join(",")).not.toMatch(
      /payment_method_types|automatic_tax|setup_future_usage|subscription|application_fee|transfer_data|customer_email/,
    );
    paid = true;
    expect((await adapter.inspectCheckout(String(session.id))).status).toBe(
      "succeeded",
    );
    await adapter.refund("pi_synthetic", 1000, "refund-local");
    expect(calls.at(-1)!.headers.get("idempotency-key")).toBe(
      "boopity:refund:refund-local",
    );
    expect(
      (await adapter.inspectCheckout(String(session.id))).refunds[0],
    ).toMatchObject({
      amountCents: 1000,
      status: "pending",
      localId: "refund-local",
    });
  });
  it("verifies the exact raw webhook, rejects stale/tampered signatures, and normalizes payment events", async () => {
    const adapter = new StripePayments(key, secret),
      raw = JSON.stringify({
        id: "evt_synthetic",
        type: "checkout.session.completed",
        livemode: false,
        data: {
          object: {
            id: "cs_synthetic",
            metadata: { boopity_attempt: "attempt" },
          },
        },
      });
    const signature = await sign(raw);
    expect(await adapter.verifyEvent(raw, signature)).toMatchObject({
      id: "evt_synthetic",
      mode: "test",
      checkoutRef: "cs_synthetic",
      localAttemptId: "attempt",
    });
    await expect(adapter.verifyEvent(raw + " ", signature)).rejects.toThrow();
    await expect(
      adapter.verifyEvent(
        raw,
        await sign(raw, Math.floor(Date.now() / 1000) - 600),
      ),
    ).rejects.toThrow();
    await expect(adapter.verifyEvent(raw, "invalid")).rejects.toThrow();
  });
  it("encrypts credentials, defaults disabled, requires account plus signed webhook, and survives restart", async () => {
    const f = fixture();
    await saved(f);
    const settings = f.runtime.control.payments;
    const stored = (await f.db
      .prepare("SELECT ciphertext FROM payment_integrations")
      .first<{ ciphertext: string }>())!;
    expect(stored.ciphertext).not.toContain(key);
    expect(stored.ciphertext).not.toContain(secret);
    expect(JSON.stringify(await settings.views())).not.toContain(key);
    expect(JSON.stringify(await settings.views())).not.toContain(secret);
    expect((await settings.views())[0]).toMatchObject({
      enabled: false,
      verified: false,
      webhookVerified: false,
    });
    await expect(settings.enable("test", true, 1, "owner")).rejects.toThrow(
      "Verify",
    );
    await settings.verify("test", "owner");
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET"]);
    await expect(settings.enable("test", true, 1, "owner")).rejects.toThrow(
      "signed webhook",
    );
    await settings.webhookSeen("test", 1);
    await settings.enable("test", true, 1, "owner");
    expect((await settings.views())[0]).toMatchObject({
      enabled: true,
      verified: true,
      webhookVerified: true,
      accountId: "acct_synthetic",
    });
    const peer = createRuntime(f.config, {});
    try {
      expect((await peer.control.payments.views())[0]).toMatchObject({
        enabled: true,
        verified: true,
        webhookVerified: true,
      });
    } finally {
      peer.close();
    }
  });
  it("rejects full-access keys, wrong modes, account changes, stale saves and webhook proof for replaced settings", async () => {
    const f = fixture(),
      settings = f.runtime.control.payments;
    await expect(
      settings.save(
        "test",
        { version: 0, key: restricted("live"), webhookSecret: secret },
        "owner",
      ),
    ).rejects.toThrow("mixed modes");
    await expect(
      settings.save(
        "test",
        { version: 0, key: key.replace(/^rk/, "sk"), webhookSecret: secret },
        "owner",
      ),
    ).rejects.toThrow("Secret keys");
    await saved(f);
    await settings.verify("test", "owner");
    await settings.webhookSeen("test", 1);
    await settings.save(
      "test",
      { version: 1, key: restricted(), webhookSecret: secret + "replacement" },
      "owner",
    );
    await settings.webhookSeen("test", 1);
    expect((await settings.views())[0]).toMatchObject({
      verified: false,
      webhookVerified: false,
      enabled: false,
    });
    await expect(
      settings.save("test", { version: 1 }, "owner"),
    ).rejects.toThrow("changed");
    live = true;
    await expect(settings.verify("test", "owner")).rejects.toThrow(
      "mode or account",
    );
    live = false;
    account = "acct_other";
    await expect(settings.verify("test", "owner")).rejects.toThrow(
      "mode or account",
    );
  });
  it("handles env overrides as complete read-only groups and does not reuse legacy SaaS credentials", async () => {
    const f = fixture();
    await saved(f);
    const peer = createRuntime(f.config, {
      BOOPITY_STRIPE_TEST_KEY: restricted(),
    });
    try {
      const view = (await peer.control.payments.views())[0];
      expect(view).toMatchObject({
        managed: true,
        keyPresent: true,
        webhookSecretPresent: false,
        verified: false,
        webhookVerified: false,
      });
      await expect(
        peer.control.payments.save(
          "test",
          { version: 1, key: restricted() },
          "owner",
        ),
      ).rejects.toThrow("host-managed");
    } finally {
      peer.close();
    }
    const legacy = createRuntime(f.config, {
      STRIPE_SECRET_KEY: restricted(),
      STRIPE_WEBHOOK_SECRET: secret,
    });
    try {
      expect((await legacy.control.payments.views())[0].managed).toBe(false);
    } finally {
      legacy.close();
    }
  });
  it("rejects unrestricted host overrides and preserves underlying encrypted UI settings", async () => {
    const f = fixture();
    await saved(f);
    const before = (await f.db
      .prepare("SELECT ciphertext FROM payment_integrations WHERE mode='test'")
      .first<{ ciphertext: string }>())!.ciphertext;
    const peer = createRuntime(f.config, {
      BOOPITY_STRIPE_TEST_KEY: restricted(),
      BOOPITY_STRIPE_TEST_WEBHOOK_SECRET: secret,
    });
    try {
      await peer.control.payments.save("test", { version: 1 }, "owner");
      expect(
        (await f.db
          .prepare(
            "SELECT ciphertext FROM payment_integrations WHERE mode='test'",
          )
          .first<{ ciphertext: string }>())!.ciphertext,
      ).toBe(before);
    } finally {
      peer.close();
    }
    const bad = createRuntime(f.config, {
      BOOPITY_STRIPE_TEST_KEY: key.replace(/^rk/, "sk"),
      BOOPITY_STRIPE_TEST_WEBHOOK_SECRET: secret,
    });
    try {
      const count = calls.length;
      await expect(
        bad.control.payments.verify("test", "owner"),
      ).rejects.toThrow("restricted key");
      expect(calls.length).toBe(count);
      expect((await bad.control.payments.get("test"))!.verified).toBe(false);
    } finally {
      bad.close();
    }
    expect((await f.runtime.control.payments.views())[0]).toMatchObject({
      keyPresent: true,
      webhookSecretPresent: true,
      managed: false,
    });
  });
  it("processes a signed raw HTTP webhook through the actual SDK and settles only provider-confirmed data", async () => {
    const f = fixture();
    await saved(f);
    await f.runtime.control.payments.verify("test", "owner");
    const app = createNodeApp(f.runtime.env, f.config, f.runtime.control);
    const send = async (raw: string, signature: string) =>
      app.request(origin + "/api/payments/webhooks/stripe/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signature,
        },
        body: raw,
      });
    const probe = JSON.stringify({
      id: "evt_probe",
      type: "account.updated",
      livemode: false,
      data: { object: { id: account } },
    });
    expect((await send(probe, await sign(probe))).status).toBe(200);
    await f.runtime.control.payments.enable("test", true, 1, "owner");
    const checkout = await f.runtime.payments.checkout(
      "booking-a",
      alice,
      crypto.randomUUID(),
    );
    paid = true;
    const raw = JSON.stringify({
      id: "evt_paid",
      type: "checkout.session.completed",
      livemode: false,
      data: { object: { id: session.id, metadata: session.metadata } },
    });
    expect((await send(raw, "bad")).status).toBe(400);
    expect((await send(raw, await sign(raw))).status).toBe(200);
    expect((await send(raw, await sign(raw))).status).toBe(200);
    expect(
      (await f.runtime.payments.view("booking-a", alice)).balances[1],
    ).toMatchObject({ status: "paid", receivedCents: 3000 });
    expect((await f.runtime.payments.attempt(checkout.id)).payment_ref).toBe(
      "pi_synthetic",
    );
  });
  it.each(["succeeded", "failed"] as const)(
    "keeps an ACH-style completed checkout unpaid until its asynchronous %s outcome",
    async (outcome) => {
      // Regression coverage for the real sandbox campaign. Network remains intercepted.
      const f = fixture();
      await saved(f);
      await f.runtime.control.payments.verify("test", "owner");
      const app = createNodeApp(f.runtime.env, f.config, f.runtime.control);
      const send = async (type: string, id: string) => {
        const raw = JSON.stringify({
          id,
          type,
          livemode: false,
          data: { object: { id: session.id, metadata: session.metadata } },
        });
        return app.request(origin + "/api/payments/webhooks/stripe/test", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "stripe-signature": await sign(raw),
          },
          body: raw,
        });
      };
      expect((await send("account.updated", "evt_ready")).status).toBe(200);
      await f.runtime.control.payments.enable("test", true, 1, "owner");
      const checkout = await f.runtime.payments.checkout(
        "booking-a",
        alice,
        crypto.randomUUID(),
      );
      session.status = "complete";
      session.payment_status = "unpaid";
      session.url = null;
      session.payment_intent = {
        id: "pi_synthetic",
        status: "requires_action",
        amount_received: 0,
        currency: session.currency,
        livemode: false,
        metadata: session.metadata,
        latest_charge: null,
        next_action: { type: "verify_with_microdeposits" },
      };
      expect(
        (await send("checkout.session.completed", "evt_complete")).status,
      ).toBe(200);
      expect(
        (await f.runtime.payments.view("booking-a", alice)).balances[1],
      ).toMatchObject({
        status: "unpaid",
        receivedCents: 0,
        outstandingCents: 3000,
      });
      expect((await f.runtime.payments.attempt(checkout.id)).status).toBe(
        "processing",
      );
      session.payment_intent.status = "processing";
      session.payment_intent.next_action = null;
      await f.runtime.payments.sync(checkout.id, alice);
      // A new browser request while bank settlement is pending cannot create another charge.
      expect(
        await f.runtime.payments.checkout(
          "booking-a",
          alice,
          crypto.randomUUID(),
        ),
      ).toMatchObject({
        id: checkout.id,
        status: "processing",
        url: null,
      });
      expect(
        calls.filter(
          (c) =>
            c.method === "POST" && c.url.pathname === "/v1/checkout/sessions",
        ),
      ).toHaveLength(1);
      paid = outcome === "succeeded";
      if (!paid) session.payment_intent.status = "requires_payment_method";
      const eventType = `checkout.session.async_payment_${outcome}`;
      expect((await send(eventType, "evt_outcome")).status).toBe(200);
      expect((await send(eventType, "evt_outcome")).status).toBe(200);
      // A late completed notification must use today's provider state, not resurrect processing.
      expect(
        (await send("checkout.session.completed", "evt_late_complete")).status,
      ).toBe(200);
      const view = await f.runtime.payments.view("booking-a", alice);
      expect((await f.runtime.payments.attempt(checkout.id)).status).toBe(
        outcome,
      );
      expect(view.balances[0]).toMatchObject({
        status: "unpaid",
        receivedCents: 0,
      });
      expect(view.balances[1]).toMatchObject({
        status: paid ? "paid" : "unpaid",
        receivedCents: paid ? 3000 : 0,
      });
      expect(view.history).toHaveLength(paid ? 1 : 0);
    },
  );
});
