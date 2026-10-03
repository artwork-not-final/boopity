import assert from "node:assert/strict";
import { request as httpsRequest } from "node:https";
import { get as httpGet } from "node:http";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

assert.equal(process.env.BOOPITY_CONTAINER_QA, "https-disposable");
const origin = "https://pets.example.test:3443",
  ca = readFileSync("/qa/cert.pem");
const mode = process.argv[2];
assert(["setup", "resume"].includes(mode));
const cookies = new Map();
const fingerprints = () =>
  ["auth-secret", "settings-key"].map((name) =>
    createHash("sha256")
      .update(readFileSync("/data/" + name))
      .digest("hex"),
  );
function call(path, method = "GET", body, headers = {}, tls = {}) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: "127.0.0.1",
        port: 3443,
        servername: "pets.example.test",
        ca,
        rejectUnauthorized: true,
        ...tls,
        path,
        method,
        timeout: 5000,
        headers: {
          host: new URL(origin).host,
          origin,
          "content-type": "application/json",
          cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
          ...headers,
        },
      },
      (res) => {
        const authorized = res.socket.authorized;
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          for (const value of res.headers["set-cookie"] ?? []) {
            const pair = value.split(";")[0],
              split = pair.indexOf("=");
            cookies.set(pair.slice(0, split), pair.slice(split + 1));
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: Buffer.concat(chunks).toString(),
            authorized,
          });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("TLS request timed out")));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
let ready = false;
for (let attempt = 0; attempt < 80; attempt++) {
  try {
    const response = await call("/api/ready");
    ready = response.status === 200 && response.authorized;
  } catch {}
  if (ready) break;
  await delay(250);
}
assert(ready, "Validated TLS proxy reaches the shipped application");
if (mode === "setup") {
  await assert.rejects(call("/api/ready", "GET", undefined, {}, { ca: [] }));
  await assert.rejects(
    call(
      "/api/ready",
      "GET",
      undefined,
      {},
      { servername: "wrong.example.test" },
    ),
  );
  assert.equal(
    (await call("/api/ready", "GET", undefined, { host: "evil.example" }))
      .status,
    421,
  );
  const redirect = await new Promise((resolve, reject) => {
    httpGet("http://127.0.0.1:3080/setup", (res) => {
      res.resume();
      resolve({
        status: res.statusCode,
        location: res.headers.location,
        cookie: res.headers["set-cookie"],
      });
    }).on("error", reject);
  });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.location, origin + "/setup");
  assert.equal(redirect.cookie, undefined);
  const output = execFileSync(
    "node",
    ["dist/server/manage.mjs", "setup-token"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const token = output.trim().split("\n").at(-1);
  const unlocked = await call("/api/setup/unlock", "POST", {
    kind: "setup",
    token,
  });
  assert.equal(unlocked.status, 200);
  assert(
    unlocked.headers["set-cookie"].some(
      (value) =>
        value.startsWith("__Host-boopity.setup=") &&
        value.includes("Secure") &&
        value.includes("HttpOnly") &&
        value.includes("SameSite=Strict"),
    ),
  );
  assert.equal(
    (
      await call(
        "/api/setup/identity",
        "POST",
        { name: "TLS owner", email: "owner@example.test" },
        { origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/setup/identity", "POST", {
        name: "TLS owner",
        email: "owner@example.test",
      })
    ).status,
    200,
  );
  const providers = {
    email: {
      provider: "smtp",
      from: "hello@example.test",
      host: "localhost",
      port: 2465,
      secure: true,
      username: "",
      password: "",
      apiKey: "",
    },
    google: {
      enabled: true,
      clientId: "synthetic.apps.googleusercontent.com",
      clientSecret: "synthetic-google-credential",
    },
    version: 0,
  };
  assert.equal(
    (await call("/api/setup/providers", "PUT", providers)).status,
    200,
  );
  assert.equal(
    (
      await call("/api/auth/email-otp/send-verification-otp", "POST", {
        email: "owner@example.test",
        type: "sign-in",
      })
    ).status,
    200,
  );
  const email = readFileSync("/tmp/https-qa-email.txt", "utf8")
    .replace(/=\r?\n/g, "")
    .replace(/=([a-f0-9]{2})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  const otp = email.match(/<strong>(\d{6})<\/strong>/)?.[1];
  assert(otp, "Local SMTP sink received the sign-in code");
  const signedIn = await call("/api/auth/sign-in/email-otp", "POST", {
    email: "owner@example.test",
    otp,
  });
  assert.equal(signedIn.status, 200);
  assert(
    signedIn.headers["set-cookie"].some(
      (value) =>
        value.includes("session_token=") &&
        value.includes("Secure") &&
        value.includes("HttpOnly"),
    ),
  );
  assert.equal((await call("/api/setup/owner", "POST", {})).status, 200);
  assert.equal((await call("/api/owner/session")).status, 200);
  const social = await call("/api/auth/sign-in/social", "POST", {
    provider: "google",
    callbackURL: "/app",
    errorCallbackURL: "/login",
  });
  assert.equal(social.status, 200);
  assert.equal(
    new URL(JSON.parse(social.text).url).searchParams.get("redirect_uri"),
    origin + "/api/auth/callback/google",
  );
  writeFileSync(
    "/data/https-qa-session.json",
    JSON.stringify({ cookies: [...cookies], fingerprints: fingerprints() }),
    { flag: "wx", mode: 0o600 },
  );
} else {
  const state = JSON.parse(readFileSync("/data/https-qa-session.json"));
  for (const [name, value] of state.cookies) cookies.set(name, value);
  assert.deepEqual(fingerprints(), state.fingerprints);
  assert.equal((await call("/api/owner/session")).status, 200);
  assert.equal((await call("/api/auth/sign-out", "POST", {})).status, 200);
  assert.equal((await call("/api/owner/session")).status, 401);
}
console.log(
  `Local HTTPS ${mode} passed; no public host or external provider contacted.`,
);
