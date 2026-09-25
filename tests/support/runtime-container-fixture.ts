// Bundled with external packages, then run against the image's production modules.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import sharp from "sharp";
import { createNodeApp } from "../../server/runtime/app";
import { createRuntime, loadConfig } from "../../server/runtime/runtime";
import { emptyProviders } from "../../src/shared/setup";

assert.equal(process.env.BOOPITY_CONTAINER_QA, "runtime-disposable");
assert.equal(process.env.DATA_DIR, "/data");
assert.equal(process.version, `v${process.env.BOOPITY_EXPECTED_NODE}`);
assert.equal(process.getuid?.(), 1000);
assert.equal(statSync("/app").uid, 0);
assert.equal(statSync("/app/node_modules").uid, 0);
assert.equal(statSync("/app/dist/server/index.mjs").uid, 0);
assert.equal(readdirSync("/data").length, 0, "Requires a fresh QA volume");
assert.equal(
  execFileSync(
    "find",
    ["/usr", "-xdev", "-type", "f", "-perm", "/6000", "-print"],
    { encoding: "utf8" },
  ).trim(),
  "",
  "Runtime must not contain setuid/setgid programs",
);
for (const name of ["npm", "npx", "corepack", "yarn", "yarnpkg"])
  assert(
    !existsSync(`/usr/local/bin/${name}`),
    `${name} is not a runtime tool`,
  );
for (const name of ["vite", "vitest", "typescript", "esbuild", "lightningcss"])
  assert(!existsSync(`/app/node_modules/${name}`), `${name} is build-only`);
assert(existsSync("/usr/local/LICENSE"), "Preserve Node's combined notices");
for (const path of [
  "/app/RUNTIME-NOTICES.txt",
  "/app/licenses/native-notices.txt",
  "/app/dist/self-hosted/third-party-licenses.txt",
])
  assert(existsSync(path), `Preserve distribution notices: ${path}`);
assert(
  !existsSync("/usr/lib/systemd/systemd-homed"),
  "Do not add the affected optional homed daemon",
);
assert.throws(
  () => execFileSync("perl", ["-MArchive::Tar", "-e", "1"], { stdio: "pipe" }),
  "Do not add the affected optional Archive::Tar module",
);
assert(
  existsSync("/etc/ssl/certs/ca-certificates.crt"),
  "Keep system CA roots",
);
const native = `@img/sharp-linux-${process.arch}`;
assert(
  existsSync(`/app/node_modules/${native}`),
  "Native Sharp binding retained",
);
const png = await sharp({
  create: { width: 3, height: 2, channels: 4, background: "#285c49" },
})
  .png()
  .toBuffer();
const metadata = await sharp(png).metadata();
assert.equal(metadata.format, "png");
assert.equal(metadata.width, 3);
assert.equal(metadata.height, 2);

const address = "owner@example.test",
  origin = "http://localhost:3000";
