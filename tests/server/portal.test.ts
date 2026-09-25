import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, loadConfig } from "../../server/runtime/runtime";
import { createNodeApp } from "../../server/runtime/app";
import {
  readPolicy,
  bookingWindow,
  unambiguousTime,
} from "../../server/business/booking-rules";
import { expireRequests } from "../../server/business/bookings";
import type { BookingPolicy } from "../../src/shared/portal";

const origin = "http://localhost:3000",
  ownerEmail = "owner@example.test";
const instances: {
  runtime: ReturnType<typeof createRuntime>;
  data: string;
  closed: boolean;
}[] = [];
let sent: { to: string; html: string }[] = [];
let googleEmail = "alice@example.test";
beforeEach(() => {
  sent = [];
  googleEmail = "alice@example.test";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "object" && "url" in input ? input.url : String(input);
      if (url === "https://api.resend.com/emails") {
        sent.push(JSON.parse(init!.body as string));
        return Response.json({ id: "synthetic" });
      }
      if (url === "https://oauth2.googleapis.com/token") {
        const payload = {
          sub: `google-${googleEmail}`,
          email: googleEmail,
          email_verified: true,
          name: "Synthetic Google client",
          iss: "https://accounts.google.com",
          aud: "local-client.apps.googleusercontent.com",
          exp: Math.floor(Date.now() / 1000) + 300,
        };
        return Response.json({
          access_token: "synthetic-access",
          refresh_token: "synthetic-refresh",
          token_type: "Bearer",
          expires_in: 300,
          id_token: [
            Buffer.from('{"alg":"RS256","typ":"JWT"}').toString("base64url"),
            Buffer.from(JSON.stringify(payload)).toString("base64url"),
            "synthetic-signature",
          ].join("."),
        });
      }
      throw new Error("Unexpected network request blocked");
    }),
  );
});
afterEach(() => {
  for (const f of instances.splice(0)) {
    if (!f.closed) f.runtime.close();
    rmSync(f.data, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture(extra: NodeJS.ProcessEnv = {}) {
  const data = mkdtempSync(join(tmpdir(), "boopity-portal-")),
    config = loadConfig({ APP_URL: origin, DATA_DIR: data });
  const runtime = createRuntime(config, {
    EMAIL_FROM: "hello@example.test",
    RESEND_API_KEY: "synthetic-secret",
    EMAIL_DELIVERY_MODE: "live",
    ...extra,
  });
  runtime.db.connection
    .exec(`INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('owner','Sitter','owner@example.test',1,0,0);
    INSERT INTO business_memberships(user_id,role) VALUES ('owner','owner');
    INSERT INTO sitter_profiles(id,user_id,business_name,time_zone,created_at,updated_at) VALUES ('business','owner','Maple care','America/New_York',0,0);
    UPDATE installation SET setup_state='ready';
    INSERT INTO clients(id,sitter_id,first_name,last_name,email,notes,status,created_at,updated_at) VALUES
      ('a','business','Alice','Able','alice@example.test','PRIVATE CLIENT ALPHA','active',0,0),('b','business','Bob','Baker','bob@example.test','PRIVATE CLIENT BETA','active',0,0);
    INSERT INTO pets(id,client_id,name,species,medical_conditions,created_at,updated_at) VALUES
      ('pet-a','a','Scout','dog','PRIVATE MEDICAL',0,0),('pet-b','b','Nori','cat','PRIVATE VET',0,0);
    INSERT INTO sitter_pet_notes(id,sitter_id,pet_id,notes,created_at,updated_at) VALUES ('private','business','pet-a','PRIVATE SITTER NOTES',0,0);
    INSERT INTO services(id,sitter_id,name,description,duration_minutes,price_cents,additional_pet_price_cents,portal_visible,created_at,updated_at)
      VALUES ('visit','business','Dog visit','PRIVATE RATE DESCRIPTION',30,3000,1000,1,0,0),('stay','business','Overnight stay','Private',NULL,8000,2000,1,0,0);`);
  const app = createNodeApp(runtime.env, config, runtime.control);
  let sequence = 0;
  const browser = (target = app) => {
    const cookies = new Map<string, string>();
    return {
      cookies,
      async req(
        path: string,
        method = "GET",
        body?: unknown,
        headers: Record<string, string> = {},
      ) {
        const response = await target.request(origin + path, {
          method,
          headers: {
            origin,
            "content-type": "application/json",
            "cf-connecting-ip": `192.0.2.${(++sequence % 250) + 1}`,
            cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
            ...headers,
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        for (const value of response.headers.getSetCookie()) {
          const pair = value.split(";", 1)[0],
            split = pair.indexOf("=");
          cookies.set(pair.slice(0, split), pair.slice(split + 1));
        }
        return response;
      },
    };
  };
  const f = {
    data,
    config,
    runtime,
    app,
    browser,
    db: runtime.db,
    closed: false,
  };
  instances.push(f);
  return f;
}
type Browser = ReturnType<ReturnType<typeof fixture>["browser"]>;
async function ok(response: Promise<Response>, status = 200) {
  const r = await response;
  const body = await r.json();
  expect(r.status, JSON.stringify(body)).toBe(status);
  return body;
}
async function login(browser: Browser, email: string) {
  await ok(
    browser.req("/api/auth/email-otp/send-verification-otp", "POST", {
      email,
      type: "sign-in",
    }),
  );
  const otp = sent
    .findLast((message) => message.to === email)!
    .html.match(/<strong>(\d{6})<\/strong>/)![1];
  await ok(
    browser.req("/api/auth/sign-in/email-otp", "POST", {
      email,
      otp,
      name: "Synthetic client",
    }),
  );
}
async function configure(
  f: ReturnType<typeof fixture>,
  owner: Browser,
  patch: Partial<BookingPolicy> = {},
) {
  await login(owner, ownerEmail);
  const policy = await readPolicy(f.db);
  await ok(
    owner.req("/api/business/owner/policy", "PUT", {
      ...policy,
      portalEnabled: true,
      horizonDays: 365,
      weekly: Array.from({ length: 7 }, (_, day) => ({
        day,
        start: "08:00",
        end: "20:00",
      })),
      ...patch,
    }),
  );
}
async function invite(owner: Browser, id = "a") {
  const result = await ok(
    owner.req(`/api/business/owner/clients/${id}/invitation`, "POST", {}),
    201,
  );
  return new URLSearchParams(new URL(result.url).hash.slice(1)).get("invite")!;
}
async function client(
  f: ReturnType<typeof fixture>,
  owner: Browser,
  id = "a",
  email = "alice@example.test",
) {
  const browser = f.browser(),
    token = await invite(owner, id);
  await ok(browser.req("/api/portal/invitation/open", "POST", { token }));
  await login(browser, email);
  await ok(browser.req("/api/portal/invitation/accept", "POST", {}));
  return browser;
}
const futureDate = () =>
  new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const request = (patch: Record<string, unknown> = {}) => ({
  requestId: crypto.randomUUID(),
  serviceId: "visit",
  petIds: ["pet-a"],
  startDate: futureDate(),
  startTime: "10:00",
  message: "Scout likes walks",
  ...patch,
});

describe("reloadable owner service details", () => {
  it("loads saved service rates and visibility, while enforcing owner and business access", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    const a = await client(f, owner);
    const path = "/api/business/owner/services/visit";
    expect((await ok(owner.req(path))).service).toMatchObject({
      id: "visit",
      name: "Dog visit",
      description: "PRIVATE RATE DESCRIPTION",
      priceCents: 3000,
      price: 30,
      additionalPetPrice: 10,
      isActive: true,
      portalVisible: 1,
    });
    f.db.connection.exec(
      "UPDATE services SET portal_visible=0,is_active=0 WHERE id='visit'",
    );
    expect((await ok(owner.req(path))).service).toMatchObject({
      isActive: false,
      portalVisible: 0,
    });
    await ok(f.browser().req(path), 401);
    await ok(a.req(path), 403);
    await ok(owner.req("/api/business/owner/services/missing"), 404);
    f.db.connection
      .exec(`INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('other-owner','Other','other@example.test',1,0,0);
      INSERT INTO sitter_profiles(id,user_id,business_name,time_zone,created_at,updated_at) VALUES ('other-business','other-owner','Other care','America/New_York',0,0);
      UPDATE services SET sitter_id='other-business' WHERE id='visit';`);
    await ok(owner.req(path), 404);
  });
});

describe("first booking progress", () => {
  it("derives progress from saved records, active prerequisites and booking history", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    const progress = async () =>
      (await ok(owner.req("/api/business/owner/first-booking"))).progress;
    expect(await progress()).toEqual({
      service: true,
      client: true,
      pet: true,
      booking: false,
      clientId: null,
    });
    f.db.connection.exec(
      "UPDATE clients SET status='archived' WHERE id='b'; UPDATE pets SET is_active=0; UPDATE services SET is_active=0;",
    );
    expect(await progress()).toEqual({
      service: false,
      client: true,
      pet: false,
      booking: false,
      clientId: "a",
    });
    f.db.connection.exec("UPDATE clients SET status='archived' WHERE id='a';");
    expect(await progress()).toEqual({
      service: false,
      client: false,
      pet: false,
      booking: false,
      clientId: null,
    });
    f.db.connection.exec(
      "UPDATE clients SET status='active' WHERE id='a'; UPDATE pets SET is_active=1 WHERE id='pet-a'; UPDATE services SET is_active=1 WHERE id='visit';",
    );
    await ok(
      owner.req("/api/business/bookings", "POST", request({ clientId: "a" })),
      201,
    );
    expect((await progress()).booking).toBe(true);
    f.db.connection.exec("UPDATE services SET is_active=0;");
    expect((await progress()).booking).toBe(true);
  });
  it("does not expose the checklist to clients or anonymous visitors", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    const invited = await client(f, owner);
    await ok(invited.req("/api/business/owner/first-booking"), 403);
    await ok(f.browser().req("/api/business/owner/first-booking"), 401);
  });
  it("does not count another business's services, clients or pets", async () => {
    const f = fixture(),
      owner = f.browser();
    await login(owner, ownerEmail);
    f.db.connection.exec(`
      UPDATE clients SET status='archived'; UPDATE services SET is_active=0;
      INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('other','Other sitter','other@example.test',1,0,0);
      INSERT INTO sitter_profiles(id,user_id,business_name,created_at,updated_at) VALUES ('other','other','Other business',0,0);
      INSERT INTO clients(id,sitter_id,first_name,last_name,email,status,created_at,updated_at) VALUES ('other','other','Other','Client','other-client@example.test','active',0,0);
      INSERT INTO pets(id,client_id,name,species,created_at,updated_at) VALUES ('other','other','Other pet','dog',0,0);
      INSERT INTO services(id,sitter_id,name,price_cents,created_at,updated_at) VALUES ('other','other','Other service',1000,0,0);
    `);
    const { progress } = await ok(
      owner.req("/api/business/owner/first-booking"),
    );
    expect(progress).toEqual({
      service: false,
      client: false,
      pet: false,
      booking: false,
      clientId: null,
    });
  });
});

describe("invitation-only client boundary", () => {
  it("defaults closed and never treats a client or recovery token as the owner", async () => {
    const f = fixture(),
      owner = f.browser(),
      outsider = f.browser();
    await login(owner, ownerEmail);
    expect((await readPolicy(f.db)).portalEnabled).toBe(false);
    await ok(
      owner.req("/api/business/owner/clients/a/invitation", "POST", {}),
      409,
    );
    await ok(
      outsider.req("/api/auth/email-otp/send-verification-otp", "POST", {
        email: "alice@example.test",
        type: "sign-in",
      }),
      403,
    );
    await ok(outsider.req("/api/business/owner/clients"), 401);
    await ok(
      outsider.req("/api/setup/unlock", "POST", {
        token: await f.runtime.control.issueToken("recovery"),
        kind: "recovery",
      }),
    );
    await ok(outsider.req("/api/business/owner/clients"), 401);
  });
  it("requires the invited verified inbox and consumes an invitation exactly once", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    const a = f.browser(),
      b = await client(f, owner, "b", "bob@example.test"),
      token = await invite(owner);
    await ok(b.req("/api/portal/invitation/open", "POST", { token }));
    await ok(b.req("/api/portal/invitation/accept", "POST", {}), 403);
    await ok(a.req("/api/portal/invitation/open", "POST", { token }));
    await login(a, "alice@example.test");
    expect((await ok(a.req("/api/portal/session"))).role).toBe("pending");
    await ok(a.req("/api/business/household"), 403);
    const results = await Promise.all([
      a.req("/api/portal/invitation/accept", "POST", {}),
      a.req("/api/portal/invitation/accept", "POST", {}),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await ok(a.req("/api/portal/session"))).role).toBe("client");
    await ok(a.req("/api/setup/status"), 401);
    await ok(a.req("/api/business/owner/clients"), 403);
    await ok(
      f.browser().req("/api/portal/invitation/open", "POST", { token }),
      400,
    );
    expect(
      await f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM business_memberships WHERE role='owner'",
        )
        .first(),
    ).toEqual({ n: 1 });
  });
  it("keeps client B, private notes, rate descriptions, documents and hidden APIs out of client A responses", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    const a = await client(f, owner);
    const household = await ok(a.req("/api/business/household"));
    expect(household.pets.map((p: { name: string }) => p.name)).toEqual([
      "Scout",
    ]);
    expect(JSON.stringify(household)).not.toMatch(
      /PRIVATE|Nori|bob@example|medical|notes|object/i,
    );
    expect(
      JSON.stringify(await ok(a.req("/api/business/services"))),
    ).not.toMatch(/PRIVATE|description/);
    for (const path of [
      "/api/business/owner/pets/pet-a",
      "/api/business/owner/clients/b",
      "/api/business/owner/financial-followups",
      "/api/business/owner/financial-followups/booking-a",
    ])
      await ok(a.req(path), 403);
    for (const path of [
      "/api/documents/private",
      "/api/pets/pet-b/photo",
      "/api/payments",
      "/api/billing/checkout",
    ])
      await ok(a.req(path), 404);
  });
  it("keeps deferred photos and documents closed without touching stored files or keys", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    const guest = await client(f, owner);
    f.db.connection.exec(
      "UPDATE pets SET photo_object_key='private-existing-photo' WHERE id='pet-a'",
    );
    const put = vi.spyOn(f.runtime.env.UPLOADS, "put");
    const remove = vi.spyOn(f.runtime.env.UPLOADS, "delete");
    const read = vi.spyOn(f.runtime.env.UPLOADS, "get");
    for (const path of [
      "/api/business/owner/pets/pet-a/photo",
      "/api/business/owner/documents",
      "/api/business/owner/uploads",
    ]) {
      for (const method of ["GET", "PUT", "DELETE"]) {
        await ok(
          owner.req(path, method, method === "GET" ? undefined : {}),
          404,
        );
        await ok(
          guest.req(path, method, method === "GET" ? undefined : {}),
          403,
        );
      }
    }
    const detail = await ok(owner.req("/api/business/owner/pets/pet-a"));
    expect(detail.pet.photoUrl).toBeNull();
    expect(JSON.stringify(detail)).not.toContain("private-existing-photo");
    expect(
      (
        await f.db
          .prepare("SELECT photo_object_key AS key FROM pets WHERE id='pet-a'")
          .first()
      )?.key,
    ).toBe("private-existing-photo");
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps paginated owner reads and unlimited client mutations on the actual Node routes", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    for (let index = 0; index < 3; index++) {
      const result = await ok(
        owner.req("/api/business/owner/clients", "POST", {
          firstName: "New",
          lastName: `Client ${index}`,
          status: "active",
        }),
        201,
      );
      const path = `/api/business/owner/clients/${result.client.id}`;
      await ok(owner.req(`${path}/archive`, "POST", {}));
      await ok(owner.req(`${path}/reactivate`, "POST", {}));
      await ok(owner.req(`${path}/reactivate`, "POST", {}), 409);
    }
    for (const collection of ["clients", "pets", "services"]) {
      const result = await ok(owner.req(`/api/business/owner/${collection}`));
      expect(result.pagination).toMatchObject({ hasMore: false });
      expect(result).not.toHaveProperty("meta");
    }
    const result = await ok(owner.req("/api/business/owner/clients"));
    expect(result.clients).toHaveLength(5);
    expect(result.clients.every((value: object) => !("pets" in value))).toBe(
      true,
    );
    const detail = await ok(owner.req("/api/business/owner/clients/a"));
    expect(detail.client).not.toHaveProperty("pets");
    expect(
      (await ok(owner.req("/api/business/owner/services/visit"))).service
        .portalVisible,
    ).toBe(1);
  });

  it("revokes stale sessions immediately on archive, email changes, explicit revocation and portal pause", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    let a = await client(f, owner);
    await ok(owner.req("/api/business/owner/clients/a/archive", "POST", {}));
    await ok(a.req("/api/business/household"), 401);
    await ok(owner.req("/api/business/owner/clients/a/reactivate", "POST", {}));
    await ok(
      a.req("/api/auth/email-otp/send-verification-otp", "POST", {
        email: "alice@example.test",
        type: "sign-in",
      }),
      403,
    );
    a = await client(f, owner);
    await ok(
      owner.req("/api/business/owner/clients/a", "PUT", {
        firstName: "Alice",
        lastName: "Able",
        email: "newalice@example.test",
      }),
    );
    await ok(a.req("/api/business/household"), 401);
    a = await client(f, owner, "a", "newalice@example.test");
    await ok(owner.req("/api/business/owner/clients/a/revoke", "POST", {}));
    await ok(a.req("/api/business/household"), 401);
    a = await client(f, owner, "a", "newalice@example.test");
    await ok(
      owner.req("/api/business/owner/policy", "PUT", {
        ...(await readPolicy(f.db)),
        portalEnabled: false,
      }),
    );
    await ok(a.req("/api/business/household"), 401);
    await ok(owner.req("/api/business/owner/clients"));
  });
  it("rejects expired/replaced invitations and never leaks their digests", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    const token = await invite(owner),
      replacement = await invite(owner);
    await ok(
      f.browser().req("/api/portal/invitation/open", "POST", { token }),
      400,
    );
    await f.db.prepare("UPDATE client_invitations SET expires_at=0").run();
    await ok(
      f
        .browser()
        .req("/api/portal/invitation/open", "POST", { token: replacement }),
      400,
    );
    expect(
      JSON.stringify(await ok(owner.req("/api/business/owner/access"))),
    ).not.toMatch(/digest|token|invite=/);
  });
  it("admits an invited Google client, links returning OTP users, discards tokens, and blocks revoked identities", async () => {
    const f = fixture({
        GOOGLE_CLIENT_ID: "local-client.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "synthetic-google-secret",
      }),
      owner = f.browser(),
      a = f.browser();
    await configure(f, owner);
    const token = await invite(owner);
    await ok(a.req("/api/portal/invitation/open", "POST", { token }));
    const signin = async (target: Browser) => {
      const start = await ok(
        target.req("/api/auth/sign-in/social", "POST", {
          provider: "google",
          callbackURL: "/app",
          errorCallbackURL: "/login",
        }),
      );
      const url = new URL(start.url);
      expect(url.searchParams.get("redirect_uri")).toBe(
        origin + "/api/auth/callback/google",
      );
      return target.req(
        `/api/auth/callback/google?code=synthetic&state=${encodeURIComponent(url.searchParams.get("state")!)}`,
      );
    };
    expect((await signin(a)).status).toBe(302);
    expect((await ok(a.req("/api/portal/session"))).role).toBe("pending");
    await ok(a.req("/api/business/household"), 403);
    await ok(a.req("/api/portal/invitation/accept", "POST", {}));
    expect((await ok(a.req("/api/portal/session"))).role).toBe("client");
    await ok(a.req("/api/auth/sign-out", "POST", {}));
    await signin(a);
    await ok(a.req("/api/business/household"));
    const b = await client(f, owner, "b", "bob@example.test");
    await ok(b.req("/api/auth/sign-out", "POST", {}));
    googleEmail = "bob@example.test";
    await signin(b);
    expect((await ok(b.req("/api/portal/session"))).clientId).toBe("b");
    expect(
      (
        await f.db
          .prepare(
            "SELECT access_token,refresh_token,id_token FROM account WHERE provider_id='google'",
          )
          .all()
      ).results,
    ).toEqual([
      { access_token: null, refresh_token: null, id_token: null },
      { access_token: null, refresh_token: null, id_token: null },
    ]);
    await ok(owner.req("/api/business/owner/clients/b/revoke", "POST", {}));
    await signin(b);
    await ok(b.req("/api/business/household"), 401);
    googleEmail = "stranger@example.test";
    await signin(f.browser());
    expect(
      await f.db
        .prepare(
          "SELECT count(*) AS n FROM user WHERE email='stranger@example.test'",
        )
        .first(),
    ).toEqual({ n: 0 });
    expect(
      await f.db
        .prepare(
          "SELECT count(*) AS n FROM business_memberships WHERE role='owner'",
        )
        .first(),
    ).toEqual({ n: 1 });
  });
  it("does not send invitation emails automatically or let client OTP prove owner setup readiness", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    await f.db
      .prepare(
        "UPDATE setup_progress SET mail_verified_at=NULL,mail_config_digest=NULL,mail_challenge_digest=NULL",
      )
      .run();
    const before = await f.db.prepare("SELECT * FROM setup_progress").first();
    sent = [];
    const token = await invite(owner);
    expect(sent).toEqual([]);
    const a = f.browser();
    await ok(a.req("/api/portal/invitation/open", "POST", { token }));
    await login(a, "alice@example.test");
    expect(await f.db.prepare("SELECT * FROM setup_progress").first()).toEqual(
      before,
    );
    expect(sent.map((message) => message.to)).toEqual(["alice@example.test"]);
  });
});

