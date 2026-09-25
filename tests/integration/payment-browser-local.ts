// Disposable loopback browser fixture. Never use real credentials or expose this server remotely.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import {
  createRuntime,
  ingressRequest,
  loadConfig,
} from "../../platform/node/runtime";
import { createNodeApp } from "../../platform/node/app";
import { PaymentService } from "../../platform/payments/service";
import type { PaymentActor } from "../../platform/payments/ledger";
import {
  invitationDigest,
  randomInvite,
} from "../../platform/business/invitations";

globalThis.fetch = async () => {
  throw new Error(
    "External providers are blocked in this synthetic browser fixture",
  );
};
const data = mkdtempSync(join(tmpdir(), "boopity-payment-browser-"));
const config = loadConfig({
  APP_URL: "http://localhost:3334",
  HOST: "127.0.0.1",
  PORT: "3334",
  DATA_DIR: data,
});
const runtime = createRuntime(config, {
  EMAIL_FROM: "hello@example.test",
  EMAIL_DELIVERY_MODE: "live",
});
const messages: { to: string; code: string }[] = [];
runtime.env.MAIL_TRANSPORT = {
  idempotent: false,
  async send(message) {
    if (!["owner@example.test", "alice@example.test"].includes(message.to))
      throw new Error("Synthetic inboxes only");
    const code = message.html.match(/<strong>(\d{6})<\/strong>/)?.[1];
    if (!code) throw new Error("Only synthetic sign-in codes are supported");
    messages.push({ to: message.to, code });
    return "synthetic-local-only";
  },
};
runtime.db.connection
  .exec(`INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES
  ('qa-owner','Maple Owner','owner@example.test',1,0,0),('qa-alice','Alice Able','alice@example.test',1,0,0);
  INSERT INTO business_memberships(user_id,role) VALUES ('qa-owner','owner');
  INSERT INTO sitter_profiles(id,user_id,business_name,time_zone,created_at,updated_at) VALUES ('qa-business','qa-owner','Maple & Paws','America/New_York',0,0);
  UPDATE installation SET setup_state='ready',business_name='Maple & Paws',primary_color='#285943',accent_color='#c5dec8';
  UPDATE booking_policy SET config=json_set(config,'$.portalEnabled',json('true'));
  INSERT INTO clients(id,sitter_id,first_name,last_name,email,notes,status,created_at,updated_at) VALUES ('qa-household','qa-business','Alice','Able','alice@example.test','PRIVATE HOUSEHOLD NOTE','active',0,0);
  INSERT INTO business_memberships(user_id,role,client_id) VALUES ('qa-alice','client','qa-household');
  INSERT INTO pets(id,client_id,name,species,created_at,updated_at) VALUES ('qa-pet','qa-household','Juniper','dog',0,0);
  INSERT INTO bookings(id,sitter_id,client_id,service_name,start_at,end_at,start_date,end_date,start_time,end_time,total_amount_cents,created_at,updated_at,price_snapshot,policy_snapshot)
    VALUES('qa-visit','qa-business','qa-household','Dog visit',1789488000000,1789489800000,'2026-09-15','2026-09-15','12:00','12:30',3000,0,0,'{"currency":"USD","units":1,"unitCents":3000}','{"cancelHours":24,"timeZone":"America/New_York"}');
  INSERT INTO booking_pets(booking_id,pet_id) VALUES ('qa-visit','qa-pet');`);