let googleEmail = address;
const delivered: { html: string; to: string }[] = [];
// Synthetic provider responses only. Docker also disables external networking.
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === "https://api.resend.com/emails") {
    delivered.push(JSON.parse(init!.body as string));
    return Response.json({ id: "synthetic-email" });
  }
  if (url === "https://oauth2.googleapis.com/token") {
    const payload = {
      sub: `google-${googleEmail}`,
      email: googleEmail,
      email_verified: true,
      name: "Synthetic owner",
      iss: "https://accounts.google.com",
      aud: "local-client.apps.googleusercontent.com",
      exp: Math.floor(Date.now() / 1000) + 300,
    };
    return Response.json({
      access_token: "synthetic-provider-token",
      token_type: "Bearer",
      expires_in: 300,
      id_token: [
        Buffer.from('{"alg":"RS256","typ":"JWT"}').toString("base64url"),
        Buffer.from(JSON.stringify(payload)).toString("base64url"),
        "test-signature",
      ].join("."),
    });
  }
  throw new Error("Unexpected external request blocked");
};
const config = loadConfig({ APP_URL: origin, DATA_DIR: "/data" });
const runtime = createRuntime(config, {});
try {
  const app = createNodeApp(runtime.env, config, runtime.control);
  const browser = () => {
    const cookies = new Map<string, string>();
    return async (path: string, method = "GET", body?: unknown) => {
      const response = await app.request(origin + path, {
        method,
        headers: {
          origin,
          "content-type": "application/json",
          cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";")[0],
          split = pair.indexOf("=");
        cookies.set(pair.slice(0, split), pair.slice(split + 1));
      }
      return response;
    };
  };
  const owner = browser();
  assert.equal((await owner("/api/owner/session")).status, 401);
  assert.equal(
    (
      await owner("/api/setup/unlock", "POST", {
        kind: "setup",
        token: await runtime.control.issueToken("setup"),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await owner("/api/setup/identity", "POST", {
        name: "Synthetic owner",
        email: address,
      })
    ).status,
    200,
  );
  const providers = {
    ...structuredClone(emptyProviders),
    email: {
      ...emptyProviders.email,
      provider: "resend",
      from: "hello@example.test",
      apiKey: "synthetic-email-credential",
    },
  };
  assert.equal(
    (await owner("/api/setup/providers", "PUT", { ...providers, version: 0 }))
      .status,
    200,
  );
  assert.equal(
    (
      await owner("/api/auth/email-otp/send-verification-otp", "POST", {
        email: address,
        type: "sign-in",
      })
    ).status,
    200,
  );
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].to, address);
  const otp = delivered[0].html.match(/<strong>(\d{6})<\/strong>/)?.[1];
  assert(otp, "Synthetic message contains a sign-in code");
  assert.equal(
    (
      await owner("/api/auth/sign-in/email-otp", "POST", {
        email: address,
        otp,
      })
    ).status,
    200,
  );
  assert.equal((await owner("/api/setup/owner", "POST", {})).status, 200);
  assert.equal((await owner("/api/owner/session")).status, 200);
  assert.equal(
    (
      await owner("/api/setup/providers", "PUT", {
        ...providers,
        google: {
          enabled: true,
          clientId: "local-client.apps.googleusercontent.com",
          clientSecret: "synthetic-google-credential",
        },
        version: 1,
      })
    ).status,
    200,
  );
  assert.equal((await owner("/api/auth/sign-out", "POST", {})).status, 200);
  assert.equal((await owner("/api/owner/session")).status, 401);
  const googleSignIn = async (
    client: ReturnType<typeof browser>,
    expectedStatus = 302,
  ) => {
    const response = await client("/api/auth/sign-in/social", "POST", {
      provider: "google",
      callbackURL: "/app",
      errorCallbackURL: "/login",
    });
    assert.equal(response.status, 200);
    const url = new URL((await response.json()).url);
    assert.equal(
      url.searchParams.get("redirect_uri"),
      origin + "/api/auth/callback/google",
    );
    const callback = await client(
      `/api/auth/callback/google?code=synthetic&state=${encodeURIComponent(url.searchParams.get("state")!)}`,
    );
    assert.equal(callback.status, expectedStatus);
  };
  await googleSignIn(owner);
  assert.equal((await owner("/api/owner/session")).status, 200);
  googleEmail = "stranger@example.test";
  const stranger = browser();
  await googleSignIn(stranger, 403);
  assert.equal((await stranger("/api/owner/session")).status, 401);
  assert.equal(
    runtime.db.connection.prepare("SELECT COUNT(*) AS n FROM user").get()?.n,
    1,
  );
  console.log(
    "Runtime smoke passed: pinned Node, non-root/read-only app, no build/package-manager tools, native PNG processing, OTP owner claim/session/revocation, synthetic Google callback and stranger rejection. No live providers tested.",
  );
} finally {
  runtime.close();
}
