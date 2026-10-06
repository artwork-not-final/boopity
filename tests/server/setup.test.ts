import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createRuntime, loadConfig } from "../../server/runtime/runtime";
import { createNodeApp } from "../../server/runtime/app";
import { emptyProviders } from "../../src/shared/setup";
import { defaultBranding } from "../../src/shared/branding";
import { createAuth } from "../../server/auth/auth";
import { digest } from "../../server/runtime/control";
import { readSetupLink, setupLink } from "../../src/shared/setup-link";

const origin = "http://localhost:3000",
  address = "owner@example.test";
const instances = new Set<ReturnType<typeof createRuntime>>(),
  directories: string[] = [];
let delivered: { to: string; html: string; subject: string }[] = [],
  rejectEmail = false,
  googleEmail = address;
beforeEach(() => {
  delivered = [];
  rejectEmail = false;
  googleEmail = address;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "object" && "url" in input ? input.url : String(input);
      if (url === "https://api.resend.com/emails") {
        if (rejectEmail)
          return Response.json(
            { error: "private-provider-error-do-not-expose" },
            { status: 422 },
          );
        delivered.push(JSON.parse(init!.body as string));
        return Response.json({ id: "synthetic-mail" });
      }
      if (url === "https://oauth2.googleapis.com/token") {
        const payload = {
          sub: `google-${googleEmail}`,
          email: googleEmail,
          email_verified: true,
          name: "Google QA",
          iss: "https://accounts.google.com",
          aud: "local-client.apps.googleusercontent.com",
          exp: Math.floor(Date.now() / 1000) + 300,
        };
        const token = [
          Buffer.from('{"alg":"RS256","typ":"JWT"}').toString("base64url"),
          Buffer.from(JSON.stringify(payload)).toString("base64url"),
          "test-signature",
        ].join(".");
        return Response.json({
          access_token: "synthetic-provider-token",
          token_type: "Bearer",
          expires_in: 300,
          id_token: token,
        });
      }
      throw new Error("Blocked unexpected network request");
    }),
  );
});
afterEach(() => {
  for (const instance of instances) instance.close();
  instances.clear();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function make(extra: NodeJS.ProcessEnv = {}, data?: string) {
  data ??= mkdtempSync(join(tmpdir(), "boopity-setup-"));
  directories.push(data);
  const config = loadConfig({ APP_URL: origin, DATA_DIR: data });
  const runtime = createRuntime(config, extra);
  instances.add(runtime);
  const app = createNodeApp(runtime.env, config, runtime.control);
  let sequence = 0;
  function browser() {
    const cookies = new Map<string, string>();
    return {
      cookies,
      async request(
        path: string,
        method = "GET",
        body?: unknown,
        headers: Record<string, string> = {},
      ) {
        const response = await app.request(origin + path, {
          method,
          headers: {
            origin,
            "content-type": "application/json",
            "cf-connecting-ip": `192.0.2.${(++sequence % 250) + 1}`,
            cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
            ...headers,
          },
          ...(body !== undefined
            ? {
                body:
                  body instanceof Uint8Array
                    ? Uint8Array.from(body)
                    : JSON.stringify(body),
              }
            : {}),
        });
        for (const cookie of response.headers.getSetCookie()) {
          const pair = cookie.split(";", 1)[0],
            split = pair.indexOf("=");
          cookies.set(pair.slice(0, split), pair.slice(split + 1));
        }
        return response;
      },
    };
  }
  return { ...runtime, runtime, app, config, data, browser };
}
type Client = ReturnType<ReturnType<typeof make>["browser"]>;
const guidedEnvironment = () => ({
  BOOPITY_OWNER_EMAIL: address,
  RESEND_API_KEY: "synthetic-guided-mail-key",
  EMAIL_FROM: "hello@example.test",
  EMAIL_DELIVERY_MODE: "restricted",
  EMAIL_TEST_RECIPIENT: address,
});
const mailConfig = () => ({
  ...structuredClone(emptyProviders),
  email: {
    ...emptyProviders.email,
    provider: "resend" as const,
    from: "hello@example.test",
    apiKey: "test-only-secret-not-public",
  },
});
async function unlock(fixture: ReturnType<typeof make>, client: Client) {
  const token = await fixture.control.issueToken("setup");
  expect(
    (
      await client.request("/api/setup/unlock", "POST", {
        token,
        kind: "setup",
      })
    ).status,
  ).toBe(200);
  return token;
}
async function prepare(fixture: ReturnType<typeof make>, client: Client) {
  await unlock(fixture, client);
  expect(
    (
      await client.request("/api/setup/identity", "POST", {
        name: "Maple Owner",
        email: address,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await client.request("/api/setup/providers", "PUT", {
        ...mailConfig(),
        version: 0,
      })
    ).status,
  ).toBe(200);
}
async function verify(client: Client) {
  const sent = await client.request(
    "/api/auth/email-otp/send-verification-otp",
    "POST",
    { email: address, type: "sign-in" },
  );
  expect(sent.status, await sent.clone().text()).toBe(200);
  const otp = delivered.at(-1)!.html.match(/<strong>(\d{6})<\/strong>/)![1];
  const response = await client.request("/api/auth/sign-in/email-otp", "POST", {
    email: address,
    otp,
    name: "Maple Owner",
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return otp;
}
async function own(fixture: ReturnType<typeof make>, client: Client) {
  await prepare(fixture, client);
  await verify(client);
  const response = await client.request("/api/setup/owner", "POST", {});
  expect(response.status, await response.clone().text()).toBe(200);
}

describe("setup-only passwords", () => {
  const password = "synthetic maple setup password";
  const replacement = "synthetic updated setup password";
  const signIn = (client: Client, value = password) =>
    client.request("/api/setup/password/unlock", "POST", { password: value });
  const identity = (client: Client, value = password) =>
    client.request("/api/setup/identity", "POST", {
      name: "Maple Owner",
      email: address,
      setupPassword: value,
    });
  it("counts saved identity, not a hosting password or an unlock, as setup progress", async () => {
    const f = make({ BOOPITY_SETUP_PASSWORD: password }),
      client = f.browser();
    const entry = async () =>
      (await f.browser().request("/api/setup/entry")).json();
    expect(await entry()).toEqual({ mode: "password", started: false });
    expect((await signIn(client)).status).toBe(200);
    expect(await entry()).toEqual({ mode: "password", started: false });
    expect((await identity(client)).status).toBe(200);
    expect(await entry()).toEqual({ mode: "password", started: true });
    f.db.connection.exec("UPDATE operator_sessions SET expires_at=0");
    expect(await entry()).toEqual({ mode: "password", started: true });
    expect((await f.browser().request("/api/setup/status")).status).toBe(401);
    expect(await f.control.owner()).toBeNull();
    expect(delivered).toEqual([]);
  });
  it("rejects password creation if ownership is established while hashing", async () => {
    const f = make(),
      client = f.browser();
    await unlock(f, client);
    const preparePassword = f.control.setupPassword.prepare.bind(
      f.control.setupPassword,
    );
    vi.spyOn(f.control.setupPassword, "prepare").mockImplementationOnce(
      async (value) => {
        const prepared = await preparePassword(value);
        f.db.connection
          .exec(`INSERT INTO user(id,name,email,email_verified,created_at,updated_at)
        VALUES ('other-owner','Owner','other@example.test',1,0,0);
        INSERT INTO business_memberships(user_id,role) VALUES ('other-owner','owner');`);
        return prepared;
      },
    );
    expect((await identity(client)).status).toBe(409);
    expect(
      f.db.connection.prepare("SELECT owner_email FROM setup_progress").get()!
        .owner_email,
    ).toBeNull();
    expect(
      f.db.connection.prepare("SELECT password_hash FROM setup_password").get()!
        .password_hash,
    ).toBeNull();
  });
  it("requires existing private setup access to choose a password and keeps identity private", async () => {
    const f = make(),
      client = f.browser();
    expect((await identity(client)).status).toBe(401);
    expect((await signIn(client)).status).toBe(401);
    await unlock(f, client);
    expect((await identity(client)).status).toBe(200);
    const row = f.db.connection.prepare("SELECT * FROM setup_password").get()!;
    expect(row.password_hash).toMatch(/^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{64}$/);
    expect(row.host_hash).toBeNull();
    expect(JSON.stringify(row)).not.toContain(password);
    expect(
      await (await f.browser().request("/api/setup/entry")).json(),
    ).toEqual({ mode: "password", started: true });
    for (const path of [
      "/api/ready",
      "/api/installation",
      "/api/setup/entry",
      "/api/setup/status",
    ]) {
      const response = await f.browser().request(path);
      const text = await response.text();
      expect(text).not.toContain(password);
      expect(text).not.toContain(String(row.password_hash));
      expect(text).not.toContain(address);
      if (path === "/api/setup/status") expect(response.status).toBe(401);
    }
    expect(
      (await (await client.request("/api/setup/status")).json())
        .setupPasswordSet,
    ).toBe(true);
    expect(await f.control.owner()).toBeNull();
    expect(delivered).toEqual([]);
  });
  it("resumes without email after an expired session and a restart, without creating an account", async () => {
    const f = make(),
      client = f.browser();
    await unlock(f, client);
    expect((await identity(client)).status).toBe(200);
    f.db.connection.exec("UPDATE operator_sessions SET expires_at=0");
    expect((await client.request("/api/setup/status")).status).toBe(401);
    f.close();
    instances.delete(f.runtime);
    const restarted = make({}, f.data),
      returning = restarted.browser();
    expect(restarted.control.startupAccess(restarted.db.connection)).toEqual({
      mode: "password",
    });
    const response = await signIn(returning);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=604800");
    const status = await (await returning.request("/api/setup/status")).json();
    expect(status.pending).toMatchObject({
      name: "Maple Owner",
      email: address,
    });
    expect(status.readiness.email).toBe(false);
    expect(status.canClaimOwner).toBe(false);
    expect(
      restarted.db.connection.prepare("SELECT count(*) AS n FROM user").get()!
        .n,
    ).toBe(0);
    expect(delivered).toEqual([]);
  });
  it("changes the password atomically, retaining this browser but revoking other setup sessions and links", async () => {
    const f = make({ BOOPITY_SETUP_PASSWORD: password }),
      client = f.browser(),
      other = f.browser();
    expect((await signIn(client)).status).toBe(200);
    expect((await signIn(other)).status).toBe(200);
    // An unconsumed link from a previous startup must not survive a password change.
    f.db.connection
      .prepare(
        "INSERT INTO operator_tokens(kind,digest,expires_at) VALUES ('setup',?,?)",
      )
      .run(digest("synthetic unused setup link"), Date.now() + 60_000);
    expect((await identity(client, replacement)).status).toBe(200);
    expect((await client.request("/api/setup/status")).status).toBe(200);
    expect((await other.request("/api/setup/status")).status).toBe(401);
    expect(
      f.db.connection
        .prepare("SELECT count(*) AS n FROM operator_tokens WHERE kind='setup'")
        .get()!.n,
    ).toBe(0);
    expect((await signIn(other)).status).toBe(401);
    expect((await signIn(other, replacement)).status).toBe(200);
    f.close();
    instances.delete(f.runtime);
    const restarted = make({ BOOPITY_SETUP_PASSWORD: password }, f.data);
    // Reapplying the original hosting value cannot undo the later wizard choice.
    expect((await signIn(restarted.browser(), replacement)).status).toBe(200);
  });
  it("rate-limits incorrect passwords across caller IPs and process restarts", async () => {
    const f = make({ BOOPITY_SETUP_PASSWORD: password });
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await signIn(f.browser(), "wrong password");
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(password);
    }
    f.close();
    instances.delete(f.runtime);
    const restarted = make({}, f.data);
    expect((await signIn(restarted.browser())).status).toBe(429);
    expect(
      restarted.db.connection
        .prepare("SELECT count(*) AS n FROM operator_sessions")
        .get()!.n,
    ).toBe(0);
  });
  it("validates inputs and rejects cross-site requests before password verification", async () => {
    const f = make({ BOOPITY_SETUP_PASSWORD: password }),
      client = f.browser();
    expect(
      (
        await client.request(
          "/api/setup/password/unlock",
          "POST",
          { password },
          { origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
    for (const body of [
      { password: "" },
      { password: "a".repeat(129) },
      { password, email: address },
    ])
      expect(
        (await client.request("/api/setup/password/unlock", "POST", body))
          .status,
      ).toBe(400);
    expect((await signIn(client)).status).toBe(200);
    for (const value of ["too short", " ".repeat(15), "a".repeat(129)])
      expect((await identity(client, value)).status).toBe(400);
    expect((await signIn(f.browser())).status).toBe(200);
    for (const path of [
      "/api/auth/sign-up/email",
      "/api/auth/sign-in/email",
      "/api/auth/set-password",
    ])
      expect(
        (
          await client.request(path, "POST", {
            name: "Maple",
            email: address,
            password,
          })
        ).status,
      ).toBeGreaterThanOrEqual(400);
  });
  it("allows the existing email-code fallback once delivery is connected", async () => {
    const f = make({ BOOPITY_SETUP_PASSWORD: password }),
      client = f.browser();
    await prepare(f, client);
    expect(
      await (await f.browser().request("/api/setup/entry")).json(),
    ).toEqual({ mode: "password-email", started: true });
    const returning = f.browser();
    await verify(returning);
    expect((await returning.request("/api/setup/status")).status).toBe(200);
    expect(await f.control.owner()).toBeNull();
  });
  it("permanently removes the credential when the owner is established, even through later recovery and host restarts", async () => {
    const f = make({ BOOPITY_SETUP_PASSWORD: password }),
      client = f.browser();
    await own(f, client);
    const row = f.db.connection.prepare("SELECT * FROM setup_password").get()!;
    expect(row.password_hash).toBeNull();
    expect(row.host_hash).toBeNull();
    expect(row.closed_at).not.toBeNull();
    expect((await signIn(f.browser())).status).toBe(401);
    const recovery = f.browser(),
      token = await f.control.issueToken("recovery");
    expect(
      (
        await recovery.request("/api/setup/unlock", "POST", {
          token,
          kind: "recovery",
        })
      ).status,
    ).toBe(200);
    expect((await identity(recovery)).status).toBe(403);
    // Even removal of ownership by trusted maintenance must not re-enable this credential.
    f.db.connection.exec(
      "UPDATE business_memberships SET revoked_at=1 WHERE role='owner'",
    );
    f.close();
    instances.delete(f.runtime);
    const restarted = make({ BOOPITY_SETUP_PASSWORD: replacement }, f.data);
    expect(await restarted.control.setupPassword.enabled()).toBe(false);
    expect((await signIn(restarted.browser(), replacement)).status).toBe(401);
  });
  it("does not save identity or password if access changes during hashing", async () => {
    const f = make(),
      client = f.browser();
    await unlock(f, client);
    const original = f.control.setupPassword.prepare.bind(
      f.control.setupPassword,
    );
    vi.spyOn(f.control.setupPassword, "prepare").mockImplementationOnce(
      async (value) => {
        const prepared = await original(value);
        await f.control.issueToken("setup");
        return prepared;
      },
    );
    expect((await identity(client)).status).toBe(409);
    expect(
      f.db.connection.prepare("SELECT owner_email FROM setup_progress").get()!
        .owner_email,
    ).toBeNull();
    expect(await f.control.setupPassword.enabled()).toBe(false);
  });
  it("rejects a verified password if its version changes before the session is inserted", async () => {
    const f = make({ BOOPITY_SETUP_PASSWORD: password });
    const batch = f.db.batch.bind(f.db);
    vi.spyOn(f.db, "batch").mockImplementationOnce(async (queries) => {
      f.db.connection.exec("UPDATE setup_password SET version=version+1");
      return batch(queries);
    });
    const response = await signIn(f.browser());
    expect(response.status).toBe(409);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(
      f.db.connection
        .prepare("SELECT count(*) AS n FROM operator_sessions")
        .get()!.n,
    ).toBe(0);
  });
});

describe("returning to unfinished DIY setup", () => {
  it("keeps setup access overnight, expires it after seven days, and does not erase saved identity", async () => {
    const f = make(),
      client = f.browser(),
      now = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const token = await f.control.issueToken("setup");
    const unlocked = await client.request("/api/setup/unlock", "POST", {
      token,
      kind: "setup",
    });
    expect(unlocked.status).toBe(200);
    expect(unlocked.headers.get("set-cookie")).toContain("Max-Age=604800");
    expect(unlocked.headers.get("set-cookie")).toContain("HttpOnly");
    expect(unlocked.headers.get("set-cookie")).toContain("SameSite=Strict");
    await client.request("/api/setup/identity", "POST", {
      name: "Maple Owner",
      email: address,
    });
    vi.setSystemTime(now + 24 * 3_600_000);
    const status = await client.request("/api/setup/status");
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      pending: { name: "Maple Owner", email: address },
    });
    vi.setSystemTime(now + 7 * 24 * 3_600_000);
    expect((await client.request("/api/setup/status")).status).toBe(401);
    expect(
      await f.db.prepare("SELECT owner_email FROM setup_progress").first(),
    ).toEqual({ owner_email: address });
    expect(delivered).toHaveLength(0);
  });
  it("keeps recovery at eight hours", async () => {
    const f = make(),
      client = f.browser();
    await own(f, client);
    const recovery = f.browser(),
      token = await f.control.issueToken("recovery"),
      now = Date.now();
    const response = await recovery.request("/api/setup/unlock", "POST", {
      token,
      kind: "recovery",
    });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=28800");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now + 8 * 3_600_000 + 1000);
    expect((await recovery.request("/api/setup/status")).status).toBe(401);
  });
  it("shows paused setup without email, revealing neither identity nor settings", async () => {
    const f = make(),
      installer = f.browser(),
      visitor = f.browser();
    expect(await (await visitor.request("/api/setup/entry")).json()).toEqual({
      mode: "token",
      started: false,
    });
    await unlock(f, installer);
    await installer.request("/api/setup/identity", "POST", {
      email: address,
      name: "Maple Owner",
    });
    expect(await (await visitor.request("/api/setup/entry")).json()).toEqual({
      mode: "paused",
      started: true,
    });
    expect((await visitor.request("/api/setup/status")).status).toBe(401);
    expect(
      (
        await visitor.request(
          "/api/auth/email-otp/send-verification-otp",
          "POST",
          { email: address, type: "sign-in" },
        )
      ).status,
    ).toBe(503);
    expect(delivered).toHaveLength(0);
  });
  it("resumes saved setup by an explicit new code and ends that access on owner claim", async () => {
    const f = make(),
      installer = f.browser();
    await prepare(f, installer);
    await f.db.prepare("UPDATE operator_sessions SET expires_at=0").run();
    const returning = f.browser();
    expect(await (await returning.request("/api/setup/entry")).json()).toEqual({
      mode: "resume",
      started: true,
    });
    expect(delivered).toHaveLength(0);
    expect((await returning.request("/api/setup/status")).status).toBe(401);
    expect(
      (
        await returning.request("/api/setup/identity", "POST", {
          email: "intruder@example.test",
          name: "Intruder",
        })
      ).status,
    ).toBe(401);
    await verify(returning);
    const status = await returning.request("/api/setup/status");
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      actor: "setup",
      owner: null,
      canClaimOwner: true,
      pending: { email: address, name: "Maple Owner" },
      providers: { email: { provider: "resend", hasApiKey: true, apiKey: "" } },
    });
    expect(await f.control.owner()).toBeNull();
    const setupOnly = f.browser();
    setupOnly.cookies.set(
      f.control.cookie,
      returning.cookies.get(f.control.cookie)!,
    );
    expect(
      await (await setupOnly.request("/api/setup/status")).json(),
    ).toMatchObject({ canClaimOwner: false });
    expect(
      (await returning.request("/api/setup/owner", "POST", {})).status,
    ).toBe(200);
    expect((await setupOnly.request("/api/setup/status")).status).toBe(401);
    expect(await (await returning.request("/api/setup/entry")).json()).toEqual({
      mode: "owner",
      started: true,
    });
    expect(await f.control.owner()).toMatchObject({
      name: "Maple Owner",
      email: address,
    });
  });
  it("does not resume from an old authenticated session, a guessed code, or a replayed code", async () => {
    const f = make(),
      installer = f.browser();
    await prepare(f, installer);
    const usedCode = await verify(installer);
    await f.db.prepare("UPDATE operator_sessions SET expires_at=0").run();
    expect((await installer.request("/api/setup/status")).status).toBe(401);
    const returning = f.browser();
    for (const otp of [usedCode, "000000"]) {
      expect(
        (
          await returning.request("/api/auth/sign-in/email-otp", "POST", {
            email: address,
            otp,
          })
        ).status,
      ).not.toBe(200);
      expect(returning.cookies.has(f.control.cookie)).toBe(false);
    }
    expect(await f.control.owner()).toBeNull();
  });
  it("gives resumed access seven days and revokes it when a replacement setup link is issued", async () => {
    const f = make(),
      installer = f.browser(),
      returning = f.browser();
    await prepare(f, installer);
    await verify(returning);
    const raw = returning.cookies.get(f.control.cookie)!;
    const session = await f.db
      .prepare("SELECT expires_at FROM operator_sessions WHERE digest=?1")
      .bind(digest(raw))
      .first<{ expires_at: number }>();
    expect(session!.expires_at - Date.now()).toBeGreaterThan(
      7 * 24 * 3_600_000 - 10_000,
    );
    expect(session!.expires_at - Date.now()).toBeLessThanOrEqual(
      7 * 24 * 3_600_000,
    );
    await f.control.issueToken("setup");
    expect((await returning.request("/api/setup/status")).status).toBe(401);
    expect(await f.control.owner()).toBeNull();
  });
  it("never sends to an arbitrary address or grants other auth routes before resumption", async () => {
    const f = make(),
      installer = f.browser(),
      visitor = f.browser();
    await prepare(f, installer);
    expect(
      (
        await visitor.request(
          "/api/auth/email-otp/send-verification-otp",
          "POST",
          { email: "intruder@example.test", type: "sign-in" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await visitor.request("/api/auth/sign-in/social", "POST", {
          provider: "google",
        })
      ).status,
    ).toBe(503);
    expect((await visitor.request("/api/auth/get-session")).status).toBe(503);
    expect((await visitor.request("/api/setup/owner", "POST", {})).status).toBe(
      401,
    );
    expect(delivered).toHaveLength(0);
  });
  it("does not offer email resumption when the delivery allowlist excludes the saved inbox", async () => {
    const f = make({
        EMAIL_DELIVERY_MODE: "restricted",
        EMAIL_TEST_RECIPIENT: "someone-else@example.test",
      }),
      installer = f.browser();
    await prepare(f, installer);
    const returning = f.browser();
    expect(await (await returning.request("/api/setup/entry")).json()).toEqual({
      mode: "paused",
      started: true,
    });
    expect(
      (
        await returning.request(
          "/api/auth/email-otp/send-verification-otp",
          "POST",
          { email: address, type: "sign-in" },
        )
      ).status,
    ).toBe(503);
    expect(delivered).toHaveLength(0);
  });
  it("retains rate limits and never sends on setup reads", async () => {
    const f = make(),
      installer = f.browser(),
      returning = f.browser();
    await prepare(f, installer);
    for (let i = 0; i < 3; i++) {
      expect(
        (
          await returning.request(
            "/api/auth/email-otp/send-verification-otp",
            "POST",
            { email: address, type: "sign-in" },
          )
        ).status,
      ).toBe(200);
    }
    const limited = await returning.request(
      "/api/auth/email-otp/send-verification-otp",
      "POST",
      { email: address, type: "sign-in" },
    );
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(Number(limited.headers.get("Retry-After"))).toBeLessThanOrEqual(600);
    await returning.request("/api/setup/entry");
    expect(delivered).toHaveLength(3);
    expect((await returning.request("/api/setup/status")).status).toBe(401);
  });
  it("does not claim successful delivery or resume after a provider failure", async () => {
    const f = make(),
      installer = f.browser(),
      returning = f.browser();
    await prepare(f, installer);
    rejectEmail = true;
    expect(
      (
        await returning.request(
          "/api/auth/email-otp/send-verification-otp",
          "POST",
          { email: address, type: "sign-in" },
        )
      ).status,
    ).toBe(503);
    expect(delivered).toHaveLength(0);
    expect(
      (
        await returning.request("/api/auth/sign-in/email-otp", "POST", {
          email: address,
          otp: "000000",
        })
      ).status,
    ).toBe(409);
    expect(returning.cookies.has(f.control.cookie)).toBe(false);
  });
  it("rejects resume codes after expiry or a mail-settings change", async () => {
    const f = make(),
      installer = f.browser(),
      returning = f.browser();
    await prepare(f, installer);
    await returning.request(
      "/api/auth/email-otp/send-verification-otp",
      "POST",
      { email: address, type: "sign-in" },
    );
    const otp = delivered.at(-1)!.html.match(/<strong>(\d{6})<\/strong>/)![1];
    const now = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now + 6 * 60_000);
    expect(
      (
        await returning.request("/api/auth/sign-in/email-otp", "POST", {
          email: address,
          otp,
        })
      ).status,
    ).not.toBe(200);
    vi.useRealTimers();
    const config = mailConfig();
    config.email.from = "changed@example.test";
    await installer.request("/api/setup/providers", "PUT", {
      ...config,
      version: 1,
    });
    expect(
      (
        await returning.request("/api/auth/sign-in/email-otp", "POST", {
          email: address,
          otp,
        })
      ).status,
    ).toBe(409);
    expect(returning.cookies.has(f.control.cookie)).toBe(false);
  });
  it.each(["settings", "owner"])(
    "fails closed if %s changes just before issuing resume access",
    async (change) => {
      const f = make(),
        installer = f.browser(),
        returning = f.browser();
      await prepare(f, installer);
      await returning.request(
        "/api/auth/email-otp/send-verification-otp",
        "POST",
        { email: address, type: "sign-in" },
      );
      const otp = delivered.at(-1)!.html.match(/<strong>(\d{6})<\/strong>/)![1];
      const original = f.control.resumeSetup.bind(f.control);
      vi.spyOn(f.control, "resumeSetup").mockImplementationOnce(
        async (...args) => {
          if (change === "settings")
            await f.db
              .prepare(
                "UPDATE setup_progress SET mail_verified_at=NULL,mail_config_digest=NULL,mail_challenge_digest=NULL",
              )
              .run();
          else
            f.db.connection.exec(
              "INSERT INTO business_memberships(user_id,role) SELECT id,'owner' FROM user LIMIT 1",
            );
          return original(...args);
        },
      );
      expect(
        (
          await returning.request("/api/auth/sign-in/email-otp", "POST", {
            email: address,
            otp,
          })
        ).status,
      ).toBe(409);
      expect(returning.cookies.has(f.control.cookie)).toBe(false);
      expect(
        await f.db
          .prepare(
            "SELECT count(*) AS n FROM installation_audit WHERE event='setup-resumed-by-email'",
          )
          .first(),
      ).toEqual({ n: 0 });
    },
  );
});

describe("browser-based deployment-selected owner claim", () => {
  it("rolls back membership, audit and shortcut closure when profile creation fails", async () => {
    const f = make(guidedEnvironment()),
      client = f.browser();
    await verify(client);
    f.db.connection.exec(
      "CREATE TRIGGER guided_claim_failure BEFORE INSERT ON sitter_profiles BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
    );
    expect(
      (await client.request("/api/setup/owner", "POST", { name: "Owner" }))
        .status,
    ).toBe(500);
    expect(await f.control.owner()).toBeNull();
    expect(await f.control.guided.available()).toBe(true);
    expect(
      await f.db
        .prepare(
          "SELECT count(*) AS n FROM installation_audit WHERE event='owner-created'",
        )
        .first(),
    ).toEqual({ n: 0 });
    f.db.connection.exec("DROP TRIGGER guided_claim_failure");
    expect(
      (await client.request("/api/setup/owner", "POST", { name: "Owner" }))
        .status,
    ).toBe(200);
  });
  it("rejects expired email codes without creating an owner", async () => {
    const f = make(guidedEnvironment()),
      client = f.browser();
    expect(
      (
        await client.request(
          "/api/auth/email-otp/send-verification-otp",
          "POST",
          { email: address, type: "sign-in" },
        )
      ).status,
    ).toBe(200);
    const otp = delivered.at(-1)!.html.match(/<strong>(\d{6})<\/strong>/)![1];
    const future = Date.now() + 6 * 60_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(future);
    expect(
      (
        await client.request("/api/auth/sign-in/email-otp", "POST", {
          email: address,
          otp,
        })
      ).status,
    ).not.toBe(200);
    expect(
      (await client.request("/api/setup/owner", "POST", { name: "Owner" }))
        .status,
    ).toBe(403);
    expect(await f.control.owner()).toBeNull();
  });

  it("still accepts an explicit server-token claim without the guided request shape", async () => {
    const f = make(guidedEnvironment()),
      client = f.browser();
    await unlock(f, client);
    await verify(client);
    expect((await client.request("/api/setup/owner", "POST", {})).status).toBe(
      200,
    );
    expect(await f.control.guided.available()).toBe(false);
  });

  it("does not advertise usable email when the delivery allowlist excludes the owner", async () => {
    const f = make({
      ...guidedEnvironment(),
      EMAIL_TEST_RECIPIENT: "different@example.test",
    });
    expect(await f.control.guided.state()).toBe("waiting");
    expect(delivered).toHaveLength(0);
  });

  it("does not mistake a host-pinned identity for saved progress, sends nothing on boot, and keeps setup private", async () => {
    const f = make(guidedEnvironment()),
      client = f.browser();
    expect(await (await client.request("/api/setup/entry")).json()).toEqual({
      mode: "email",
      started: false,
    });
    const publicInfo = await (await client.request("/api/installation")).text();
    expect(publicInfo).not.toContain(address);
    expect(publicInfo).not.toContain("synthetic-guided-mail-key");
    expect(delivered).toHaveLength(0);
    expect(await f.control.owner()).toBeNull();
    expect((await client.request("/api/setup/status")).status).toBe(401);
    expect(
      (
        await client.request("/api/setup/identity", "POST", {
          email: "intruder@example.test",
          name: "Intruder",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await client.request("/api/setup/providers", "PUT", {
          ...mailConfig(),
          version: 0,
        })
      ).status,
    ).toBe(401);
    expect(
      (await client.request("/api/setup/owner", "POST", { name: "Intruder" }))
        .status,
    ).toBe(403);
    expect(
      (
        await client.request(
          "/api/auth/email-otp/send-verification-otp",
          "POST",
          { email: "intruder@example.test", type: "sign-in" },
        )
      ).status,
    ).toBe(403);
    expect(delivered).toHaveLength(0);
    expect(
      (await client.request("/api/auth/email-otp/get-verification-otp")).status,
    ).toBe(404);
    expect(
      (
        await client.request("/api/auth/sign-in/social", "POST", {
          provider: "google",
          callbackURL: "/app",
        })
      ).status,
    ).toBe(403);
  });

  it("requires a verified inbox and explicit claim, then closes the first-run path", async () => {
    const f = make(guidedEnvironment()),
      client = f.browser();
    const code = await verify(client);
    expect(await f.control.owner()).toBeNull();
    expect((await client.request("/api/setup/status")).status).toBe(401);
    expect(
      (
        await client.request("/api/setup/owner", "POST", {
          name: "Maple Sitter",
        })
      ).status,
    ).toBe(200);
    expect(await f.control.owner()).toMatchObject({
      name: "Maple Sitter",
      email: address,
      emailVerified: 1,
    });
    expect(await (await client.request("/api/setup/entry")).json()).toEqual({
      mode: "owner",
      started: true,
    });
    expect(await f.control.guided.available()).toBe(false);
    expect((await client.request("/api/setup/status")).status).toBe(200);
    expect(
      (
        await client.request("/api/setup/owner", "POST", {
          name: "Replacement",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await f.browser().request("/api/auth/sign-in/email-otp", "POST", {
          email: address,
          otp: code,
        })
      ).status,
    ).not.toBe(200);
    expect(
      (await client.request("/api/setup/complete", "POST", {})).status,
    ).toBe(200);
    expect(
      await f.db
        .prepare(
          "SELECT count(*) AS n FROM installation_audit WHERE event='owner-created'",
        )
        .first(),
    ).toEqual({ n: 1 });
  });

  it("does not mark failed delivery or incorrect verification as ownership evidence", async () => {
    const f = make(guidedEnvironment()),
      client = f.browser();
    rejectEmail = true;
    expect(
      (
        await client.request(
          "/api/auth/email-otp/send-verification-otp",
          "POST",
          { email: address, type: "sign-in" },
        )
      ).status,
    ).toBe(503);
    expect(
      await f.db
        .prepare(
          "SELECT mail_challenge_digest,mail_verified_at FROM setup_progress",
        )
        .first(),
    ).toEqual({ mail_challenge_digest: null, mail_verified_at: null });
    expect(
      (
        await client.request("/api/auth/sign-in/email-otp", "POST", {
          email: address,
          otp: "000000",
        })
      ).status,
    ).not.toBe(200);
    expect(
      (await client.request("/api/setup/owner", "POST", { name: "Owner" }))
        .status,
    ).toBe(403);
    expect(await f.control.owner()).toBeNull();
  });

  it("preserves origin checks and recipient-wide limits even when source IPs change", async () => {
    const f = make(guidedEnvironment()),
      client = f.browser();
    const body = { email: address, type: "sign-in" };
    expect(
      (
        await client.request(
          "/api/auth/email-otp/send-verification-otp",
          "POST",
          body,
          { origin: "https://foreign.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await client.request(
          "/api/setup/owner",
          "POST",
          { name: "Owner" },
          { origin: "https://foreign.example" },
        )
      ).status,
    ).toBe(403);
    for (let i = 0; i < 3; i++)
      expect(
        (
          await f
            .browser()
            .request("/api/auth/email-otp/send-verification-otp", "POST", body)
        ).status,
      ).toBe(200);
    expect(
      (
        await f
          .browser()
          .request("/api/auth/email-otp/send-verification-otp", "POST", body)
      ).status,
    ).toBe(429);
    expect(delivered).toHaveLength(3);
    expect(await f.control.owner()).toBeNull();
  });

  it("pins the inbox before access and blocks configuration changes from redirecting a claim", async () => {
    const f = make(guidedEnvironment()),
      client = f.browser();
    await unlock(f, client);
    expect(
      (
        await client.request("/api/setup/identity", "POST", {
          name: "Other",
          email: "other@example.test",
        })
      ).status,
    ).toBe(409);
    f.close();
    instances.delete(f.runtime);
    expect(() =>
      make(
        { ...guidedEnvironment(), BOOPITY_OWNER_EMAIL: "other@example.test" },
        f.data,
      ),
    ).toThrow("already pinned");
    const resumed = make(guidedEnvironment(), f.data);
    expect(await resumed.control.guided.available()).toBe(true);
    expect(
      await resumed.db
        .prepare("SELECT owner_email FROM setup_progress")
        .first(),
    ).toEqual({ owner_email: address });
  });

  it("waits safely for hosting email configuration and resumes without a console token", async () => {
    const f = make({ BOOPITY_OWNER_EMAIL: address });
    expect(
      await (await f.browser().request("/api/setup/entry")).json(),
    ).toEqual({ mode: "waiting", started: false });
    expect(
      (
        await f
          .browser()
          .request("/api/auth/email-otp/send-verification-otp", "POST", {
            email: address,
            type: "sign-in",
          })
      ).status,
    ).toBe(503);
    f.close();
    instances.delete(f.runtime);
    const resumed = make(guidedEnvironment(), f.data),
      client = resumed.browser();
    await verify(client);
    expect(
      (
        await client.request("/api/setup/owner", "POST", {
          name: "Browser Owner",
        })
      ).status,
    ).toBe(200);
  });

  it("does not retroactively adopt a partially configured or already claimed installation", async () => {
    const f = make(),
      client = f.browser();
    await prepare(f, client);
    f.close();
    instances.delete(f.runtime);
    expect(() => make(guidedEnvironment(), f.data)).toThrow("before beginning");
    const claimed = make(),
      ownerClient = claimed.browser();
    await own(claimed, ownerClient);
    claimed.close();
    instances.delete(claimed.runtime);
    const reopened = make(
      { ...guidedEnvironment(), BOOPITY_OWNER_EMAIL: "other@example.test" },
      claimed.data,
    );
    expect(await reopened.control.owner()).toMatchObject({ email: address });
    expect(await reopened.control.guided.available()).toBe(false);
  });

  it("creates one owner and one audit record under competing browser claims", async () => {
    const f = make(guidedEnvironment()),
      client = f.browser();
    await verify(client);
    const names = ["First Owner", "Second Owner"];
    const results = await Promise.all(
      names.map((name) => client.request("/api/setup/owner", "POST", { name })),
    );
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(
      results.filter((result) => [403, 409].includes(result.status)),
    ).toHaveLength(1);
    expect(await f.control.owner()).toMatchObject({
      name: names[results.findIndex((result) => result.status === 200)],
    });
    expect(
      await f.db
        .prepare(
          "SELECT count(*) AS n FROM business_memberships WHERE role='owner'",
        )
        .first(),
    ).toEqual({ n: 1 });
    expect(
      await f.db
        .prepare(
          "SELECT count(*) AS n FROM installation_audit WHERE event='owner-created'",
        )
        .first(),
    ).toEqual({ n: 1 });
  });

  it("requires a fresh mail check after hosting credentials change", async () => {
    const f = make(guidedEnvironment()),
      client = f.browser();
    await verify(client);
    f.close();
    instances.delete(f.runtime);
    const resumed = make(
        {
          ...guidedEnvironment(),
          RESEND_API_KEY: "synthetic-changed-mail-key",
        },
        f.data,
      ),
      next = resumed.browser();
    for (const [key, value] of client.cookies) next.cookies.set(key, value);
    expect(
      (await next.request("/api/setup/owner", "POST", { name: "Owner" }))
        .status,
    ).toBe(409);
    expect(await resumed.control.owner()).toBeNull();
    await verify(next);
    expect(
      (await next.request("/api/setup/owner", "POST", { name: "Owner" }))
        .status,
    ).toBe(200);
  });

  it("cannot reuse the first-run shortcut after owner revocation or an environment edit", async () => {
    const f = make(guidedEnvironment()),
      client = f.browser();
    await verify(client);
    expect(
      (await client.request("/api/setup/owner", "POST", { name: "Owner" }))
        .status,
    ).toBe(200);
    await f.db
      .prepare(
        "UPDATE business_memberships SET revoked_at=?1 WHERE role='owner'",
      )
      .bind(Date.now())
      .run();
    f.close();
    instances.delete(f.runtime);
    const reopened = make(
      { ...guidedEnvironment(), BOOPITY_OWNER_EMAIL: "other@example.test" },
      f.data,
    );
    expect(await reopened.control.guided.available()).toBe(false);
    expect(
      (await reopened.browser().request("/api/auth/get-session")).status,
    ).toBe(503);
  });
});

describe("secure first-run setup", () => {
  it("opens the protected wizard from a private link before DIY mail is connected", async () => {
    const f = make(),
      client = f.browser(),
      visitor = f.browser();
    const raw = await f.control.issueToken("setup");
    const link = new URL(setupLink(origin, raw));
    // Loading the page never consumes the credential or grants access.
    await client.request(link.pathname);
    expect((await client.request("/api/setup/status")).status).toBe(401);
    expect(
      (
        await f.db
          .prepare("SELECT consumed_at FROM operator_tokens WHERE kind='setup'")
          .first()
      )?.consumed_at,
    ).toBeNull();
    expect(
      (
        await client.request("/api/setup/unlock", "POST", {
          token: readSetupLink(link.hash).token,
          kind: "setup",
        })
      ).status,
    ).toBe(200);
    const status = await (await client.request("/api/setup/status")).json();
    expect(status.actor).toBe("setup");
    expect(status.readiness.email).toBe(false);
    expect(status.providers.managed.email).toBe(false);
    expect((await visitor.request("/api/setup/status")).status).toBe(401);
    expect(
      (
        await client.request("/api/setup/identity", "POST", {
          name: "DIY Owner",
          email: address,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await client.request("/api/setup/providers", "PUT", {
          ...mailConfig(),
          version: 0,
        })
      ).status,
    ).toBe(200);
    expect(delivered).toEqual([]);
    expect(await f.control.owner()).toBeNull();
    expect(
      (
        await visitor.request("/api/setup/unlock", "POST", {
          token: raw,
          kind: "setup",
        })
      ).status,
    ).toBe(401);
  });
  it("exposes only branding/readiness before claim and rejects CSRF, bad bodies and unknown users", async () => {
    const f = make(),
      client = f.browser();
    const publicInfo = await (await client.request("/api/installation")).json();
    expect(publicInfo).toMatchObject({
      setupRequired: true,
      setupAvailable: true,
      ownerClaimed: false,
    });
    expect(JSON.stringify(publicInfo)).not.toMatch(
      /secret|owner_email|digest|ciphertext/,
    );
    expect((await client.request("/api/setup/status")).status).toBe(401);
    expect(
      (
        await client.request("/api/auth/sign-in/email-otp", "POST", {
          email: address,
          otp: "123456",
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await client.request(
          "/api/setup/unlock",
          "POST",
          {},
          { origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (await client.request("/api/setup/unlock", "POST", {}, { origin: "" }))
        .status,
    ).toBe(403);
    expect(
      (
        await client.request(
          "/api/setup/unlock",
          "POST",
          {},
          { "content-type": "text/plain" },
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await client.request("/api/setup/unlock", "POST", {
          token: "short",
          kind: "setup",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await client.request("/api/setup/unlock", "POST", {
          token: "x".repeat(2 * 1024 * 1024),
          kind: "setup",
        })
      ).status,
    ).toBe(413);
    expect(await f.control.owner()).toBeNull();
    expect(delivered).toHaveLength(0);
  });
  it("consumes a token once under concurrency, hashes secrets, and rejects expiry/replay", async () => {
    const f = make(),
      one = f.browser(),
      two = f.browser();
    const token = await f.control.issueToken("setup");
    expect(
      JSON.stringify(await f.db.prepare("SELECT * FROM operator_tokens").all()),
    ).not.toContain(token);
    const results = await Promise.all(
      [one, two].map((client) =>
        client.request("/api/setup/unlock", "POST", { token, kind: "setup" }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(
      results.find((r) => r.status === 200)!.headers.get("set-cookie"),
    ).toMatch(/HttpOnly/i);
    expect(
      (await one.request("/api/setup/unlock", "POST", { token, kind: "setup" }))
        .status,
    ).toBe(401);
    const expired = await f.control.issueToken("setup");
    await f.db.prepare("UPDATE operator_tokens SET expires_at=0").run();
    expect(
      (
        await one.request("/api/setup/unlock", "POST", {
          token: expired,
          kind: "setup",
        })
      ).status,
    ).toBe(401);
    expect((await two.request("/api/setup/status")).status).toBe(401);
  });
  it("does not resurrect a consumed environment token on restart", async () => {
    const token = "local-only-environment-token-0000000000000000",
      f = make({ BOOPITY_SETUP_TOKEN: token }),
      client = f.browser();
    expect(
      (
        await client.request("/api/setup/unlock", "POST", {
          token,
          kind: "setup",
        })
      ).status,
    ).toBe(200);
    f.close();
    instances.delete(f.runtime);
    const second = make({ BOOPITY_SETUP_TOKEN: token }, f.data),
      other = second.browser();
    expect(
      (
        await other.request("/api/setup/unlock", "POST", {
          token,
          kind: "setup",
        })
      ).status,
    ).toBe(401);
  });
  it("resumes saved setup across restart without replaying the claim or leaking provider secrets", async () => {
    const f = make(),
      client = f.browser();
    await prepare(f, client);
    const encrypted = await f.db
      .prepare("SELECT ciphertext FROM installation_secrets")
      .first<{ ciphertext: string }>();
    expect(encrypted!.ciphertext).not.toContain("test-only-secret-not-public");
    const before = await (await client.request("/api/setup/status")).json();
    expect(before.providers.email).toMatchObject({
      apiKey: "",
      hasApiKey: true,
    });
    expect(JSON.stringify(before)).not.toContain("test-only-secret-not-public");
    f.close();
    instances.delete(f.runtime);
    const second = make({}, f.data),
      resumed = second.browser();
    for (const [k, v] of client.cookies) resumed.cookies.set(k, v);
    const after = await (await resumed.request("/api/setup/status")).json();
    expect(after.pending).toEqual(before.pending);
    expect(after.providers).toEqual(before.providers);
    await verify(resumed);
    expect((await resumed.request("/api/setup/owner", "POST", {})).status).toBe(
      200,
    );
  });
  it("rotates environment tokens without allowing an older value to reactivate", async () => {
    const firstToken = "first-local-only-bootstrap-token-0000000000000";
    const nextToken = "second-local-only-bootstrap-token-000000000000";
    const f = make({ BOOPITY_SETUP_TOKEN: firstToken });
    f.close();
    instances.delete(f.runtime);
    const rotated = make({ BOOPITY_SETUP_TOKEN: nextToken }, f.data);
    const client = rotated.browser();
    expect(
      (
        await client.request("/api/setup/unlock", "POST", {
          token: firstToken,
          kind: "setup",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await client.request("/api/setup/unlock", "POST", {
          token: nextToken,
          kind: "setup",
        })
      ).status,
    ).toBe(200);
    rotated.close();
    instances.delete(rotated.runtime);
    const rollback = make({ BOOPITY_SETUP_TOKEN: firstToken }, f.data);
    expect(
      (
        await rollback.browser().request("/api/setup/unlock", "POST", {
          token: firstToken,
          kind: "setup",
        })
      ).status,
    ).toBe(401);
  });
  it("blocks completion when private storage is unwritable without recording a false completion", async () => {
    const f = make(),
      client = f.browser();
    await own(f, client);
    vi.spyOn(f.control, "storageReady").mockResolvedValue(false);
    expect(
      (await (await client.request("/api/setup/status")).json()).readiness
        .privateStorage,
    ).toBe(false);
    expect(
      (await client.request("/api/setup/complete", "POST", {})).status,
    ).toBe(409);
    expect(
      await f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM installation_audit WHERE event='setup-completed'",
        )
        .first(),
    ).toEqual({ n: 0 });
  });
  it("requires current email delivery proof and claims a single owner/profile atomically", async () => {
    const f = make(),
      client = f.browser();
    await prepare(f, client);
    expect((await client.request("/api/setup/owner", "POST", {})).status).toBe(
      403,
    );
    await verify(client);
    const results = await Promise.all([
      client.request("/api/setup/owner", "POST", {}),
      client.request("/api/setup/owner", "POST", {}),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      await f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM business_memberships WHERE role='owner'",
        )
        .first(),
    ).toEqual({ n: 1 });
    expect(
      await f.db.prepare("SELECT COUNT(*) AS n FROM sitter_profiles").first(),
    ).toEqual({ n: 1 });
    expect(
      (await client.request("/api/setup/complete", "POST", {})).status,
    ).toBe(200);
    expect(
      (await (await client.request("/api/installation")).json()).setupRequired,
    ).toBe(false);
    expect((await client.request("/api/owner/session")).status).toBe(200);
    await expect(f.control.issueToken("setup")).rejects.toThrow(
      "already has an owner",
    );
  });
  it("rejects client/unknown sign-in, role injection, password and OTP-lookup APIs", async () => {
    const f = make(),
      client = f.browser();
    await own(f, client);
    const outsider = f.browser();
    expect(
      (
        await outsider.request(
          "/api/auth/email-otp/send-verification-otp",
          "POST",
          { email: "client@example.test", type: "sign-in" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await outsider.request("/api/setup/identity", "POST", {
          name: "Client",
          email: "client@example.test",
          role: "owner",
        })
      ).status,
    ).toBe(401);
    expect(
      (await outsider.request("/api/setup/owner", "POST", {})).status,
    ).toBe(401);
    for (const path of [
      "/api/auth/sign-up/email",
      "/api/auth/forget-password",
      "/api/auth/email-otp/get-verification-otp",
    ])
      expect((await outsider.request(path, "POST", {})).status).toBe(404);
    await expect(
      createAuth(await f.control.bindings()).api.signUpEmail({
        body: {
          email: "client@example.test",
          name: "Client",
          password: "not-enabled-test-password",
        },
      }),
    ).rejects.toThrow();
    expect(delivered).toHaveLength(1);
    expect(
      await f.db.prepare("SELECT COUNT(*) AS n FROM user").first(),
    ).toEqual({ n: 1 });
  });
  it("rejects expired operator sessions and old claim sessions after owner creation", async () => {
    const f = make(),
      client = f.browser();
    await prepare(f, client);
    const stolen = f.browser();
    for (const [k, v] of client.cookies) stolen.cookies.set(k, v);
    await verify(client);
    await client.request("/api/setup/owner", "POST", {});
    expect((await stolen.request("/api/setup/status")).status).toBe(401);
    const recovery = await f.control.issueToken("recovery");
    await stolen.request("/api/setup/unlock", "POST", {
      token: recovery,
      kind: "recovery",
    });
    await f.db.prepare("UPDATE operator_sessions SET expires_at=0").run();
    expect((await stolen.request("/api/setup/status")).status).toBe(401);
  });
  it("does not claim email delivery on rejection or authorize an old code after changing mail settings", async () => {
    const f = make(),
      client = f.browser();
    await prepare(f, client);
    rejectEmail = true;
    const failed = await client.request(
      "/api/auth/email-otp/send-verification-otp",
      "POST",
      { email: address, type: "sign-in" },
    );
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private-provider-error");
    rejectEmail = false;
    await client.request("/api/auth/email-otp/send-verification-otp", "POST", {
      email: address,
      type: "sign-in",
    });
    const otp = delivered.at(-1)!.html.match(/<strong>(\d{6})<\/strong>/)![1];
    const changed = mailConfig();
    changed.email.from = "changed@example.test";
    expect(
      (
        await client.request("/api/setup/providers", "PUT", {
          ...changed,
          version: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await client.request("/api/auth/sign-in/email-otp", "POST", {
          email: address,
          otp,
        })
      ).status,
    ).toBe(200);
    expect((await client.request("/api/setup/owner", "POST", {})).status).toBe(
      409,
    );
    expect(await f.control.owner()).toBeNull();
  });
  it("preserves blank stored secrets, detects concurrent edits, and respects environment precedence", async () => {
    const f = make(),
      client = f.browser();
    await prepare(f, client);
    const input = mailConfig();
    input.email.apiKey = "";
    input.google = {
      enabled: true,
      clientId: "local-client.apps.googleusercontent.com",
      clientSecret: "private-google-secret",
    };
    expect(
      (
        await client.request("/api/setup/providers", "PUT", {
          ...input,
          version: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await client.request("/api/setup/providers", "PUT", {
          ...input,
          version: 1,
        })
      ).status,
    ).toBe(409);
    expect((await f.control.bindings()).RESEND_API_KEY).toBe(
      "test-only-secret-not-public",
    );
    expect(
      JSON.stringify(await (await client.request("/api/setup/status")).json()),
    ).not.toContain("private-google-secret");
    const managed = make({
      RESEND_API_KEY: "environment-secret",
      EMAIL_FROM: "environment@example.test",
      EMAIL_DELIVERY_MODE: "live",
      GOOGLE_CLIENT_ID: "managed.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "managed-secret",
    });
    const operator = managed.browser();
    await unlock(managed, operator);
    await operator.request("/api/setup/providers", "PUT", {
      ...input,
      version: 0,
    });
    const status = await (await operator.request("/api/setup/status")).json();
    expect(status.providers.managed).toEqual({ email: true, google: true });
    expect((await managed.control.bindings()).RESEND_API_KEY).toBe(
      "environment-secret",
    );
    expect((await managed.control.bindings()).GOOGLE_CLIENT_ID).toBe(
      "managed.apps.googleusercontent.com",
    );
    expect(JSON.stringify(status)).not.toMatch(
      /environment-secret|managed-secret/,
    );
  });
  it("supports verified-owner Google linking and rejects a different Google identity", async () => {
    const f = make(),
      client = f.browser();
    await own(f, client);
    await client.request("/api/setup/providers", "PUT", {
      ...mailConfig(),
      google: {
        enabled: true,
        clientId: "local-client.apps.googleusercontent.com",
        clientSecret: "private-google-secret",
      },
      version: 1,
    });
    const signin = async (target: Client) => {
      const start = await target.request("/api/auth/sign-in/social", "POST", {
        provider: "google",
        callbackURL: "/app",
        errorCallbackURL: "/login",
      });
      expect(start.status).toBe(200);
      const url = new URL((await start.json()).url);
      expect(url.searchParams.get("prompt")).toBe("select_account");
      expect(url.searchParams.get("redirect_uri")).toBe(
        origin + "/api/auth/callback/google",
      );
      return target.request(
        `/api/auth/callback/google?code=mock&state=${encodeURIComponent(url.searchParams.get("state")!)}`,
      );
    };
    await client.request("/api/auth/sign-out", "POST", {});
    const response = await signin(client);
    expect(response.status).toBe(302);
    expect((await client.request("/api/owner/session")).status).toBe(200);
    expect(
      await f.db
        .prepare("SELECT COUNT(*) AS n FROM account WHERE provider_id='google'")
        .first(),
    ).toEqual({ n: 1 });
    const retainedTokens = () =>
      f.db
        .prepare(
          "SELECT access_token,refresh_token,id_token FROM account WHERE provider_id='google'",
        )
        .first();
    expect(await retainedTokens()).toEqual({
      access_token: null,
      refresh_token: null,
      id_token: null,
    });
    await client.request("/api/auth/sign-out", "POST", {});
    await signin(client);
    expect((await client.request("/api/owner/session")).status).toBe(200);
    expect(await retainedTokens()).toEqual({
      access_token: null,
      refresh_token: null,
      id_token: null,
    });
    googleEmail = "stranger@example.test";
    const stranger = f.browser();
    const denied = await signin(stranger);
    expect(denied.headers.get("Location")).toBe(
      "/login?error=account_access_denied",
    );
    expect(denied.status).toBe(303);
    expect(await denied.text()).toBe("");
    expect((await stranger.request("/api/owner/session")).status).toBe(401);
    expect(
      await f.db.prepare("SELECT COUNT(*) AS n FROM user").first(),
    ).toEqual({ n: 1 });
    await f.db
      .prepare(
        "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('stranger','Stranger','stranger@example.test',1,0,0)",
      )
      .run();
    const deniedAgain = await signin(stranger);
    expect(deniedAgain.headers.get("Location")).toBe(
      "/login?error=account_access_denied",
    );
    expect((await stranger.request("/api/owner/session")).status).toBe(401);
    expect(
      await f.db
        .prepare("SELECT COUNT(*) AS n FROM session WHERE user_id='stranger'")
        .first(),
    ).toEqual({ n: 0 });
    expect(
      (
        await client.request("/api/auth/sign-in/social", "POST", {
          provider: "google",
          callbackURL: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    // Changing the owner email removes the old Google binding. Only the newly
    // verified address may subsequently establish a Google session for this ID.
    f.db.connection.exec("UPDATE installation SET setup_state='ready'");
    const ownerId = (await f.control.owner())!.id;
    const change = await client.request("/api/account/email", "POST", {
      email: "replacement@example.test",
    });
    expect(change.status).toBe(200);
    const pending = await change.json();
    const inboxCode = (email: string) =>
      delivered
        .filter((mail) => mail.to === email)
        .at(-1)!
        .html.match(/<strong>(\d{6})<\/strong>/)![1];
    expect(
      (
        await client.request("/api/account/email/confirm", "POST", {
          id: pending.id,
          currentCode: inboxCode(address),
          newCode: inboxCode("replacement@example.test"),
        })
      ).status,
    ).toBe(200);
    googleEmail = address;
    expect((await signin(f.browser())).headers.get("Location")).toBe(
      "/login?error=account_access_denied",
    );
    googleEmail = "replacement@example.test";
    const replacement = f.browser();
    expect((await signin(replacement)).status).toBe(302);
    expect((await replacement.request("/api/owner/session")).status).toBe(200);
    expect((await f.control.owner())!.id).toBe(ownerId);
  });
  it("uses recovery only to repair settings, never to finish setup or impersonate the owner", async () => {
    const f = make(),
      client = f.browser();
    await own(f, client);
    const owner = await f.control.owner(),
      recovery = f.browser(),
      token = await f.control.issueToken("recovery");
    expect(
      (
        await recovery.request("/api/setup/unlock", "POST", {
          token,
          kind: "recovery",
        })
      ).status,
    ).toBe(200);
    expect(
      (await (await recovery.request("/api/setup/status")).json()).actor,
    ).toBe("recovery");
    expect(
      (await recovery.request("/api/setup/complete", "POST", {})).status,
    ).toBe(403);
    expect((await recovery.request("/api/owner/session")).status).toBe(403);
    expect(
      (
        await recovery.request("/api/setup/identity", "POST", {
          name: "Attacker",
          email: "other@example.test",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await recovery.request("/api/setup/providers", "PUT", {
          ...mailConfig(),
          version: 1,
        })
      ).status,
    ).toBe(200);
    expect(await f.control.owner()).toEqual(owner);
    await f.control.issueToken("recovery");
    expect((await recovery.request("/api/setup/status")).status).toBe(401);
  });
  it("saves validated branding/region with optimistic concurrency and keeps sitter identity synchronized", async () => {
    const f = make(),
      client = f.browser();
    await own(f, client);
    const { logoUrl: _logo, ...branding } = defaultBranding;
    const input = {
      ...branding,
      businessName: "Maple & Paws",
      timeZone: "Europe/London",
      currency: "GBP",
      version: 1,
    };
    expect(
      (await client.request("/api/setup/appearance", "PUT", input)).status,
    ).toBe(200);
    expect(
      (await client.request("/api/setup/appearance", "PUT", input)).status,
    ).toBe(409);
    expect(
      (
        await client.request("/api/setup/appearance", "PUT", {
          ...input,
          version: 2,
          timeZone: "Fake/Timezone",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await client.request("/api/setup/appearance", "PUT", {
          ...input,
          version: 2,
          primaryColor: "url(https://evil.example)",
        })
      ).status,
    ).toBe(400);
    expect(
      await f.db
        .prepare("SELECT business_name,time_zone FROM sitter_profiles")
        .first(),
    ).toEqual({ business_name: "Maple & Paws", time_zone: "Europe/London" });
    await verify(client);
    expect(delivered.at(-1)!.subject).toBe("Your Maple & Paws sign-in code");
  });
  it("decodes/re-encodes logos, rejects SVG/malformed/oversized images, and protects uploads", async () => {
    const f = make(),
      client = f.browser();
    await unlock(f, client);
    const png = new Uint8Array(
      await sharp({
        create: { width: 32, height: 24, channels: 4, background: "#285943" },
      })
        .png()
        .toBuffer(),
    );
    const upload = (body: Uint8Array, type = "image/png", version = "1") =>
      client.request("/api/setup/logo", "POST", body, {
        "content-type": type,
        "x-installation-version": version,
      });
    expect(
      (
        await upload(
          new TextEncoder().encode(
            '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
          ),
          "image/svg+xml",
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await upload(
          new TextEncoder().encode(
            '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
          ),
        )
      ).status,
    ).toBe(400);
    expect((await upload(new Uint8Array(2 * 1024 * 1024 + 1))).status).toBe(
      413,
    );
    const big = new Uint8Array(
      await sharp({
        create: { width: 2100, height: 2100, channels: 3, background: "white" },
      })
        .png()
        .toBuffer(),
    );
    expect((await upload(big)).status).toBe(400);
    expect((await upload(png)).status).toBe(200);
    const image = await f.browser().request("/api/branding/logo");
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    const metadata = await sharp(
      Buffer.from(await image.arrayBuffer()),
    ).metadata();
    expect(metadata).toMatchObject({ format: "png", width: 32, height: 24 });
    expect(metadata.exif).toBeUndefined();
    expect((await upload(png)).status).toBe(409);
    const key = (await f.db
      .prepare("SELECT logo_key FROM installation")
      .first<{ logo_key: string }>())!.logo_key;
    expect((await f.browser().request(`/uploads/${digest(key)}`)).status).toBe(
      404,
    );
    expect(
      (await client.request("/api/setup/logo", "DELETE", { version: 2 }))
        .status,
    ).toBe(200);
    expect(await f.env.UPLOADS.get(key)).toBeNull();
    expect((await client.request("/api/branding/logo")).status).toBe(404);
  });
});