let invitationUrl: string | undefined;
if (process.argv.includes("--invitation")) {
  const token = randomInvite();
  runtime.db.connection
    .prepare(
      "UPDATE business_memberships SET revoked_at=? WHERE user_id='qa-alice'",
    )
    .run(Date.now());
  runtime.db.connection
    .prepare(
      `INSERT INTO client_invitations
    (id,client_id,email,digest,expires_at,created_at)
    VALUES ('qa-invitation','qa-household','alice@example.test',?,?,?)`,
    )
    .run(
      await invitationDigest(runtime.env.BETTER_AUTH_SECRET, token),
      Date.now() + 3_600_000,
      Date.now(),
    );
  invitationUrl = `${config.appUrl}/login#invite=${token}`;
}
// Optional services for approved past-booking checks; all data stays disposable.
if (process.argv.includes("--past-bookings")) {
  runtime.db.connection.exec(`
    INSERT INTO services(id,sitter_id,name,duration_minutes,price_cents,additional_pet_price_cents,portal_visible,created_at,updated_at)
      VALUES ('qa-walk','qa-business','Dog walk',30,3000,1000,1,0,0),('qa-stay','qa-business','Pet sitting',NULL,8000,2000,1,0,0);
    UPDATE booking_policy SET config=json_set(config,'$.weekly',json('[{"day":1,"start":"09:00","end":"17:00"}]'),'$.blockedDates',json('["2025-09-01"]'));
  `);
}
// Optional read-only activity-page checks. Manual operations affect this
// throwaway database only; sandbox entries are synthetic, not Stripe calls.
if (process.argv.includes("--payment-records")) {
  runtime.db.connection.exec(`
    INSERT INTO clients(id,sitter_id,first_name,last_name,email,status,created_at,updated_at)
      VALUES ('qa-bob','qa-business','Bob','Baker','bob@example.test','active',0,0);
    INSERT INTO bookings(id,sitter_id,client_id,service_name,start_at,end_at,start_date,end_date,total_amount_cents,created_at,updated_at,price_snapshot,policy_snapshot)
      VALUES ('qa-stay','qa-business','qa-bob','Pet sitting',1789488000000,1789489800000,'2026-09-15','2026-09-15',8000,0,0,'{"currency":"USD"}','{"timeZone":"America/New_York"}');
  `);
  const payments = new PaymentService(
    runtime.db,
    runtime.env.BETTER_AUTH_SECRET,
    {
      async get() {
        return null;
      },
      async webhookSeen() {},
    },
    config.appUrl,
  );
  const owner: PaymentActor = {
    id: "qa-owner",
    role: "owner",
    sitterId: "qa-business",
    clientId: null,
  };
  let first = "";
  for (let i = 0; i < 14; i++) {
    const id = await payments.manual("qa-visit", owner, {
      requestId: crypto.randomUUID(),
      amountCents: 100,
      method: "cash",
    });
    if (!first) first = id;
  }
  await payments.voidManual(first, owner, "Synthetic correction");
  const paid = await payments.manual("qa-stay", owner, {
    requestId: crypto.randomUUID(),
    amountCents: 2000,
    method: "zelle",
  });
  await payments.refund(paid, owner, {
    requestId: crypto.randomUUID(),
    amountCents: 500,
    note: "Synthetic returned refund",
    confirm: true,
  });
  const timestamp = Date.now();
  runtime.db.connection
    .prepare(
      `INSERT INTO payment_attempts
    (id,booking_id,provider,mode,amount_cents,currency,status,request_payload,request_key,request_digest,actor_id,method,created_at,updated_at)
    VALUES ('qa-test-paid','qa-visit','stripe','test',2500,'USD','succeeded','{}','qa-test-paid','synthetic','qa-owner','online',?,?),
      ('qa-test-open','qa-stay','stripe','test',8000,'USD','open','{}','qa-test-open','synthetic','qa-owner','online',?,?)`,
    )
    .run(timestamp, timestamp, timestamp, timestamp);
  runtime.db.connection
    .prepare(
      `INSERT INTO payment_allocations
    (id,booking_id,attempt_id,mode,kind,cents,currency,source_key,created_at)
    VALUES ('qa-test-receipt','qa-visit','qa-test-paid','test','receipt',2500,'USD','receipt:qa-test-paid',?)`,
    )
    .run(timestamp);
}
// Render the exact packaged UI with extreme saved colors; no native-picker
// automation or production settings are involved in this opt-in fixture.
if (process.argv.includes("--contrast")) {
  runtime.db.connection.exec(
    "UPDATE installation SET primary_color='#ffffff',accent_color='#000000'",
  );
}
const app = createNodeApp(runtime.env, config, runtime.control);
const server = serve({
  hostname: config.host,
  port: config.port,
  fetch(request, connection) {
    const normalized = ingressRequest(
      request,
      config,
      connection.incoming.socket.remoteAddress ?? "unknown",
    );
    if (!normalized) return new Response("Wrong host", { status: 421 });
    if (
      new URL(normalized.url).pathname === "/__qa_inbox" &&
      request.method === "GET"
    ) {
      return new Response(
        `<!doctype html><title>Synthetic payment QA inbox</title><h1>Local synthetic inbox</h1><p>No emails or provider requests leave this computer.</p><ul>${messages
          .slice(-10)
          .map((m) => `<li>${m.to}: <strong>${m.code}</strong></li>`)
          .join("")}</ul>`,
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "content-security-policy":
              "default-src 'none'; frame-ancestors 'none'",
            "referrer-policy": "no-referrer",
          },
        },
      );
    }
    return app.fetch(normalized);
  },
});
console.log(
  JSON.stringify({
    app: config.appUrl + "/app/bookings/qa-visit/payments",
    invitationUrl,
    inbox: config.appUrl + "/__qa_inbox",
    owner: "owner@example.test",
    client: "alice@example.test",
    data,
    realEmailsSent: 0,
    providerNetwork: "blocked",
  }),
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    runtime.close();
    rmSync(data, { recursive: true, force: true });
  });
  if ("closeIdleConnections" in server) server.closeIdleConnections();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
