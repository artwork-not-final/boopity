import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, loadConfig } from "../../server/runtime/runtime";
import { createNodeApp } from "../../server/runtime/app";
import { PaymentService } from "../../server/payments/service";
import type {
  CheckoutInput,
  CheckoutState,
  Integration,
  PaymentProvider,
  ProviderEvent,
} from "../../server/payments/provider";
import type { PaymentActor } from "../../server/payments/ledger";
import type { PaymentMode } from "../../src/shared/payments";

export const owner: PaymentActor = {
  id: "owner",
  role: "owner",
  sitterId: "business",
  clientId: null,
};
export const alice: PaymentActor = {
  id: "alice",
  role: "client",
  sitterId: "business",
  clientId: "a",
};
export const bob: PaymentActor = {
  id: "bob",
  role: "client",
  sitterId: "business",
  clientId: "b",
};
export const origin = "http://localhost:3000";
export const manual = (amountCents = 1000) => ({
  requestId: crypto.randomUUID(),
  amountCents,
  method: "cash",
  note: "PRIVATE CASH NOTE",
});
export class FakePayments implements PaymentProvider {
  readonly capabilities = { checkout: true, refunds: true, expire: true };
  readonly sessions = new Map<string, CheckoutState>();
  calls = { create: 0, inspect: 0, refund: 0, expire: 0 };
  loseCreateResponse = false;
  loseRefundResponse = false;
  failBeforeRefund = false;
  afterCreate?: () => Promise<void>;
  constructor(readonly mode: PaymentMode) {}
  async verify() {
    return { accountId: "acct_synthetic", mode: this.mode };
  }
  async createCheckout(input: CheckoutInput) {
    this.calls.create++;
    const id = `cs_${input.attemptId}`;
    if (!this.sessions.has(id))
      this.sessions.set(id, {
        id,
        paymentRef: null,
        url: `https://checkout.stripe.com/c/pay/${id}`,
        status: "open",
        amountCents: input.amountCents,
        currency: input.currency,
        mode: this.mode,
        attemptId: input.attemptId,
        integrationId: input.integrationId,
        refunds: [],
        disputed: false,
      });
    await this.afterCreate?.();
    if (this.loseCreateResponse) throw new Error("Synthetic lost response");
    return structuredClone(this.sessions.get(id)!);
  }
  async inspectCheckout(id: string) {
    this.calls.inspect++;
    const s = this.sessions.get(id);
    if (!s) throw new Error("Unknown synthetic checkout");
    return structuredClone(s);
  }
  async expireCheckout(id: string) {
    this.calls.expire++;
    this.sessions.get(id)!.status = "expired";
    this.sessions.get(id)!.url = null;
  }
  async refund(paymentRef: string, amountCents: number, refundId: string) {
    this.calls.refund++;
    if (this.failBeforeRefund)
      throw new Error("Synthetic request did not arrive");
    const s = [...this.sessions.values()].find(
      (s) => s.paymentRef === paymentRef,
    )!;
    if (!s.refunds.some((r) => r.id === `re_${refundId}`))
      s.refunds.push({
        id: `re_${refundId}`,
        localId: refundId,
        amountCents,
        status: "pending",
      });
    if (this.loseRefundResponse)
      throw new Error("Synthetic refund response lost");
  }
  async verifyEvent(raw: string, signature: string): Promise<ProviderEvent> {
    if (signature !== "local-verified") throw new Error("Invalid");
    return JSON.parse(raw);
  }
  async findAttempt(paymentRef: string) {
    return (
      [...this.sessions.values()].find((s) => s.paymentRef === paymentRef)
        ?.attemptId ?? null
    );
  }
  paid(id?: string) {
    const s = id ? this.sessions.get(id)! : [...this.sessions.values()][0];
    s.status = "succeeded";
    s.paymentRef = `pi_${s.attemptId}`;
    s.url = null;
    return s;
  }
}
export function paymentFixture() {
  const data = mkdtempSync(join(tmpdir(), "boopity-payments-")),
    config = loadConfig({ APP_URL: origin, DATA_DIR: data });
  const runtime = createRuntime(config, {
      EMAIL_FROM: "hello@example.test",
      EMAIL_DELIVERY_MODE: "live",
    }),
    codes = new Map<string, string>();
  runtime.env.MAIL_TRANSPORT = {
    idempotent: false,
    async send(message) {
      if (!message.to.endsWith("@example.test"))
        throw new Error("Synthetic inboxes only");
      codes.set(
        message.to,
        message.html.match(/<strong>(\d{6})<\/strong>/)![1],
      );
      return "synthetic";
    },
  };
  runtime.db.connection
    .exec(`INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES
    ('owner','Sitter','owner@example.test',1,0,0),('alice','Alice','alice@example.test',1,0,0),('bob','Bob','bob@example.test',1,0,0);
    INSERT INTO business_memberships(user_id,role) VALUES('owner','owner');
    INSERT INTO sitter_profiles(id,user_id,business_name,time_zone,created_at,updated_at) VALUES('business','owner','Maple care','America/New_York',0,0);
    UPDATE installation SET setup_state='ready';
    UPDATE booking_policy SET config=json_set(config,'$.portalEnabled',json('true'));
    INSERT INTO clients(id,sitter_id,first_name,last_name,email,status,created_at,updated_at) VALUES
      ('a','business','Alice','Able','alice@example.test','active',0,0),('b','business','Bob','Baker','bob@example.test','active',0,0);
    INSERT INTO business_memberships(user_id,role,client_id) VALUES('alice','client','a'),('bob','client','b');
    INSERT INTO bookings(id,sitter_id,client_id,service_name,start_at,end_at,start_date,end_date,total_amount_cents,created_at,updated_at,price_snapshot,policy_snapshot)
      VALUES('booking-a','business','a','Dog visit',9999999999000,9999999999999,'2026-09-15','2026-09-15',3000,0,0,'{"currency":"USD"}','{"cancelHours":24,"timeZone":"America/New_York"}'),
      ('booking-b','business','b','Cat visit',9999999999000,9999999999999,'2026-09-16','2026-09-16',5000,0,0,'{"currency":"EUR"}','{"cancelHours":24,"timeZone":"America/New_York"}');
    INSERT INTO payment_integrations(id,provider,mode,ciphertext,enabled,account_id) VALUES
      ('integration-test','stripe','test','synthetic-only',1,'acct_synthetic'),('integration-live','stripe','live','synthetic-only',1,'acct_synthetic');`);
  const test = new FakePayments("test"),
    live = new FakePayments("live"),
    map = new Map<PaymentMode, Integration>([
      [
        "test",
        {
          id: "integration-test",
          provider: "stripe",
          mode: "test",
          version: 1,
          enabled: true,
          verified: true,
          webhookVerified: true,
          accountId: "acct_synthetic",
          adapter: test,
        },
      ],
      [
        "live",
        {
          id: "integration-live",
          provider: "stripe",
          mode: "live",
          version: 1,
          enabled: true,
          verified: true,
          webhookVerified: true,
          accountId: "acct_synthetic",
          adapter: live,
        },
      ],
    ]);
  const integrations = {
    async get(mode: PaymentMode) {
      return map.get(mode) ?? null;
    },
    async webhookSeen() {},
  };
  const service = new PaymentService(
      runtime.db,
      runtime.env.BETTER_AUTH_SECRET,
      integrations,
      origin,
    ),
    app = createNodeApp(runtime.env, config, runtime.control, service);
  let seq = 0;
  function browser() {
    const cookies = new Map<string, string>();
    const req = async (
      path: string,
      method = "GET",
      body?: unknown,
      extra: Record<string, string> = {},
    ) => {
      const response = await app.request(origin + path, {
        method,
        headers: {
          origin,
          "content-type": "application/json",
          "cf-connecting-ip": `192.0.2.${(++seq % 250) + 1}`,
          cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
          ...extra,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(";", 1)[0],
          split = pair.indexOf("=");
        cookies.set(pair.slice(0, split), pair.slice(split + 1));
      }
      return response;
    };
    return {
      req,
      cookies,
      async login(email: string) {
        let response = await req(
          "/api/auth/email-otp/send-verification-otp",
          "POST",
          { email, type: "sign-in" },
        );
        if (response.status !== 200) throw new Error(await response.text());
        response = await req("/api/auth/sign-in/email-otp", "POST", {
          email,
          otp: codes.get(email),
        });
        if (response.status !== 200) throw new Error(await response.text());
      },
    };
  }
  return {
    data,
    runtime,
    config,
    db: runtime.db,
    service,
    test,
    live,
    map,
    integrations,
    app,
    browser,
    close() {
      runtime.close();
      rmSync(data, { recursive: true, force: true });
    },
  };
}
