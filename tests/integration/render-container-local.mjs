// Local, network-isolated Render-contract simulation. Never contacts Render or
// a registry, publishes an image, sends mail, or opens a host port.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

assert.equal(process.env.BOOPITY_CONTAINER_QA, "render-disposable");
const image = process.argv[2];
assert(
  image && /^[A-Za-z0-9][A-Za-z0-9:._/-]+$/.test(image),
  "Supply a locally built image",
);
const suffix = randomUUID(),
  volume = `boopity-render-qa-${suffix}`;
const container = `boopity-render-qa-${suffix}`,
  label = `org.boopity.render-qa=${suffix}`;
const token = randomBytes(32).toString("base64");
const docker = (args, input) =>
  execFileSync("docker", args, {
    input,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 4 * 1024 * 1024,
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
    "--memory",
    "512m",
    "--cpus",
    "0.5",
    "--mount",
    `source=${volume},target=/data`,
    "--env",
    "BOOPITY_HOSTING=render",
    "--env",
    "RENDER=true",
    "--env",
    "RENDER_EXTERNAL_URL=https://maple-fixture.onrender.com",
    "--env",
    "RENDER_EXTERNAL_HOSTNAME=maple-fixture.onrender.com",
    "--env",
    `BOOPITY_SETUP_TOKEN=${token}`,
    id,
  ]);
  createdContainer = true;
}
function removeContainer() {
  assert.equal(
    inspect("container", container).Config.Labels["org.boopity.render-qa"],
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
const origin = process.env.RENDER_EXTERNAL_URL;
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
  assert.equal(info.Architecture, "amd64");
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
    assert(!installation.text.includes(process.env.BOOPITY_SETUP_TOKEN));
    const unlocked = await call("/api/setup/unlock", "POST", { kind: "setup", token: process.env.BOOPITY_SETUP_TOKEN });
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
    assert.equal((await call("/api/setup/unlock", "POST", { kind: "setup", token: process.env.BOOPITY_SETUP_TOKEN })).status, 401);
  `);
  stage = "second compiled health probe";
  docker(["exec", container, "node", "dist/server/healthcheck.mjs"]);
  assert(!docker(["logs", container]).toString().includes(token));
  console.log(
    "Render-contract simulation passed: AMD64/non-root/512 MiB, canonical host, repeated probes, compiled health check, protected DIY entry, same-image container replacement, persisted identity/keys/session, used-code denial. No live host or providers tested.",
  );
} catch (error) {
  // Do not print child-process errors/arguments; they can contain synthetic codes.
  console.error(`Render-contract simulation failed during ${stage}.`);
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
      inspect("volume", volume).Labels["org.boopity.render-qa"],
      suffix,
    );
    docker(["volume", "rm", volume]);
  }
}
