// Local, network-isolated hosting-contract simulation. Never contacts a host or
// registry, publishes an image, sends mail, or opens a host port.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

assert.equal(process.env.BOOPITY_CONTAINER_QA, "hosting-disposable");
assert.equal(process.argv.length, 3, "Supply one locally built image");
const image = process.argv[2];
assert(
  image && /^[A-Za-z0-9][A-Za-z0-9:._/-]+$/.test(image),
  "Supply a locally built image",
);
const suffix = randomUUID(),
  volume = `boopity-hosting-qa-${suffix}`;
const container = `boopity-hosting-qa-${suffix}`,
  label = `org.boopity.hosting-qa=${suffix}`;
const password = randomBytes(32).toString("base64url");
const docker = (args, input) =>
  execFileSync("docker", args, {
    input,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 4 * 1024 * 1024,
    timeout: 60000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
const inspect = (kind, id) =>
  JSON.parse(docker([kind, "inspect", id]).toString())[0];
let createdVolume = false,
  createdContainer = false;
let stage = "inspect local image";
function start(id) {
  docker([
    "run",
    "--detach",
    "--pull=never",
    "--name",
    container,
    "--label",
    label,
    "--network",
    "none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--pids-limit=128",
    "--memory",
    "512m",
    "--cpus",
    "0.5",
    "--mount",
    `source=${volume},target=/data`,
    "--env",
    "APP_URL=https://pets.example.test",
    "--env",
    `BOOPITY_SETUP_PASSWORD=${password}`,
    id,
  ]);
  createdContainer = true;
}
function removeContainer() {
  assert.equal(
    inspect("container", container).Config.Labels["org.boopity.hosting-qa"],
    suffix,
  );
  docker(["stop", "--time", "15", container]);
  docker(["rm", container]);
  createdContainer = false;
}
const shared = `
import assert from "node:assert/strict";
import { request } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
const origin = process.env.APP_URL;
const fingerprints = () => ["auth-secret", "settings-key"].map(name => createHash("sha256").update(readFileSync("/data/" + name)).digest("hex"));
function call(path, method = "GET", body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: 3000, path, method, timeout: 4000,
      headers: { host: new URL(origin).host, origin, "content-type": "application/json", ...headers } }, response => {
      const chunks = []; response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout"))); req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
let ready = false;
for (let attempt = 0; attempt < 40; attempt++) {
  try { ready = (await call("/api/ready")).status === 200; } catch {}
  if (ready) break;
  await new Promise(resolve => setTimeout(resolve, 250));
}
assert(ready, "readiness");
assert.equal(process.getuid(), 1000);
for (const name of ["auth-secret", "settings-key", "boopity.sqlite"]) assert.equal(statSync("/data/" + name).mode & 0o777, 0o600);
`;
function run(source) {
  return docker(
    ["exec", "--interactive", container, "node", "--input-type=module"],
    shared + source,
  )
    .toString()
    .trim();
}
try {
  const info = inspect("image", image);
  assert(["arm64", "amd64"].includes(info.Architecture));
  assert.equal(info.Config.User, "node");
  // UUID resources are created only for this test and checked again before removal.
  stage = "create isolated fixture";
  docker(["volume", "create", "--label", label, volume]);
  createdVolume = true;
  start(info.Id);
  stage = "initial setup assertions";
  const original = run(`
    assert.equal((await call("/api/ready", "GET", undefined, { host: "evil.example" })).status, 421);
    for (let n = 0; n < 130; n++) assert.equal((await call("/api/ready")).status, 200);
    assert.equal((await call("/setup")).status, 200);
    assert.equal((await call("/api/setup/status")).status, 401);
    const installation = await call("/api/installation");
    assert.equal(JSON.parse(installation.text).ownerClaimed, false);
    assert(!installation.text.includes(process.env.BOOPITY_SETUP_PASSWORD));
    const entry = await call("/api/setup/entry");
    assert.equal(JSON.parse(entry.text).mode, "password");
    assert(!entry.text.includes(process.env.BOOPITY_SETUP_PASSWORD));
    const unlocked = await call("/api/setup/password/unlock", "POST", { password: process.env.BOOPITY_SETUP_PASSWORD });
    assert.equal(unlocked.status, 200);
    const cookie = unlocked.headers["set-cookie"][0];
    assert(cookie.includes("Secure") && cookie.includes("HttpOnly") && cookie.includes("SameSite=Strict"));
    const headers = { cookie: cookie.split(";")[0] };
    const status = await call("/api/setup/status", "GET", undefined, headers);
    assert.equal(JSON.parse(status.text).readiness.email, false);
    assert.equal((await call("/api/setup/identity", "POST", { name: "Maple QA", email: "owner@example.test" }, headers)).status, 200);
    console.log(JSON.stringify({ fingerprints: fingerprints(), cookie: headers.cookie }));
  `);
  const saved = JSON.parse(original);
  stage = "first compiled health probe";
  docker(["exec", container, "node", "dist/server/healthcheck.mjs"]);
  stage = "replace container";
  removeContainer();
  start(info.Id);
  stage = "persistence assertions";
  run(`
    assert.deepEqual(fingerprints(), ${JSON.stringify(saved.fingerprints)});
    const headers = { cookie: ${JSON.stringify(saved.cookie)} };
    const status = await call("/api/setup/status", "GET", undefined, headers);
    assert.equal(status.status, 200);
    assert.equal(JSON.parse(status.text).pending.name, "Maple QA");
    assert.equal(JSON.parse(status.text).pending.email, "owner@example.test");
    assert.equal(JSON.parse(status.text).readiness.email, false);
    assert.equal((await call("/api/setup/password/unlock", "POST", { password: "wrong synthetic setup password" })).status, 401);
    assert.equal((await call("/api/setup/password/unlock", "POST", { password: process.env.BOOPITY_SETUP_PASSWORD })).status, 200);
  `);
  stage = "second compiled health probe";
  docker(["exec", container, "node", "dist/server/healthcheck.mjs"]);
  assert(!docker(["logs", container]).toString().includes(password));
  console.log(
    `Hosting-contract simulation passed: ${info.Architecture}/non-root/512 MiB, explicit HTTPS origin, secure cookies, repeated probes, compiled health check, password setup entry, same-image container replacement, persisted identity/keys/session, password resumption. No live host or providers tested.`,
  );
} catch (error) {
  // Do not print child-process errors/arguments; they can contain synthetic credentials.
  console.error(`Hosting-contract simulation failed during ${stage}.`);
  // Only redacted stderr, never the error object (which includes command args).
  const diagnostic = String(
    error.stderr ?? error.code ?? "Assertion failed",
  ).replace(/[A-Za-z0-9+_/-]{24,}={0,2}/g, "[redacted]");
  console.error(diagnostic.slice(0, 1800));
  process.exitCode = 1;
} finally {
  if (createdContainer) removeContainer();
  if (createdVolume) {
    assert.equal(
      inspect("volume", volume).Labels["org.boopity.hosting-qa"],
      suffix,
    );
    docker(["volume", "rm", volume]);
  }
}