describe("bookings, races and policy snapshots", () => {
  it("preserves sessions, invitations and booking state across runtime replacement, with capacity shared by two database connections", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    const a = await client(f, owner),
      b = await client(f, owner, "b", "bob@example.test");
    const peer = createRuntime(f.config, {});
    try {
      const peerApp = createNodeApp(peer.env, f.config, peer.control),
        peerB = f.browser(peerApp);
      for (const [key, value] of b.cookies) peerB.cookies.set(key, value);
      const race = await Promise.all([
        a.req("/api/business/bookings", "POST", request()),
        peerB.req(
          "/api/business/bookings",
          "POST",
          request({ petIds: ["pet-b"] }),
        ),
      ]);
      expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        await peer.db.prepare("SELECT count(*) AS n FROM bookings").first(),
      ).toEqual({ n: 1 });
      expect((await readPolicy(peer.db)).portalEnabled).toBe(true);
      expect(
        await peer.db
          .prepare(
            "SELECT count(*) AS n FROM client_invitations WHERE consumed_at IS NOT NULL",
          )
          .first(),
      ).toEqual({ n: 2 });
      f.runtime.close();
      f.closed = true;
      const peerOwner = f.browser(peerApp);
      for (const [key, value] of owner.cookies)
        peerOwner.cookies.set(key, value);
      expect(
        (await ok(peerOwner.req("/api/business/bookings"))).bookings,
      ).toHaveLength(1);
      expect(
        (await ok(peerB.req("/api/business/household"))).pets[0].name,
      ).toBe("Nori");
    } finally {
      peer.close();
    }
  });
  it("returns only free slots and honors epoch overlap after the business timezone changes", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner, {
      weekly: Array.from({ length: 7 }, (_, day) => ({
        day,
        start: "00:00",
        end: "23:59",
      })),
    });
    const a = await client(f, owner);
    const booking = await ok(
      owner.req(
        "/api/business/bookings",
        "POST",
        request({ clientId: "b", petIds: ["pet-b"], startTime: "23:00" }),
      ),
      201,
    );
    const day = futureDate();
    const available = await ok(
      a.req(`/api/business/availability?serviceId=visit&startDate=${day}`),
    );
    expect(Object.keys(available).sort()).toEqual([
      "provisional",
      "slots",
      "timeZone",
    ]);
    expect(available.slots).not.toContainEqual({ startTime: "23:00" });
    expect(available.slots).toContainEqual({ startTime: "22:30" });
    expect(JSON.stringify(available)).not.toMatch(
      /PRIVATE|Bob|Nori|bookingId|clientId/,
    );
    await f.db
      .prepare(
        "UPDATE installation SET time_zone='Asia/Tokyo',version=version+1",
      )
      .run();
    const tokyo = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(booking.booking.startAt);
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(booking.booking.startAt);
    expect(tokyo).not.toBe(day);
    const changed = await ok(
      a.req(`/api/business/availability?serviceId=visit&startDate=${tokyo}`),
    );
    expect(changed.timeZone).toBe("Asia/Tokyo");
    expect(changed.slots).not.toContainEqual({ startTime: time });
    await ok(
      a.req(
        "/api/business/bookings",
        "POST",
        request({ startDate: tokyo, startTime: time }),
      ),
      409,
    );
    await ok(
      owner.req("/api/business/owner/policy", "PUT", {
        ...(await readPolicy(f.db)),
        blockedDates: [tokyo],
      }),
    );
    expect(
      (
        await ok(
          a.req(
            `/api/business/availability?serviceId=visit&startDate=${tokyo}`,
          ),
        )
      ).slots,
    ).toEqual([]);
  });
  it("requires active owned pets and a published service, ignoring forged price/status/roles", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    const a = await client(f, owner);
    await ok(
      a.req("/api/business/bookings", "POST", request({ clientId: "b" })),
      403,
    );
    await ok(
      a.req("/api/business/bookings", "POST", request({ petIds: ["pet-b"] })),
      409,
    );
    await ok(
      a.req(
        "/api/business/bookings",
        "POST",
        request({ status: "active", totalAmountCents: 1, role: "owner" }),
      ),
      400,
    );
    await ok(
      owner.req("/api/business/owner/services/visit/visibility", "PUT", {
        visible: false,
      }),
    );
    await ok(a.req("/api/business/bookings", "POST", request()), 400);
    await ok(
      owner.req("/api/business/owner/services/visit/visibility", "PUT", {
        visible: true,
      }),
    );
    const created = await ok(
      a.req("/api/business/bookings", "POST", request()),
      201,
    );
    expect(created.booking).toMatchObject({
      status: "requested",
      totalAmountCents: 3000,
      price: { currency: "USD", baseCents: 3000 },
    });
  });
  it("reserves capacity atomically across clients and idempotently retries the same request", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    const a = await client(f, owner),
      b = await client(f, owner, "b", "bob@example.test");
    const body = request();
    const results = await Promise.all([
      a.req("/api/business/bookings", "POST", body),
      a.req("/api/business/bookings", "POST", body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    await ok(
      b.req("/api/business/bookings", "POST", request({ petIds: ["pet-b"] })),
      409,
    );
    await ok(
      a.req("/api/business/bookings", "POST", { ...body, startTime: "11:00" }),
      409,
    );
    const race = await Promise.all([
      a.req("/api/business/bookings", "POST", request({ startTime: "12:00" })),
      b.req(
        "/api/business/bookings",
        "POST",
        request({ startTime: "12:00", petIds: ["pet-b"] }),
      ),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await f.db
        .prepare(
          "SELECT count(*) AS n FROM booking_history WHERE event='requested'",
        )
        .first(),
    ).toEqual({ n: 2 });
  });
  it("uses bounded approval holds, expires them once, and never approves an expired request", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    const a = await client(f, owner);
    const { booking } = await ok(
      a.req("/api/business/bookings", "POST", request()),
      201,
    );
    expect(booking.requestExpiresAt - Date.now()).toBeLessThanOrEqual(
      24 * 3_600_000,
    );
    await f.db
      .prepare("UPDATE bookings SET request_expires_at=0 WHERE id=?1")
      .bind(booking.id)
      .run();
    await expireRequests(f.db);
    await expireRequests(f.db);
    await ok(
      owner.req(`/api/business/bookings/${booking.id}/transition`, "POST", {
        version: booking.version,
        action: "approve",
      }),
      409,
    );
    expect(
      (await ok(a.req(`/api/business/bookings/${booking.id}`))).booking.status,
    ).toBe("expired");
    expect(
      await f.db
        .prepare(
          "SELECT count(*) AS n FROM booking_history WHERE event='expired'",
        )
        .first(),
    ).toEqual({ n: 1 });
    await ok(a.req("/api/business/bookings", "POST", request()), 201);
  });
  it("supports explicit instant confirmation and half-open adjacent slots", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner, { approvalMode: "instant" });
    const a = await client(f, owner);
    const { booking } = await ok(
      a.req("/api/business/bookings", "POST", request()),
      201,
    );
    expect(booking.status).toBe("active");
    expect(booking.requestExpiresAt).toBeNull();
    await ok(
      a.req("/api/business/bookings", "POST", request({ startTime: "10:30" })),
      201,
    );
    await ok(
      a.req("/api/business/bookings", "POST", request({ startTime: "10:15" })),
      409,
    );
  });
  it("snapshots rates and cancellation policy, isolates reads and cancels without changing payment state", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    const a = await client(f, owner),
      b = await client(f, owner, "b", "bob@example.test");
    const { booking } = await ok(
      a.req("/api/business/bookings", "POST", request()),
      201,
    );
    await ok(
      owner.req(`/api/business/bookings/${booking.id}/notes`, "PUT", {
        version: 1,
        privateNotes: "PRIVATE VISIT NOTE",
        clientUpdate: "Scout had a lovely walk.",
      }),
    );
    await ok(
      owner.req("/api/business/owner/policy", "PUT", {
        ...(await readPolicy(f.db)),
        cancelHours: 720,
      }),
    );
    await ok(
      owner.req("/api/business/owner/services/visit", "PUT", {
        name: "New rate",
        durationMinutes: 30,
        price: 99,
        additionalPetPrice: 5,
      }),
    );
    const detail = await ok(a.req(`/api/business/bookings/${booking.id}`));
    expect(detail.booking).toMatchObject({
      serviceName: "Dog visit",
      totalAmountCents: 3000,
      policy: { cancelHours: 24 },
      clientUpdate: "Scout had a lovely walk.",
    });
    expect(JSON.stringify(detail)).not.toMatch(
      /PRIVATE|privateNotes|postServiceNotes/,
    );
    await ok(b.req(`/api/business/bookings/${booking.id}`), 404);
    await ok(
      b.req(`/api/business/bookings/${booking.id}/transition`, "POST", {
        version: 2,
        action: "cancel",
        reason: "Forged",
      }),
      404,
    );
    expect((await ok(b.req("/api/business/bookings"))).bookings).toEqual([]);
    await f.db
      .prepare("UPDATE bookings SET payment_status='paid' WHERE id=?1")
      .bind(booking.id)
      .run();
    await ok(
      a.req(`/api/business/bookings/${booking.id}/transition`, "POST", {
        version: 2,
        action: "cancel",
        reason: "Plans changed",
      }),
    );
    expect(
      await f.db
        .prepare("SELECT status,payment_status FROM bookings WHERE id=?1")
        .bind(booking.id)
        .first(),
    ).toEqual({ status: "cancelled", payment_status: "paid" });
    const followups = await ok(
      owner.req("/api/business/owner/financial-followups"),
    );
    expect(followups.followups).toHaveLength(1);
    const cancellationPath = `/api/business/owner/financial-followups/${booking.id}`;
    const cancellationDetail = await ok(owner.req(cancellationPath));
    expect(cancellationDetail.followup).toEqual(followups.followups[0]);
    await ok(a.req(cancellationPath), 403);
    await ok(f.browser().req(cancellationPath), 401);
    await ok(owner.req("/api/business/owner/financial-followups/missing"), 404);
    f.db.connection
      .exec(`INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('other-owner','Other','other@example.test',1,0,0);
      INSERT INTO sitter_profiles(id,user_id,business_name,time_zone,created_at,updated_at) VALUES ('other-business','other-owner','Other care','America/New_York',0,0);`);
    await f.db
      .prepare("UPDATE bookings SET sitter_id='other-business' WHERE id=?1")
      .bind(booking.id)
      .run();
    await ok(owner.req(cancellationPath), 404);
    await f.db
      .prepare("UPDATE bookings SET sitter_id=?1 WHERE id=?2")
      .bind("business", booking.id)
      .run();
    await ok(
      owner.req(
        `/api/business/owner/financial-followups/${booking.id}/resolve`,
        "POST",
        {
          resolution: "Reviewed separately; no refund performed here.",
          expectedCreatedAt: cancellationDetail.followup.createdAt,
          expectedReason: cancellationDetail.followup.reason,
        },
      ),
    );
    expect((await ok(owner.req(cancellationPath))).followup).toMatchObject({
      resolution: "Reviewed separately; no refund performed here.",
      resolvedAt: expect.any(Number),
    });
    await ok(
      owner.req(
        `/api/business/owner/financial-followups/${booking.id}/resolve`,
        "POST",
        {
          resolution: "Duplicate",
          expectedCreatedAt: cancellationDetail.followup.createdAt,
          expectedReason: cancellationDetail.followup.reason,
        },
      ),
      409,
    );
    expect(
      await f.db
        .prepare(
          "SELECT count(*) AS n FROM installation_audit WHERE event='cancellation-financial-review-recorded'",
        )
        .first(),
    ).toEqual({ n: 1 });
    expect(
      await f.db
        .prepare("SELECT payment_status FROM bookings WHERE id=?1")
        .bind(booking.id)
        .first(),
    ).toEqual({ payment_status: "paid" });
    await ok(
      a.req(`/api/business/bookings/${booking.id}/transition`, "POST", {
        version: 2,
        action: "cancel",
        reason: "Again",
      }),
      409,
    );
    expect(
      await f.db
        .prepare(
          "SELECT count(*) AS n FROM booking_history WHERE event='cancelled'",
        )
        .first(),
    ).toEqual({ n: 1 });
  });
  it("enforces cancellation cutoff, approval roles, optimistic versions and completion timing", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    const a = await client(f, owner);
    const { booking } = await ok(
      a.req("/api/business/bookings", "POST", request()),
      201,
    );
    await ok(
      a.req(`/api/business/bookings/${booking.id}/transition`, "POST", {
        version: 1,
        action: "approve",
      }),
      403,
    );
    await ok(
      owner.req(`/api/business/bookings/${booking.id}/transition`, "POST", {
        version: 1,
        action: "approve",
      }),
    );
    await ok(
      owner.req(`/api/business/bookings/${booking.id}/transition`, "POST", {
        version: 2,
        action: "complete",
      }),
      409,
    );
    await f.db
      .prepare("UPDATE bookings SET start_at=?1 WHERE id=?2")
      .bind(Date.now() + 3_600_000, booking.id)
      .run();
    await ok(
      a.req(`/api/business/bookings/${booking.id}/transition`, "POST", {
        version: 2,
        action: "cancel",
        reason: "Too late",
      }),
      409,
    );
    await ok(
      owner.req(`/api/business/bookings/${booking.id}/transition`, "POST", {
        version: 1,
        action: "cancel",
        reason: "Stale",
      }),
      409,
    );
    await ok(
      owner.req(`/api/business/bookings/${booking.id}/transition`, "POST", {
        version: 2,
        action: "cancel",
        reason: "Owner exception",
      }),
    );
  });
});

