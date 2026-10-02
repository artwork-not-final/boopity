// Compiled CLI integration; all state is synthetic and removed afterwards. No network calls.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const directory = mkdtempSync(join(tmpdir(), "boopity-management-"));
const environment = {
  PATH: process.env.PATH,
  APP_URL: "http://localhost:3000",
  DATA_DIR: directory,
  NODE_NO_WARNINGS: "1",
};
const run = (...args) =>
  execFileSync(process.execPath, ["dist/server/manage.mjs", ...args], {
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const handoff = () =>
  execFileSync(process.execPath, ["scripts/install/setup-entry.mjs"], {
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const tokenFrom = (output) => {
  const token = output.trim().split("\n").at(-1);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  return token;
};
let db;
try {
  assert.equal(JSON.parse(run("status")).ownerClaimed, false);
  db = new DatabaseSync(join(directory, "boopity.sqlite"));
  const setupToken = tokenFrom(run("setup-token"));
  assert.equal(
    db.prepare("SELECT digest FROM operator_tokens WHERE kind='setup'").get()
      .digest,
    createHash("sha256").update(setupToken).digest("hex"),
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM operator_token_history").get().n,
    1,
  );
  const link = new URL(run("setup-link").trim().split("\n").at(-1));
  assert.equal(link.origin, environment.APP_URL);
  assert.equal(link.pathname, "/setup");
  assert.equal(link.search, "");
  const linkToken = new URLSearchParams(link.hash.slice(1)).get("setup");
  assert.match(linkToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(linkToken, setupToken);
  assert.equal(
    db.prepare("SELECT digest FROM operator_tokens WHERE kind='setup'").get()
      .digest,
    createHash("sha256").update(linkToken).digest("hex"),
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user").get().n, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM operator_sessions").get().n,
    0,
  );
  const launcherLink = new URL(handoff());
  assert.equal(launcherLink.origin, environment.APP_URL);
  assert.equal(launcherLink.pathname, "/setup");
  assert.equal(launcherLink.search, "");
  const launcherToken = new URLSearchParams(launcherLink.hash.slice(1)).get(
    "setup",
  );
  assert.match(launcherToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(launcherToken, linkToken);
  assert.equal(
    db.prepare("SELECT digest FROM operator_tokens WHERE kind='setup'").get()
      .digest,
    createHash("sha256").update(launcherToken).digest("hex"),
  );
  db.exec(`INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('owner','Synthetic owner','owner@example.test',1,0,0);
    INSERT INTO business_memberships(user_id,role) VALUES ('owner','owner');
    INSERT INTO sitter_profiles(id,user_id,business_name,time_zone,created_at,updated_at) VALUES ('business','owner','Synthetic care','Europe/London',0,0);
    INSERT INTO session(id,user_id,token,expires_at,created_at,updated_at) VALUES ('synthetic-session','owner','synthetic-cookie-token',9999999999999,0,0);
    INSERT INTO account(id,account_id,provider_id,issuer,user_id,created_at,updated_at) VALUES ('synthetic-google','synthetic-google','google','','owner',0,0);
    INSERT INTO verification(id,identifier,value,expires_at,created_at,updated_at) VALUES ('synthetic-code','synthetic-code','hashed-test-only',9999999999999,0,0);`);
  assert.throws(() => run("setup-token"));
  assert.throws(() => run("setup-link"));
  const issued = db
    .prepare("SELECT COUNT(*) AS n FROM operator_token_history")
    .get().n;
  assert.equal(handoff(), environment.APP_URL + "/app");
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM operator_token_history").get().n,
    issued,
  );
  const recoveryToken = tokenFrom(run("recovery-token"));
  assert.notEqual(recoveryToken, setupToken);
  run("set-owner-email", "replacement@example.test");
  assert.deepEqual(
    { ...db.prepare("SELECT id,email,email_verified FROM user").get() },
    { id: "owner", email: "replacement@example.test", email_verified: 0 },
  );
  assert.equal(
    db
      .prepare("SELECT user_id FROM business_memberships WHERE role='owner'")
      .get().user_id,
    "owner",
  );
  assert.equal(
    db.prepare("SELECT id FROM sitter_profiles").get().id,
    "business",
  );
  for (const table of [
    "session",
    "account",
    "verification",
    "operator_tokens",
    "operator_sessions",
  ])
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  assert.equal(JSON.parse(run("status")).ownerClaimed, true);
  assert(tokenFrom(run("recovery-token")));
  for (const filename of ["auth-secret", "settings-key", "boopity.sqlite"])
    assert.equal(statSync(join(directory, filename)).mode & 0o777, 0o600);
  console.log(
    "Compiled management CLI passed: installer handoff, private setup link, setup/recovery tokens, preserved ownership, recovered email, session/Google revocation, private key permissions. No tokens printed or emails sent by this test.",
  );
} catch {
  console.error(
    "Management checks failed; private command output was withheld.",
  );
  process.exitCode = 1;
} finally {
  db?.close();
  rmSync(directory, { recursive: true, force: true });
}
