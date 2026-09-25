// Synthetic, local-only workload. No real provider credentials, emails or payments.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, loadConfig } from "../../platform/node/runtime";
import { createNodeApp } from "../../platform/node/app";

export type ListSize = {
  clients: number;
  services: number;
  bookings: number;
  pets: number;
  payments: number;
  refunds: number;
  history: number;
};
export const smallLists: ListSize = {
  clients: 620,
  services: 820,
  bookings: 620,
  pets: 120,
  payments: 620,
  refunds: 75,
  history: 620,
};
export const key = (kind: string, i: number) =>
  `${kind}-${String(i).padStart(6, "0")}`;
export function largeListFixture(
  origin = "http://localhost:3360",
  size = smallLists,
) {
  const data = mkdtempSync(join(tmpdir(), "boopity-large-lists-"));
  const config = loadConfig({
    DATA_DIR: data,
    APP_URL: origin,
    HOST: "127.0.0.1",
    PORT: new URL(origin).port,
    TRUSTED_PROXY_IPS: "127.0.0.1,::1,::ffff:127.0.0.1",
  });
  const runtime = createRuntime(config, {
    EMAIL_FROM: "hello@example.test",
    EMAIL_DELIVERY_MODE: "live",
  });
  const codes = new Map<string, string>();
  runtime.env.MAIL_TRANSPORT = {
    idempotent: false,
    async send(message) {
      if (
        ![
          "owner@example.test",
          "alice@example.test",
          "bob@example.test",
        ].includes(message.to)
      )
        throw new Error("Synthetic recipients only");
      const code = message.html.match(/<strong>(\d{6})<\/strong>/)?.[1];
      if (!code) throw new Error("Synthetic OTP mail only");
      codes.set(message.to, code);
      return "local-only";
    },
  };
  const db = runtime.db.connection;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES
      ('owner','Sitter','owner@example.test',1,0,0),('alice','Alice','alice@example.test',1,0,0),('bob','Bob','bob@example.test',1,0,0);
      INSERT INTO business_memberships(user_id,role) VALUES('owner','owner');
      INSERT INTO sitter_profiles(id,user_id,business_name,time_zone,created_at,updated_at) VALUES('business','owner','Maple & Paws','America/New_York',0,0);
      UPDATE installation SET setup_state='ready',business_name='Maple & Paws',primary_color='#285943';
      UPDATE booking_policy SET config=json_set(config,'$.portalEnabled',json('true'));`);
    const client = db.prepare(
      "INSERT INTO clients(id,sitter_id,first_name,last_name,email,phone,notes,status,created_at,updated_at) VALUES(?,'business','Client',?,?,'','PRIVATE CLIENT NOTE','active',?,0)",
    );
    const pet = db.prepare(
      "INSERT INTO pets(id,client_id,name,species,medical_conditions,created_at,updated_at) VALUES(?,?,?,'dog','PRIVATE MEDICAL NOTE',0,0)",
    );
    for (let i = 0; i < size.clients; i++) {
      client.run(
        key("client", i),
        String(i).padStart(6, "0"),
        i === 0
          ? "alice@example.test"
          : i === 1
            ? "bob@example.test"
            : `synthetic${i}@example.test`,
        Math.floor(i / 3),
      );
      pet.run(
        key("pet", i),
        key("client", i),
        `Companion ${String(i).padStart(6, "0")}`,
      );
    }
    for (let i = 0; i < size.pets; i++)
      pet.run(
        key("extra-pet", i),
        key("client", 0),
        `Extra ${String(i).padStart(6, "0")}`,
      );
    db.exec(
      `INSERT INTO business_memberships(user_id,role,client_id) VALUES('alice','client','${key("client", 0)}'),('bob','client','${key("client", 1)}');`,
    );
    const service = db.prepare(
      "INSERT INTO services(id,sitter_id,name,description,duration_minutes,price_cents,additional_pet_price_cents,portal_visible,created_at,updated_at) VALUES(?,'business',?,'PRIVATE DESCRIPTION',30,100000,0,?,0,0)",
    );
    for (let i = 0; i < size.services; i++)
      service.run(
        key("service", i),
        `Service ${String(i).padStart(6, "0")}`,
        i % 3 !== 0 ? 1 : 0,
      );
    const booking =
      db.prepare(`INSERT INTO bookings(id,sitter_id,client_id,service_id,service_name,status,start_at,end_at,start_date,end_date,total_amount_cents,notes,created_at,updated_at,price_snapshot,policy_snapshot)
      VALUES(?,'business',?,?,?, ?,?,?,?,?,100000,'PRIVATE BOOKING NOTE',0,0,'{"currency":"USD"}','{"timeZone":"America/New_York","cancelHours":24}')`);
    const bp = db.prepare(
      "INSERT INTO booking_pets(booking_id,pet_id) VALUES(?,?)",
    );
    const followup = db.prepare(
      "INSERT INTO booking_financial_followups(booking_id,reason,created_at,resolved_at,resolution) VALUES(?,'Synthetic cancellation',?,?,'')",
    );
    for (let i = 0; i < size.bookings; i++) {
      const start = Date.UTC(2030, 0, 1) + Math.floor(i / 3) * 3_600_000,
        date = new Date(start).toISOString().slice(0, 10);
      booking.run(
        key("booking", i),
        key("client", i % 2),
        key("service", i % size.services),
        `Visit ${String(i).padStart(6, "0")}`,
        i % 5 === 0 ? "cancelled" : "completed",
        start,
        start + 1_800_000,
        date,
        date,
      );
      bp.run(key("booking", i), key("pet", i % 2));
      followup.run(key("booking", i), Math.floor(i / 3), i % 2 ? 1 : null);
    }
    const history = db.prepare(
      "INSERT INTO booking_history(id,booking_id,actor_role,event,reason,created_at) VALUES(?,?,'owner','notes-updated','Shared synthetic history',?)",
    );
    for (let i = 0; i < size.history; i++)
      history.run(key("event", i), key("booking", 0), Math.floor(i / 3));
    const attempt =
      db.prepare(`INSERT INTO payment_attempts(id,booking_id,provider,mode,amount_cents,currency,status,request_payload,request_key,request_digest,actor_id,method,note,created_at,updated_at)
      VALUES(?,?,'manual','live',1,'USD','succeeded','{}',?,'synthetic','owner','cash','PRIVATE PAYMENT NOTE',?,0)`);
    const entry = db.prepare(
      "INSERT INTO payment_allocations(id,booking_id,attempt_id,mode,kind,cents,currency,source_key,actor_id,note,created_at) VALUES(?,?,?,'live','receipt',1,'USD',?,'owner','PRIVATE ACCOUNTING NOTE',?)",
    );
    for (let i = 0; i < size.payments; i++) {
      attempt.run(
        key("attempt", i),
        key("booking", 0),
        key("request", i),
        Math.floor(i / 3),
      );
      entry.run(
        key("entry", i),
        key("booking", 0),
        key("attempt", i),
        key("source", i),
        Math.floor(i / 3),
      );
    }
    const refund = db.prepare(
      "INSERT INTO payment_refunds(id,attempt_id,amount_cents,status,note,created_at,updated_at) VALUES(?,?,1,'failed','PRIVATE REFUND NOTE',?,0)",
    );
    for (let i = 0; i < size.refunds; i++)
      refund.run(
        key("refund", i),
        key("attempt", size.payments - 1),
        Math.floor(i / 3),
      );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    runtime.close();
    rmSync(data, { recursive: true, force: true });
    throw error;
  }
  const app = createNodeApp(runtime.env, config, runtime.control);
  let sequence = 0;
  const cookies = new Map<string, string>();
  const request = (role: string, path: string, extra: RequestInit = {}) =>
    app.request(origin + path, {
      ...extra,
      headers: {
        origin,
        "content-type": "application/json",
        cookie: cookies.get(role) ?? "",
        "cf-connecting-ip": `192.0.2.${(Math.floor(sequence++ / 80) % 250) + 1}`,
        ...extra.headers,
      },
    });
  let closed = false;
  return {
    app,
    runtime,
    config,
    data,
    codes,
    size,
    cookies,
    request,
    async login(role: "owner" | "alice" | "bob") {
      const email = `${role}@example.test`;
      const send = await request(
        role,
        "/api/auth/email-otp/send-verification-otp",
        { method: "POST", body: JSON.stringify({ email, type: "sign-in" }) },
      );
      if (!send.ok) throw new Error("Synthetic sign-in code failed");
      const response = await request(role, "/api/auth/sign-in/email-otp", {
        method: "POST",
        body: JSON.stringify({ email, otp: codes.get(email) }),
      });
      if (!response.ok) throw new Error("Synthetic sign-in failed");
      cookies.set(
        role,
        response.headers
          .getSetCookie()
          .map((row) => row.split(";", 1)[0])
          .join("; "),
      );
    },
    close() {
      if (!closed) {
        runtime.close();
        closed = true;
        rmSync(data, { recursive: true, force: true });
      }
    },
  };
}
