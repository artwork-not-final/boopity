import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { LocalDatabase } from "../../platform/node/sqlite";
import { LocalFiles } from "../../platform/node/files";
import {
  createRuntime,
  ingressRequest,
  loadConfig,
} from "../../platform/node/runtime";
import { createNodeApp, maintenanceTick } from "../../platform/node/app";
import { databaseLimiter } from "../../platform/limiter";
import { runLeasedJob } from "../../platform/jobs";
import { readInstallation, saveBranding } from "../../platform/installation";
import {
  brandingSchema,
  brandingVariables,
  contrastRatio,
  defaultBranding,
  readableForeground,
  themePresets,
} from "../../src/shared/branding";
import { createAuth } from "../../worker/auth";
import { requireSitter } from "../../worker/auth-middleware";
import { clientsApi } from "../../worker/clients";
import { clientList } from "../../platform/business/lists";
import {
  processNotifications,
  discoverBookingReminders,
} from "../../worker/notifications";
import { deliverEmail } from "../../worker/email";
import type { AppEnv } from "../../worker/env";

const directories: string[] = [];
const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function directory() {
  const path = mkdtempSync(join(tmpdir(), "boopity-foundation-"));
  directories.push(path);
  return path;
}
function runtime() {
  const data = directory();
  const config = loadConfig({
    DATA_DIR: data,
    ASSET_DIR: data,
    APP_URL: "http://localhost:3000",
  });
  const instance = createRuntime(config, {});
  let closed = false;
  const close = () => {
    if (!closed) {
      instance.close();
      closed = true;
    }
  };
  closers.push(close);
  return { ...instance, close, data, config };
}