describe("sitter-recorded past bookings", () => {
  const past = { clientId: "a", startDate: "2025-09-01", startTime: "03:07" };
  const previewPath =
    "/api/business/availability?serviceId=visit&startDate=2025-09-01&startTime=03:07";

  it("records finished work outside current hours and blocked dates as completed, not paid", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner, { blockedDates: [past.startDate] });
    const mailCount = sent.length;
    expect(await ok(owner.req(previewPath))).toMatchObject({
      slots: [{ startTime: "03:07" }],
      historical: true,
      overlaps: false,
    });
    const before = Date.now();
    const { booking } = await ok(
      owner.req("/api/business/bookings", "POST", request(past)),
      201,
    );
    expect(booking).toMatchObject({
      status: "completed",
      startDate: past.startDate,
      startTime: past.startTime,
      endTime: "03:37",
      totalAmountCents: 3000,
      requestExpiresAt: null,
      canCancel: false,
    });
    const detail = await ok(owner.req(`/api/business/bookings/${booking.id}`));
    expect(detail.history).toHaveLength(1);
    expect(detail.history[0]).toMatchObject({
      event: "recorded-past",
      actorRole: "owner",
    });
    expect(detail.history[0].createdAt).toBeGreaterThanOrEqual(before);
    expect(detail.history[0].createdAt).toBeGreaterThan(booking.endAt);
    const payments = await ok(
      owner.req(`/api/business/payments/bookings/${booking.id}`),
    );
    expect(payments.attempts).toEqual([]);
    expect(
      payments.balances.find((b: { mode: string }) => b.mode === "live"),
    ).toMatchObject({
      status: "unpaid",
      receivedCents: 0,
      outstandingCents: 3000,
    });
    expect(sent).toHaveLength(mailCount);
    expect(
      (
        await ok(
          owner.req(
            "/api/business/bookings?status=completed&from=2025-09-01&to=2025-09-01",
          ),
        )
      ).bookings.map((b: { id: string }) => b.id),
    ).toContain(booking.id);
  });

  it("warns about completed and active overlaps without blocking historical entries, and keeps retries idempotent", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    const input = request(past);
    const first = await ok(
      owner.req("/api/business/bookings", "POST", input),
      201,
    );
    const replay = await ok(owner.req("/api/business/bookings", "POST", input));
    expect(replay).toMatchObject({
      replay: true,
      booking: { id: first.booking.id },
    });
    const warning = await ok(owner.req(previewPath));
    expect(warning).toMatchObject({
      historical: true,
      overlaps: true,
      slots: [{ startTime: "03:07" }],
    });
    expect(JSON.stringify(warning)).not.toMatch(
      /Alice|Scout|bookingId|clientId|PRIVATE/,
    );
    await f.db
      .prepare("UPDATE bookings SET status='active' WHERE id=?1")
      .bind(first.booking.id)
      .run();
    expect((await ok(owner.req(previewPath))).overlaps).toBe(true);
    const second = await ok(
      owner.req("/api/business/bookings", "POST", request(past)),
      201,
    );
    expect(second.booking.status).toBe("completed");
    expect(second.booking.id).not.toBe(first.booking.id);
    const detail = await ok(
      owner.req(`/api/business/bookings/${first.booking.id}`),
    );
    expect(detail.history).toHaveLength(1);
    await f.db.prepare("UPDATE bookings SET status='cancelled'").run();
    expect((await ok(owner.req(previewPath))).overlaps).toBe(false);
  });

  it("records all-day past stays but rejects stays still in progress", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner, { blockedDates: [past.startDate] });
    const result = await ok(
      owner.req(
        "/api/business/bookings",
        "POST",
        request({
          ...past,
          serviceId: "stay",
          startTime: undefined,
          endDate: "2025-09-03",
        }),
      ),
      201,
    );
    expect(result.booking).toMatchObject({
      status: "completed",
      totalAmountCents: 24000,
      startTime: null,
      endTime: null,
    });
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    await ok(
      owner.req(
        "/api/business/bookings",
        "POST",
        request({
          clientId: "a",
          serviceId: "stay",
          startTime: undefined,
          startDate: yesterday,
          endDate: futureDate(),
        }),
      ),
      409,
    );
  });

  it("does not allow clients or anonymous visitors to backdate or forge historical status", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    const a = await client(f, owner);
    await ok(a.req("/api/business/bookings", "POST", request(past)), 409);
    await ok(
      a.req(
        "/api/business/bookings",
        "POST",
        request({ ...past, historical: true }),
      ),
      400,
    );
    await ok(
      owner.req(
        "/api/business/bookings",
        "POST",
        request({ ...past, status: "completed" }),
      ),
      400,
    );
    await ok(
      f.browser().req("/api/business/bookings", "POST", request(past)),
      401,
    );
    const preview = await ok(a.req(previewPath));
    expect(preview.slots).toEqual([]);
    expect(preview).not.toHaveProperty("historical");
    expect(preview).not.toHaveProperty("overlaps");
  });

  it("keeps upcoming capacity, opening hours and blocked-date restrictions for sitters", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    const input = request({ clientId: "a" });
    await ok(owner.req("/api/business/bookings", "POST", input), 201);
    await ok(
      owner.req("/api/business/bookings", "POST", {
        ...input,
        requestId: crypto.randomUUID(),
      }),
      409,
    );
    const preview = await ok(
      owner.req(
        `/api/business/availability?serviceId=visit&startDate=${input.startDate}&startTime=10:00`,
      ),
    );
    expect(preview).toMatchObject({ slots: [], historical: false });
    await ok(
      owner.req(
        "/api/business/bookings",
        "POST",
        request({ clientId: "a", startTime: "03:07" }),
      ),
      409,
    );
    const policy = await readPolicy(f.db);
    await ok(
      owner.req("/api/business/owner/policy", "PUT", {
        ...policy,
        blockedDates: [input.startDate],
      }),
    );
    await ok(
      owner.req(
        "/api/business/bookings",
        "POST",
        request({ clientId: "a", startTime: "12:00" }),
      ),
      409,
    );
  });

  it("retains household, pet and service eligibility for past records", async () => {
    const f = fixture(),
      owner = f.browser();
    await configure(f, owner);
    await ok(
      owner.req(
        "/api/business/bookings",
        "POST",
        request({ ...past, petIds: ["pet-b"] }),
      ),
      409,
    );
    await f.db
      .prepare("UPDATE clients SET status='archived' WHERE id='a'")
      .run();
    await ok(owner.req("/api/business/bookings", "POST", request(past)), 409);
    await f.db.prepare("UPDATE clients SET status='active' WHERE id='a'").run();
    await f.db.prepare("UPDATE pets SET is_active=0 WHERE id='pet-a'").run();
    await ok(owner.req("/api/business/bookings", "POST", request(past)), 409);
    await f.db
      .prepare("UPDATE services SET is_active=0 WHERE id='visit'")
      .run();
    await ok(owner.req("/api/business/bookings", "POST", request(past)), 400);
  });
});

