import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { googleCallbackErrors } from "../../server/auth/google-callback";
import { accountMutationLock } from "../../server/auth/account-lock";
import type { AppEnv } from "../../server/core/env";
import { LocalDatabase } from "../../server/runtime/sqlite";

describe("Google callback presentation", () => {
  it.each([403, 429, 500])(
    "turns a %i API failure into a same-site sign-in page",
    async (status) => {
      const app = new Hono<AppEnv>();
      app.use("*", googleCallbackErrors);
      app.get(
        "*",
        () =>
          new Response(
            JSON.stringify({
              code:
                status === 403
                  ? "ACCOUNT_ACCESS_DENIED"
                  : "private-provider-detail",
              message: "PRIVATE",
            }),
            {
              status,
              headers: {
                "Content-Type": "application/json",
                "Content-Length": "100",
                "Set-Cookie": "oauth-state=; Max-Age=0; HttpOnly",
              },
            },
          ),
      );
      const result = await app.request(
        "https://demo.example/api/auth/callback/google?code=SECRET&redirect=https://evil.example",
      );
      expect(result.status).toBe(303);
      expect(result.headers.get("Location")).toBe(
        `/login?error=${status === 403 ? "account_access_denied" : "google_sign_in_failed"}`,
      );
      expect(result.headers.get("Cache-Control")).toBe("no-store");
      expect(result.headers.get("Content-Length")).toBeNull();
      expect(result.headers.get("Set-Cookie")).toContain("Max-Age=0");
      expect(await result.text()).toBe("");
    },
  );

  it("strips provider details and untrusted redirect destinations", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", googleCallbackErrors);
    app.get(
      "*",
      () =>
        new Response(null, {
          status: 302,
          headers: {
            Location:
              "https://evil.example/?error=account_not_linked&email=PRIVATE&code=SECRET",
          },
        }),
    );
    const result = await app.request(
      "https://demo.example/api/auth/callback/google",
    );
    expect(result.status).toBe(303);
    expect(result.headers.get("Location")).toBe(
      "/login?error=account_not_linked",
    );
  });

  it("preserves successful callback redirects and all session cookies", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", googleCallbackErrors);
    app.get("*", () => {
      const headers = new Headers({ Location: "/app/bookings" });
      headers.append("Set-Cookie", "session=synthetic; HttpOnly");
      headers.append("Set-Cookie", "state=; Max-Age=0");
      return new Response(null, { status: 302, headers });
    });
    const result = await app.request(
      "https://demo.example/api/auth/callback/google",
    );
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/app/bookings");
    expect(result.headers.getSetCookie()).toHaveLength(2);
  });
});

it("serializes callbacks and email changes before loading auth state, without blocking ordinary reads", async () => {
  const db = new LocalDatabase(":memory:");
  try {
    const app = new Hono<AppEnv>();
    app.use("*", accountMutationLock(db));
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const entry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const events: string[] = [];
    app.get("/api/auth/callback/google", async (c) => {
      events.push("callback-start");
      entered();
      await blocked;
      events.push("callback-end");
      return c.text("callback");
    });
    app.post("/api/account/email/confirm", (c) => {
      events.push("change");
      return c.text("changed");
    });
    app.get("/api/auth/get-session", (c) => c.text("read"));
    const callback = app.request("/api/auth/callback/google");
    await entry;
    const change = app.request("/api/account/email/confirm", {
      method: "POST",
    });
    expect(await (await app.request("/api/auth/get-session")).text()).toBe(
      "read",
    );
    expect(events).toEqual(["callback-start"]);
    release();
    await Promise.all([callback, change]);
    expect(events).toEqual(["callback-start", "callback-end", "change"]);
  } finally {
    db.close();
  }
});

it("does not hold the auth lock while receiving a slow request body", async () => {
  const db = new LocalDatabase(":memory:");
  try {
    const app = new Hono<AppEnv>();
    app.use("*", accountMutationLock(db));
    app.post("/api/account/email", async (c) => c.json(await c.req.json()));
    app.get("/api/auth/callback/google", (c) => c.text("callback"));
    let upload!: ReadableStreamDefaultController<Uint8Array>;
    const slow = app.request(
      new Request("https://demo.example/api/account/email", {
        method: "POST",
        duplex: "half",
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            upload = controller;
          },
        }),
      } as RequestInit),
    );
    expect(await (await app.request("/api/auth/callback/google")).text()).toBe(
      "callback",
    );
    upload.enqueue(new TextEncoder().encode('{"email":"new@example.test"}'));
    upload.close();
    expect(await (await slow).json()).toEqual({ email: "new@example.test" });
  } finally {
    db.close();
  }
});
