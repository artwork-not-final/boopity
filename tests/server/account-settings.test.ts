import { afterEach, describe, expect, it, vi } from "vitest";
import { paymentFixture } from "../support/payment-fixture";

const fixtures: ReturnType<typeof paymentFixture>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.close();
  vi.restoreAllMocks();
});

async function fixture() {
  const f = paymentFixture();
  fixtures.push(f);
  const browser = f.browser();
  await browser.login("owner@example.test");
  const codes = new Map<string, string>();
  const originalSend = f.runtime.env.MAIL_TRANSPORT!.send;
  f.runtime.env.MAIL_TRANSPORT!.send = async (message, key) => {
    codes.set(message.to, message.html.match(/<strong>(\d{6})<\/strong>/)![1]);
    return originalSend(message, key);
  };
  async function start(email = "new@example.test", target = browser) {
    const response = await target.req("/api/account/email", "POST", { email });
    expect(response.status).toBe(200);
    return (await response.json()) as {
      id: string;
      newEmail: string;
      expiresAt: number;
    };
  }
  async function confirm(
    id: string,
    currentCode = codes.get("owner@example.test"),
    newCode = codes.get("new@example.test"),
    target = browser,
  ) {
    return target.req("/api/account/email/confirm", "POST", {
      id,
      currentCode,
      newCode,
    });
  }
  return { ...f, owner: browser, codes, start, confirm };
}