describe("business-local calendar rules", () => {
  const service = {
    id: "visit",
    name: "Visit",
    durationMinutes: 30,
    priceCents: 3000,
    additionalPetPriceCents: 1000,
  };
  const policy: BookingPolicy = {
    portalEnabled: true,
    approvalMode: "request",
    leadHours: 24,
    horizonDays: 90,
    cancelHours: 24,
    requestHoldHours: 24,
    weekly: Array.from({ length: 7 }, (_, day) => ({
      day,
      start: "00:00",
      end: "23:59",
    })),
    blockedDates: [],
  };
  it("rejects spring gaps, fall folds and visits crossing a clock change", () => {
    expect(() =>
      unambiguousTime("2027-03-14", "02:30", "America/New_York"),
    ).toThrow("does not exist");
    expect(() =>
      unambiguousTime("2026-11-01", "01:30", "America/New_York"),
    ).toThrow("occurs twice");
    expect(() =>
      unambiguousTime("2027-04-04", "01:45", "Australia/Lord_Howe"),
    ).toThrow("occurs twice");
    const input = request({ startDate: "2027-03-14", startTime: "01:30" });
    expect(() =>
      bookingWindow(
        input,
        { ...service, durationMinutes: 120 },
        policy,
        "America/New_York",
        true,
        Date.UTC(2027, 2, 1),
      ),
    ).toThrow("clock change");
  });
  it("allows only fully ended owner visits, including same-day cutoffs", () => {
    const input = request({ startDate: "2026-09-15", startTime: "10:00" });
    const end = unambiguousTime("2026-09-15", "10:30", "America/New_York");
    expect(
      bookingWindow(input, service, policy, "America/New_York", false, end)
        .historical,
    ).toBe(true);
    expect(() =>
      bookingWindow(input, service, policy, "America/New_York", false, end - 1),
    ).toThrow("already ended");
    expect(() =>
      bookingWindow(input, service, policy, "America/New_York", true, end),
    ).toThrow("notice");
    expect(() =>
      bookingWindow(
        request({ startDate: "2026-11-01", startTime: "01:30" }),
        service,
        policy,
        "America/New_York",
        false,
        Date.UTC(2027, 0, 1),
      ),
    ).toThrow("occurs twice");
  });
  it("uses exact notice cutoffs, blocked dates/opening hours and calendar-day horizons", () => {
    const input = request({ startDate: "2026-09-15", startTime: "10:00" }),
      start = unambiguousTime("2026-09-15", "10:00", "America/New_York");
    expect(
      bookingWindow(
        input,
        service,
        policy,
        "America/New_York",
        true,
        start - 24 * 3_600_000,
      ).startAt,
    ).toBe(start);
    expect(() =>
      bookingWindow(
        input,
        service,
        policy,
        "America/New_York",
        true,
        start - 24 * 3_600_000 + 1,
      ),
    ).toThrow("notice");
    expect(() =>
      bookingWindow(
        input,
        service,
        { ...policy, blockedDates: ["2026-09-15"] },
        "America/New_York",
        true,
        start - 48 * 3_600_000,
      ),
    ).toThrow("unavailable");
    expect(() =>
      bookingWindow(
        input,
        service,
        { ...policy, weekly: [] },
        "America/New_York",
        true,
        start - 48 * 3_600_000,
      ),
    ).toThrow("opening");
    expect(() =>
      bookingWindow(
        input,
        service,
        { ...policy, horizonDays: 1 },
        "America/New_York",
        true,
        start - 48 * 3_600_000,
      ),
    ).toThrow("calendar days");
  });
  it("prices multi-day stays by local dates across DST, ending at exclusive next midnight", () => {
    const input = request({
      startDate: "2026-10-31",
      endDate: "2026-11-01",
      startTime: undefined,
    });
    const result = bookingWindow(
      input,
      { ...service, durationMinutes: null },
      policy,
      "America/New_York",
      true,
      Date.UTC(2026, 9, 1),
    );
    expect(result.total).toBe(6000);
    expect(result.days).toBe(2);
    expect(result.endAt - result.startAt).toBe(49 * 3_600_000);
  });
});
