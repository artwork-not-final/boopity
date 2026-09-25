import assert from "node:assert/strict";

const origin = new URL(
  process.env.SELF_HOSTED_SMOKE_URL ?? "http://localhost:3000",
);
assert(
  origin.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname),
  "This smoke test is local-only",
);
assert(
  origin.pathname === "/" &&
    !origin.search &&
    !origin.hash &&
    !origin.username &&
    !origin.password,
);
const request = (path) => fetch(new URL(path, origin), { redirect: "manual" });
const health = await request("/api/health");
assert.equal(health.status, 200);
const healthData = await health.json();
assert.equal(healthData.ok, true);
assert.equal(healthData.runtime, "nodejs");
assert.equal(healthData.release, "self-hosted-payments");
const installation = await (await request("/api/installation")).json();
assert.equal(installation.setupRequired, healthData.setupRequired);
assert.equal(installation.setupAvailable, true);
assert.deepEqual(Object.keys(installation).sort(), [
  "branding",
  "login",
  "ownerClaimed",
  "runtime",
  "setupAvailable",
  "setupRequired",
  "version",
]);
assert.equal((await request("/api/setup/status")).status, 401);
assert.equal((await request("/api/portal/session")).status, 401);
for (const path of [
  "/api/business/bookings",
  "/api/business/owner/clients",
  "/api/business/household",
])
  assert.equal((await request(path)).status, 401, path);
assert.equal(
  (await request("/api/auth/get-session")).status,
  installation.ownerClaimed ? 200 : 503,
);
for (const path of ["/api/billing", "/api/clients", "/api/setup"]) {
  const response = await request(path);
  assert.equal(response.status, 404, path);
  assert.equal((await response.json()).code, "NOT_FOUND");
}
for (const path of [
  "/.env",
  "/auth-secret",
  "/boopity.sqlite",
  "/uploads/private",
  "/assets/%2e%2e%2fauth-secret",
])
  assert.equal((await request(path)).status, 404, path);
const shell = await request("/");
assert.equal(shell.status, 200);
assert.match(
  shell.headers.get("content-security-policy"),
  /frame-ancestors 'none'/,
);
assert.equal(shell.headers.get("cache-control"), "no-store");
const html = await shell.text();
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map(
  (match) => match[1],
);
assert(assets.length > 0, "Built shell must reference fingerprinted assets");
for (const asset of assets) {
  const response = await request(asset);
  assert.equal(response.status, 200, asset);
  assert.match(response.headers.get("cache-control"), /immutable/);
}
assert.match(await (await request("/robots.txt")).text(), /Disallow: \//);
const notices = await request("/third-party-licenses.txt");
assert.equal(notices.status, 200);
assert.match(notices.headers.get("content-type"), /text\/plain/);
assert.match(notices.headers.get("cache-control"), /no-store/);
const noticeText = await notices.text();
for (const name of [
  "react@",
  "react-dom@",
  "lucide-react@",
  "tailwindcss@",
  "tw-animate-css@",
  "Copyright (c) 2023 shadcn",
])
  assert(noticeText.includes(name), `Missing browser notice: ${name}`);
console.log(
  "Self-hosted HTTP smoke passed: health, public-config boundary, locked routes, private paths, CSP and built assets.",
);