describe("portable installation", () => {
  it("migrates a clean database, preserves records/branding/files/secret across restart", async () => {
    const first = runtime();
    await saveBranding(
      first.db,
      { ...defaultBranding, businessName: "Maple Pet Care" },
      1,
    );
    await first.env.UPLOADS.put("a/photo.png", new Uint8Array([1, 2, 3]));
    const originalSecret = first.env.BETTER_AUTH_SECRET;
    const migrationCount = await first.db
      .prepare("SELECT COUNT(*) AS count FROM boopity_migrations")
      .first<{ count: number }>();
    first.close();
    const second = createRuntime(first.config, {});
    closers.push(() => second.close());
    expect(second.env.BETTER_AUTH_SECRET).toBe(originalSecret);
    expect((await readInstallation(second.db)).branding.businessName).toBe(
      "Maple Pet Care",
    );
    expect(
      Array.from(
        new Uint8Array(
          await new Response(
            (await second.env.UPLOADS.get("a/photo.png"))!.body,
          ).arrayBuffer(),
        ),
      ),
    ).toEqual([1, 2, 3]);
    expect(
      await second.db
        .prepare("SELECT COUNT(*) AS count FROM boopity_migrations")
        .first(),
    ).toEqual(migrationCount);
    expect(statSync(join(first.data, "auth-secret")).mode & 0o777).toBe(0o600);
    expect(statSync(join(first.data, "boopity.sqlite")).mode & 0o777).toBe(
      0o600,
    );
  });

  it("rolls back a whole batch and does not mutate previously bound statements", async () => {
    const { db } = runtime();
    const statement = db.prepare(
      "INSERT INTO job_leases (name, token, lease_until) VALUES (?1, ?2, ?3)",
    );
    await expect(
      db.batch([
        statement.bind("same", "first", 1),
        statement.bind("same", "second", 2),
      ]),
    ).rejects.toThrow();
    expect(
      await db.prepare("SELECT COUNT(*) AS count FROM job_leases").first(),
    ).toEqual({ count: 0 });
    await db.batch([
      statement.bind("one", "first", 1),
      statement.bind("two", "second", 2),
    ]);
    expect(
      await db.prepare("SELECT token FROM job_leases ORDER BY name").raw(),
    ).toEqual([["first"], ["second"]]);
    expect(
      await db
        .prepare("SELECT token FROM job_leases WHERE name = ?")
        .bind("none")
        .first(),
    ).toBeNull();
  });

  it("rejects changed migrations and rolls back a failed migration set", async () => {
    const db = new LocalDatabase(":memory:");
    closers.push(() => db.close());
    const migrations = directory();
    writeFileSync(
      join(migrations, "0001_test.sql"),
      "CREATE TABLE fixture (id TEXT PRIMARY KEY);",
    );
    writeFileSync(join(migrations, "0002_bad.sql"), "THIS IS NOT SQL;");
    expect(() => db.migrate(migrations)).toThrow();
    expect(
      await db
        .prepare("SELECT name FROM sqlite_master WHERE name = 'fixture'")
        .first(),
    ).toBeNull();
    writeFileSync(
      join(migrations, "0002_bad.sql"),
      "INSERT INTO fixture VALUES ('one');",
    );
    db.migrate(migrations);
    db.migrate(migrations);
    writeFileSync(
      join(migrations, "0001_test.sql"),
      "CREATE TABLE changed (id TEXT);",
    );
    expect(() => db.migrate(migrations)).toThrow("Applied migration changed");
  });

  it("keeps owner/client roles explicit and enforces a single active owner", async () => {
    const { db } = runtime();
    for (const id of ["owner-a", "owner-b"])
      await db
        .prepare(
          "INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?1,?1,?1,1,0,0)",
        )
        .bind(id)
        .run();
    await db
      .prepare(
        "INSERT INTO business_memberships(user_id,role) VALUES ('owner-a','owner')",
      )
      .run();
    await expect(
      db
        .prepare(
          "INSERT INTO business_memberships(user_id,role) VALUES ('owner-b','owner')",
        )
        .run(),
    ).rejects.toThrow();
    await expect(
      db
        .prepare(
          "INSERT INTO business_memberships(user_id,role) VALUES ('owner-b','client')",
        )
        .run(),
    ).rejects.toThrow();
  });

  it("keeps every business/auth/payment/setup mutation closed before the wizard exists", async () => {
    const { db, env, config, data } = runtime();
    writeFileSync(
      join(data, "index.html"),
      "<html><body>Foundation</body></html>",
    );
    const app = createNodeApp(env, config);
    const get = (path: string) => app.request(`${config.appUrl}${path}`);
    expect((await get("/api/health")).status).toBe(200);
    const result = await get("/api/installation");
    expect(result.status).toBe(200);
    const body = await result.text();
    expect(body).not.toContain(env.BETTER_AUTH_SECRET);
    expect(body).not.toContain(data);
    for (const path of [
      "/api/clients",
      "/api/auth/sign-up/email",
      "/api/auth/sign-in/email-otp",
      "/api/auth/callback/google",
      "/api/stripe/webhook",
      "/api/billing/checkout",
      "/api/setup/complete",
    ]) {
      expect(
        (
          await app.request(`${config.appUrl}${path}`, {
            method: "POST",
            body: "{}",
          })
        ).status,
      ).toBe(404);
    }
    for (const path of [
      "/",
      "/setup",
      "/setup/account",
      "/setup/email",
      "/setup/business",
      "/setup/verify",
      "/setup/google",
      "/setup/review",
      "/setup/code",
      "/setup/recovery",
      "/setup/recovery/email",
      "/setup/password-help",
      "/setup/hosting-help",
      "/login",
      "/register",
      "/app/sitter/dashboard",
      "/app/bookings",
      "/app/bookings/new",
      "/app/bookings/id/history",
      "/app/bookings/id/payments",
      "/app/clients/id/pets/pet",
      "/app/rates/id",
      "/app/rules",
      "/app/cancellations",
      "/app/payments",
      "/app/pets",
      "/app/invitation",
      "/app/settings",
      "/app/settings/appearance",
      "/app/settings/email",
      "/app/settings/google",
    ]) {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'none'",
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    for (const path of [
      "/auth-secret",
      "/boopity.sqlite",
      "/.env",
      "/uploads/anything",
      "/assets/../../auth-secret",
      "/assets/%2e%2e%2fauth-secret",
    ])
      expect((await get(path)).status).toBe(404);
    expect((await app.request("http://evil.example/api/health")).status).toBe(
      421,
    );
    expect(
      await db.prepare("SELECT COUNT(*) AS count FROM user").first(),
    ).toEqual({ count: 0 });
  });

  it("serves browser notices without exposing adjacent private files", async () => {
    const { env, config, data } = runtime();
    const text = "Third-party licenses\nMIT license fixture\n";
    writeFileSync(join(data, "third-party-licenses.txt"), text);
    writeFileSync(join(data, "private.txt"), "not public");
    const app = createNodeApp(env, config);
    for (const method of ["GET", "HEAD"]) {
      const response = await app.request(
        `${config.appUrl}/third-party-licenses.txt`,
        { method },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "text/plain; charset=utf-8",
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await response.text()).toBe(method === "HEAD" ? "" : text);
    }
    expect((await app.request(`${config.appUrl}/private.txt`)).status).toBe(
      404,
    );
    expect(
      (await app.request("http://evil.example/third-party-licenses.txt"))
        .status,
    ).toBe(421);
  });

  it("strips forged IP/proxy headers and accepts only explicitly trusted proxies", () => {
    const config = loadConfig({ APP_URL: "https://pets.example" });
    const request = new Request("http://pets.example/api/health", {
      headers: {
        "cf-connecting-ip": "1.1.1.1",
        "x-forwarded-for": "2.2.2.2",
        "x-forwarded-host": "evil.example",
      },
    });
    const normalized = ingressRequest(request, config, "192.0.2.1")!;
    expect(normalized.url).toBe("https://pets.example/api/health");
    expect(normalized.headers.get("cf-connecting-ip")).toBe("192.0.2.1");
    expect(normalized.headers.get("x-forwarded-for")).toBeNull();
    expect(
      ingressRequest(
        request,
        { ...config, trustedProxyIps: ["192.0.2.1"] },
        "192.0.2.1",
      )!.headers.get("cf-connecting-ip"),
    ).toBe("2.2.2.2");
    expect(
      ingressRequest(
        new Request("http://evil.example/api/health"),
        config,
        "192.0.2.1",
      ),
    ).toBeNull();
    expect(() => loadConfig({ APP_URL: "http://pets.example" })).toThrow();
    expect(() => loadConfig({ TRUSTED_PROXY_IPS: "*" })).toThrow();
  });

  it("enforces shared limits concurrently and persists the budget across limiter objects", async () => {
    const { db, env } = runtime();
    const limiter = databaseLimiter(db, env.BETTER_AUTH_SECRET, "fixture", 3);
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        limiter.limit({ key: "private-client-ip" }),
      ),
    );
    expect(results.filter((result) => result.success)).toHaveLength(3);
    expect(
      await databaseLimiter(db, env.BETTER_AUTH_SECRET, "fixture", 3).limit({
        key: "private-client-ip",
      }),
    ).toEqual({ success: false });
    expect(
      JSON.stringify(await db.prepare("SELECT key FROM rate_limit").all()),
    ).not.toContain("private-client-ip");
  });

  it("allows only one concurrent job and never runs provider jobs during initial setup", async () => {
    const { db, env } = runtime();
    const run = vi.fn(async () => {});
    await Promise.all([
      runLeasedJob(db, "fixture", 60_000, run),
      runLeasedJob(db, "fixture", 60_000, run),
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("No network allowed"));
    await maintenanceTick(env);
    await maintenanceTick(env);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains a failed job's lease until expiry without hiding its failure", async () => {
    const { db } = runtime();
    const failure = new Error("Synthetic job failure");
    const failed = vi.fn(async () => {
      throw failure;
    });
    const retry = vi.fn(async () => {});
    const now = Date.now();
    await expect(runLeasedJob(db, "failure", 60_000, failed, now)).rejects.toBe(
      failure,
    );
    await expect(
      runLeasedJob(db, "failure", 60_000, retry, now + 1),
    ).resolves.toBe(false);
    expect(retry).not.toHaveBeenCalled();
    await expect(
      runLeasedJob(db, "failure", 60_000, retry, now + 300_001),
    ).resolves.toBe(true);
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("private local files", () => {
  it("stores path-like keys as opaque filenames and never exposes adjacent files", async () => {
    const data = directory(),
      store = new LocalFiles(join(data, "objects"));
    writeFileSync(join(data, "sensitive"), "private");
    await store.put("../../sensitive", "upload");
    expect(readFileSync(join(data, "sensitive"), "utf8")).toBe("private");
    expect(
      await new Response((await store.get("../../sensitive"))!.body).text(),
    ).toBe("upload");
    expect(await store.get("missing")).toBeNull();
    await store.delete("../../sensitive");
    expect(await store.get("../../sensitive")).toBeNull();
  });
  it("enforces actual streamed byte limits and preserves a prior object on failure", async () => {
    const store = new LocalFiles(directory());
    await store.put("photo", "original");
    await expect(
      store.put("photo", new Uint8Array(10 * 1024 * 1024 + 1)),
    ).rejects.toThrow("upload limit");
    expect(await new Response((await store.get("photo"))!.body).text()).toBe(
      "original",
    );
  });
});

describe("branding foundation", () => {
  it("validates config and creates readable foreground colors for each preset", () => {
    for (const theme of themePresets) {
      expect(
        contrastRatio(
          theme.primaryColor,
          readableForeground(theme.primaryColor),
        ),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme.accentColor, readableForeground(theme.accentColor)),
      ).toBeGreaterThanOrEqual(4.5);
    }
    for (const bad of [
      { primaryColor: "red; background:url(https://evil.example)" },
      { logoUrl: "https://evil.example/logo.svg" },
      { businessName: "" },
    ]) {
      expect(
        brandingSchema.safeParse({ ...defaultBranding, ...bad }).success,
      ).toBe(false);
    }
    expect(brandingVariables(defaultBranding)["--primary"]).toBe(
      defaultBranding.primaryColor,
    );
    const pale = brandingVariables({
      ...defaultBranding,
      primaryColor: "#ffffff",
    });
    expect(contrastRatio(pale["--ring"], "#faf8f5")).toBeGreaterThanOrEqual(3);
  });
  it("rejects stale appearance updates without overwriting the latest settings", async () => {
    const { db } = runtime();
    await saveBranding(db, { ...defaultBranding, businessName: "First" }, 1);
    await expect(
      saveBranding(db, { ...defaultBranding, businessName: "Stale" }, 1),
    ).rejects.toThrow("Appearance changed");
    expect((await readInstallation(db)).branding.businessName).toBe("First");
  });
});

describe("existing domain on the local adapter", () => {
  it("supports real Better Auth OTP/session/revocation without automatically creating a sitter", async () => {
    const { env, db } = runtime();
    let otp = "";
    env.EMAIL_FROM = "Care <hello@example.test>";
    env.EMAIL_DELIVERY_MODE = "live";
    env.MAIL_TRANSPORT = {
      idempotent: false,
      async send(message) {
        otp = message.html.match(/<strong>(\d{6})<\/strong>/)![1];
        return "local-test";
      },
    };
    const auth = createAuth(env);
    await auth.api.sendVerificationOTP({
      body: { email: "client@example.test", type: "sign-in" },
    });
    expect(otp).toMatch(/^\d{6}$/);
    const response = await auth.api.signInEmailOTP({
      body: { email: "client@example.test", otp, name: "Client" },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const cookies = response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    const headers = new Headers({ cookie: cookies });
    const session = await auth.api.getSession({ headers });
    expect(session?.user.email).toBe("client@example.test");
    expect(
      await db.prepare("SELECT COUNT(*) AS count FROM sitter_profiles").first(),
    ).toEqual({ count: 0 });
    const protectedApp = new Hono<AppEnv>();
    protectedApp.use("*", requireSitter);
    protectedApp.get("/", (c) => c.json({ ok: true }));
    expect(
      (await protectedApp.request(env.APP_URL, { headers }, env)).status,
    ).toBe(403);
    await db
      .prepare("DELETE FROM session WHERE user_id = ?1")
      .bind(session!.user.id)
      .run();
    expect(await auth.api.getSession({ headers })).toBeNull();
  });

  it("allows more than two clients without a subscription", async () => {
    const { db, env } = runtime();
    await db
      .prepare(
        "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('owner','Owner','owner@example.test',1,0,0)",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO sitter_profiles(id,user_id,business_name,created_at,updated_at) VALUES ('sitter','owner','Care',0,0)",
      )
      .run();
    const domain = new Hono<AppEnv>();
    domain.use("*", async (c, next) => {
      c.set("sitterId", "sitter");
      await next();
    });
    domain.get("/clients", clientList);
    domain.route("/clients", clientsApi);
    for (let i = 0; i < 4; i++) {
      const response = await domain.request(
        "/clients",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Client",
            lastName: String(i),
            email: "",
            phone: "",
            address: "",
            emergencyContactName: "",
            emergencyContactPhone: "",
            notes: "",
            status: "active",
          }),
        },
        env,
      );
      expect(response.status).toBe(201);
    }
    const list = await (await domain.request("/clients", {}, env)).json();
    expect(list.clients).toHaveLength(4);
    expect(list.pagination.hasMore).toBe(false);
    expect(list).not.toHaveProperty("meta");
  });

  it("requires recipient restrictions for every transport and never automatically retries ambiguous SMTP", async () => {
    const { db, env } = runtime();
    const send = vi.fn(async () => {
      throw new Error("Possible SMTP acceptance");
    });
    env.EMAIL_FROM = "Care <owner@example.test>";
    env.EMAIL_DELIVERY_MODE = "restricted";
    env.EMAIL_TEST_RECIPIENT = "approved@example.test";
    env.MAIL_TRANSPORT = { idempotent: false, send };
    await expect(
      deliverEmail(env, {
        from: env.EMAIL_FROM,
        to: "other@example.test",
        subject: "test",
        html: "test",
      }),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    env.EMAIL_DELIVERY_MODE = "live";
    env.NOTIFICATIONS_ENABLED = "true";
    await db
      .prepare(
        "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('owner','Owner','owner@example.test',1,0,0)",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO sitter_profiles(id,user_id,business_name,created_at,updated_at) VALUES ('sitter','owner','Care',0,0)",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO clients(id,sitter_id,first_name,last_name,email,created_at,updated_at) VALUES ('client','sitter','A','B','client@example.test',0,0)",
      )
      .run();
    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO bookings(id,sitter_id,client_id,service_name,start_at,end_at,start_date,end_date,total_amount_cents,created_at,updated_at)
      VALUES ('booking','sitter','client','Visit',?1,?2,'2026-09-10','2026-09-10',2000,0,0)`,
      )
      .bind(now + 3_600_000, now + 7_200_000)
      .run();
    await discoverBookingReminders(env, now);
    await processNotifications(env, now);
    const count = send.mock.calls.length;
    expect(count).toBeGreaterThan(0);
    await processNotifications(env, now + 3_600_000);
    expect(send).toHaveBeenCalledTimes(count);
    expect(
      (
        await db.prepare("SELECT status FROM notification_outbox").all()
      ).results.every((row) => row.status === "needs_review"),
    ).toBe(true);
  });
});