describe("owner account email changes", () => {
  it("requires both inboxes, preserves ownership/data and revokes only owner access", async () => {
    const f = await fixture();
    const client = f.browser();
    await client.login("alice@example.test");
    const secondOwner = f.browser();
    await secondOwner.login("owner@example.test");
    f.db.connection
      .exec(`INSERT INTO account(id,issuer,account_id,provider_id,user_id,created_at,updated_at)
      VALUES('google-old','https://accounts.google.com','google-old','google','owner',0,0);
      INSERT INTO operator_sessions VALUES('recovery-session','recovery',9999999999999);
      INSERT INTO operator_tokens(kind,digest,expires_at) VALUES('recovery','recovery-token',9999999999999);`);
    const beforeBookings = f.db.connection
      .prepare("SELECT * FROM bookings")
      .all();
    const beforeMemberships = f.db.connection
      .prepare("SELECT * FROM business_memberships")
      .all();
    const pending = await f.start(" NEW@example.test ");
    expect(pending.newEmail).toBe("new@example.test");
    expect(f.codes.get("owner@example.test")).not.toBe(
      f.codes.get("new@example.test"),
    );
    const stored = f.db.connection
      .prepare("SELECT * FROM owner_email_changes")
      .get()!;
    expect(stored.current_digest).toHaveLength(64);
    expect(stored.new_digest).toHaveLength(64);
    expect(stored.current_digest).not.toBe(f.codes.get("owner@example.test"));
    expect((await f.runtime.control.owner())!.email).toBe("owner@example.test");
    expect(
      (
        await f.confirm(
          pending.id,
          f.codes.get("new@example.test"),
          f.codes.get("owner@example.test"),
        )
      ).status,
    ).toBe(400);
    expect((await f.confirm(pending.id)).status).toBe(200);
    expect(await f.runtime.control.owner()).toMatchObject({
      id: "owner",
      email: "new@example.test",
      emailVerified: 1,
    });
    expect(
      f.db.connection.prepare("SELECT setup_state FROM installation").get()!
        .setup_state,
    ).toBe("ready");
    expect(
      f.db.connection.prepare("SELECT owner_email FROM setup_progress").get()!
        .owner_email,
    ).toBe("new@example.test");
    expect(f.db.connection.prepare("SELECT * FROM bookings").all()).toEqual(
      beforeBookings,
    );
    expect(
      f.db.connection.prepare("SELECT * FROM business_memberships").all(),
    ).toEqual(beforeMemberships);
    for (const table of [
      "account",
      "operator_sessions",
      "operator_tokens",
      "owner_email_changes",
    ])
      expect(
        f.db.connection.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n,
      ).toBe(0);
    expect((await f.owner.req("/api/account/email")).status).toBe(401);
    expect((await secondOwner.req("/api/account/email")).status).toBe(401);
    expect((await client.req("/api/auth/get-session")).status).toBe(200);
    expect(
      f.db.connection
        .prepare("SELECT COUNT(*) AS n FROM session WHERE user_id='alice'")
        .get()!.n,
    ).toBe(1);
    const next = f.browser();
    await next.login("new@example.test");
    expect((await next.req("/api/account/email")).status).toBe(200);
    expect(
      (await f.confirm(pending.id, undefined, undefined, next)).status,
    ).toBe(400);
    expect(
      (
        await f.owner.req("/api/auth/email-otp/send-verification-otp", "POST", {
          email: "owner@example.test",
          type: "sign-in",
        })
      ).status,
    ).toBe(403);
  });

  it("does not expose account state or send codes to unauthenticated users or clients", async () => {
    const f = await fixture();
    const anonymous = f.browser(),
      client = f.browser();
    await client.login("alice@example.test");
    f.codes.clear();
    for (const [browser, status] of [
      [anonymous, 401],
      [client, 403],
    ] as const) {
      expect((await browser.req("/api/account/email")).status).toBe(status);
      expect(
        (
          await browser.req("/api/account/email", "POST", {
            email: "new@example.test",
          })
        ).status,
      ).toBe(status);
      expect((await browser.req("/api/account/email", "DELETE")).status).toBe(
        status,
      );
    }
    expect(f.codes.size).toBe(0);
  });

  it("rejects cross-origin writes, malformed and already-used addresses", async () => {
    const f = await fixture();
    for (const [email, status] of [
      ["owner@example.test", 400],
      ["ALICE@example.test", 409],
      ["not-email", 400],
    ] as const)
      expect(
        (await f.owner.req("/api/account/email", "POST", { email })).status,
      ).toBe(status);
    expect(
      (
        await f.owner.req(
          "/api/account/email",
          "POST",
          { email: "new@example.test" },
          { origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
    expect(f.codes.size).toBe(0);
  });

  it("binds codes to the initiating session and lets another owner session cancel", async () => {
    const f = await fixture();
    const other = f.browser();
    await other.login("owner@example.test");
    const pending = await f.start();
    expect(await (await f.owner.req("/api/account/email")).json()).toEqual({
      pending,
    });
    expect(await (await other.req("/api/account/email")).json()).toEqual({
      pending: null,
    });
    expect(
      (await f.confirm(pending.id, undefined, undefined, other)).status,
    ).toBe(400);
    expect((await other.req("/api/account/email", "DELETE")).status).toBe(200);
    expect((await f.confirm(pending.id)).status).toBe(400);
  });

  it("rotates both codes on resend and keeps a server-side send budget", async () => {
    const f = await fixture();
    const previous = await f.start();
    const oldCode = f.codes.get("owner@example.test"),
      newCode = f.codes.get("new@example.test");
    const replacement = await f.start();
    expect((await f.confirm(previous.id, oldCode, newCode)).status).toBe(400);
    const throttled = await f.owner.req("/api/account/email", "POST", {
      email: "different@example.test",
    });
    expect(throttled.status).toBe(429);
    expect(Number(throttled.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await f.confirm(replacement.id)).status).toBe(200);
  });

  it("expires codes and limits guesses without changing the account", async () => {
    const f = await fixture();
    const pending = await f.start();
    for (let attempt = 0; attempt < 5; attempt++)
      expect(
        (await f.confirm(pending.id, "bad".padEnd(6, "0"), "111111")).status,
      ).toBe(400);
    // Malformed input does not reach the challenge; five valid wrong guesses do.
    for (let attempt = 0; attempt < 5; attempt++)
      expect(
        (
          await f.confirm(
            pending.id,
            f.codes.get("new@example.test"),
            f.codes.get("owner@example.test"),
          )
        ).status,
      ).toBe(400);
    expect((await f.confirm(pending.id)).status).toBe(400);
    const replacement = await f.start();
    f.db.connection
      .prepare("UPDATE owner_email_changes SET expires_at=?")
      .run(Date.now() - 1);
    expect((await f.confirm(replacement.id)).status).toBe(400);
    expect((await f.runtime.control.owner())!.email).toBe("owner@example.test");
  });

  it("does not reset the global guess budget by requesting replacement codes", async () => {
    const f = await fixture();
    const pending = await f.start();
    for (let i = 0; i < 5; i++)
      await f.confirm(
        pending.id,
        f.codes.get("new@example.test"),
        f.codes.get("owner@example.test"),
      );
    const replacement = await f.start();
    for (let i = 0; i < 4; i++)
      await f.confirm(
        replacement.id,
        f.codes.get("new@example.test"),
        f.codes.get("owner@example.test"),
      );
    const response = await f.confirm(replacement.id);
    expect(response.status).toBe(429); // The initial login also spent one verification.
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });

  it("invalidates a partial delivery and never exposes a provider error", async () => {
    const f = await fixture();
    const send = f.runtime.env.MAIL_TRANSPORT!.send;
    f.runtime.env.MAIL_TRANSPORT!.send = async (message, key) => {
      if (message.to === "new@example.test")
        throw new Error("PRIVATE PROVIDER CREDENTIAL");
      return send(message, key);
    };
    const response = await f.owner.req("/api/account/email", "POST", {
      email: "new@example.test",
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("PRIVATE");
    expect(
      f.db.connection
        .prepare("SELECT COUNT(*) AS n FROM owner_email_changes")
        .get()!.n,
    ).toBe(0);
    expect((await f.runtime.control.owner())!.email).toBe("owner@example.test");
  });

  it("rechecks a newly conflicting account at confirmation and rolls back all writes", async () => {
    const f = await fixture();
    const pending = await f.start();
    f.db.connection.exec(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES('taken','Other','NEW@example.test',1,0,0)",
    );
    expect((await f.confirm(pending.id)).status).toBe(400);
    expect((await f.runtime.control.owner())!.email).toBe("owner@example.test");
    expect(
      f.db.connection
        .prepare(
          "SELECT COUNT(*) AS n FROM installation_audit WHERE event='owner-email-changed'",
        )
        .get()!.n,
    ).toBe(0);
    expect((await f.owner.req("/api/account/email")).status).toBe(200);
  });

  it("rolls back identity and session changes if a later SQL statement fails", async () => {
    const f = await fixture();
    const pending = await f.start();
    f.db.connection.exec(
      "CREATE TRIGGER fail_email_change BEFORE DELETE ON session BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await f.confirm(pending.id)).status).toBe(500);
    expect((await f.runtime.control.owner())!.email).toBe("owner@example.test");
    expect((await f.owner.req("/api/account/email")).status).toBe(200);
    expect(
      f.db.connection
        .prepare(
          "SELECT COUNT(*) AS n FROM installation_audit WHERE event='owner-email-changed'",
        )
        .get()!.n,
    ).toBe(0);
    f.db.connection.exec("DROP TRIGGER fail_email_change");
    expect((await f.confirm(pending.id)).status).toBe(200);
  });
});
