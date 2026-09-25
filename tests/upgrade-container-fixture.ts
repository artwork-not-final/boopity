// Bundled against EACH source version by the opt-in container rehearsal.
// Never point this fixture at an installation outside its generated QA volume.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRuntime, loadConfig } from "../platform/node/runtime";
import { emptyProviders } from "../src/shared/setup";

assert.equal(process.env.BOOPITY_CONTAINER_QA, "upgrade-disposable");
assert.equal(process.env.DATA_DIR, "/data");
assert.notEqual(process.getuid?.(), 0);
const mode = process.argv[2];
assert(["seed", "verify", "mutate"].includes(mode));
globalThis.fetch = async () => {
  throw new Error("Provider calls prohibited in offline QA");
};
const runtime = createRuntime(loadConfig({ DATA_DIR: "/data" }), {});
const connection = runtime.db.connection;
const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const providers = {
  ...structuredClone(emptyProviders),
  email: {
    ...emptyProviders.email,
    provider: "resend" as const,
    from: "owner@example.test",
    apiKey: "synthetic-upgrade-email-credential",
  },
  google: {
    enabled: true,
    clientId: "synthetic.apps.googleusercontent.com",
    clientSecret: "synthetic-upgrade-google-credential",
  },
};
const tables = [
  "user",
  "business_memberships",
  "sitter_profiles",
  "clients",
  "pets",
  "sitter_pet_notes",
  "services",
  "booking_pets",
  "bookings",
  "booking_policy",
  "booking_history",
  "booking_financial_followups",
  "installation",
  "installation_secrets",
  "setup_progress",
  "installation_audit",
  "payment_settings",
  "payment_attempts",
  "payment_refunds",
  "payment_allocations",
  "payment_audit",
  "boopity_migrations",
];
async function snapshot() {
  const stored = await runtime.control.stored();
  assert.deepEqual(stored.config, providers);
  assert(!stored.ciphertext.includes(providers.email.apiKey));
  assert(!stored.ciphertext.includes(providers.google.clientSecret));
  assert.equal((await runtime.control.owner())?.id, "qa-owner");
  assert.deepEqual(
    connection
      .prepare("PRAGMA quick_check")
      .all()
      .map((row) => ({ ...row })),
    [{ quick_check: "ok" }],
  );
  assert.deepEqual(connection.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(
    connection
      .prepare("SELECT SUM(cents) AS cents FROM payment_allocations")
      .get()?.cents,
    2200,
  );
  assert.throws(
    () => connection.exec("UPDATE payment_allocations SET cents=999"),
    /immutable/,
  );
  assert.throws(
    () => connection.exec("DELETE FROM payment_audit"),
    /immutable/,
  );
  for (const name of ["auth-secret", "settings-key", "boopity.sqlite"])
    assert.equal(statSync(join("/data", name)).mode & 0o777, 0o600);
  for (const [key, value] of [
    ["qa/logo", "synthetic-logo"],
    ["qa/private-pet-record", "synthetic-private-pet-record"],
  ])
    assert.equal(
      await new Response((await runtime.env.UPLOADS.get(key))!.body).text(),
      value,
    );
  return {
    tables: Object.fromEntries(
      tables.map((table) => [
        table,
        hash(
          JSON.stringify(
            connection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
          ),
        ),
      ]),
    ),
    keys: ["auth-secret", "settings-key"].map((name) =>
      hash(readFileSync(join("/data", name))),
    ),
    uploads: readdirSync("/data/uploads")
      .sort()
      .map((name) => {
        assert.equal(statSync(join("/data/uploads", name)).mode & 0o777, 0o600);
        return [name, hash(readFileSync(join("/data/uploads", name)))];
      }),
  };
}
try {
  if (mode === "seed") {
    assert.equal(
      connection.prepare("SELECT COUNT(*) AS n FROM user").get()?.n,
      0,
    );
    connection.exec(`
      INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES
        ('qa-owner','Synthetic owner','owner@example.test',1,0,0),
        ('qa-client-user','Synthetic client','client@example.test',1,0,0);
      INSERT INTO sitter_profiles(id,user_id,business_name,created_at,updated_at) VALUES('qa-business','qa-owner','Maple QA',0,0);
      INSERT INTO clients(id,sitter_id,first_name,last_name,email,notes,created_at,updated_at)
        VALUES('qa-client','qa-business','Synthetic','Client','client@example.test','Private synthetic client note',0,0);
      INSERT INTO business_memberships(user_id,role,client_id) VALUES('qa-owner','owner',NULL),('qa-client-user','client','qa-client');
      INSERT INTO pets(id,client_id,name,photo_object_key,feeding_instructions,created_at,updated_at)
        VALUES('qa-pet','qa-client','Synthetic Nori','qa/private-pet-record','Synthetic feeding instructions',0,0);
      INSERT INTO sitter_pet_notes(id,sitter_id,pet_id,notes,created_at,updated_at)
        VALUES('qa-note','qa-business','qa-pet','Private synthetic sitter note',0,0);
      INSERT INTO services(id,sitter_id,name,price_cents,portal_visible,created_at,updated_at)
        VALUES('qa-service','qa-business','Synthetic visit',2500,1,0,0);
      INSERT INTO bookings(id,sitter_id,client_id,service_id,service_name,status,start_at,end_at,start_date,end_date,total_amount_cents,created_at,updated_at,price_snapshot,policy_snapshot)
        VALUES('qa-booking','qa-business','qa-client','qa-service','Synthetic visit','confirmed',1788278400000,1788282000000,'2026-09-01','2026-09-01',2500,0,0,'{"currency":"USD"}','{"cancelHours":24,"timeZone":"America/New_York"}');
      INSERT INTO booking_pets VALUES('qa-booking','qa-pet');
      INSERT INTO booking_history VALUES('qa-history','qa-booking','qa-owner','owner','created','Synthetic history',0);
      INSERT INTO payment_attempts(id,booking_id,provider,mode,amount_cents,currency,status,request_payload,request_key,request_digest,actor_id,method,created_at,updated_at)
        VALUES('qa-payment','qa-booking','manual','live',2500,'USD','succeeded','{}','qa-receipt','qa-digest','qa-owner','cash',0,0);
      INSERT INTO payment_refunds(id,attempt_id,amount_cents,status,applied_cents,actor_id,created_at,updated_at)
        VALUES('qa-refund','qa-payment',300,'succeeded',300,'qa-owner',0,0);
      INSERT INTO payment_allocations(id,booking_id,attempt_id,refund_id,mode,kind,cents,currency,source_key,actor_id,created_at) VALUES
        ('qa-receipt','qa-booking','qa-payment',NULL,'live','receipt',2500,'USD','qa-receipt','qa-owner',0),
        ('qa-refund-entry','qa-booking','qa-payment','qa-refund','live','refund',-300,'USD','qa-refund','qa-owner',0);
      INSERT INTO payment_audit VALUES('qa-audit','qa-booking','qa-payment','synthetic-payment-recorded','qa-owner',0);
      UPDATE installation SET setup_state='ready',business_name='Maple QA',primary_color='#285c49',logo_key='qa/logo',logo_type='image/png';
    `);
    await runtime.control.saveProviders(providers, 0, {
      kind: "owner",
      id: "qa-owner",
    });
    await runtime.env.UPLOADS.put("qa/logo", "synthetic-logo");
    await runtime.env.UPLOADS.put(
      "qa/private-pet-record",
      "synthetic-private-pet-record",
    );
    writeFileSync("/data/qa-snapshot.json", JSON.stringify(await snapshot()), {
      flag: "wx",
      mode: 0o600,
    });
  } else {
    assert.deepEqual(
      await snapshot(),
      JSON.parse(readFileSync("/data/qa-snapshot.json", "utf8")),
    );
    if (mode === "mutate") {
      // Prove rollback comes from the stopped backup, not a pointer to upgraded data.
      connection.exec(
        "UPDATE clients SET notes='Changed after upgrade' WHERE id='qa-client'",
      );
      assert.notDeepEqual(
        await snapshot(),
        JSON.parse(readFileSync("/data/qa-snapshot.json", "utf8")),
      );
    }
  }
  console.log(JSON.stringify({ passed: true, mode, tables: tables.length }));
} finally {
  runtime.close();
}
