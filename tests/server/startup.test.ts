import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRuntime, loadConfig } from "../../server/runtime/runtime";
import { createNodeApp } from "../../server/runtime/app";
import { digest } from "../../server/runtime/control";
import { announceStartup, canOpenSetupBrowser } from "../../server/startup";
import { readSetupLink } from "../../src/shared/setup-link";
import { Unlock } from "../../src/client/features/setup/Unlock";

const directories: string[] = [];
const instances = new Set<ReturnType<typeof createRuntime>>();
afterEach(() => {
  for (const instance of instances) instance.close();
  instances.clear();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function fixture(environment: NodeJS.ProcessEnv = {}, directory?: string) {
  directory ??= mkdtempSync(join(tmpdir(), "boopity-startup-"));
  if (!directories.includes(directory)) directories.push(directory);
  const config = loadConfig({ DATA_DIR: directory, ...environment });
  const runtime = createRuntime(config, environment);
  instances.add(runtime);
  return {
    ...runtime,
    runtime,
    config,
    directory,
    access: () => runtime.control.startupAccess(runtime.db.connection),
    app: createNodeApp(runtime.env, config, runtime.control),
    stop: () => {
      runtime.close();
      instances.delete(runtime);
    },
  };
}

describe("automatic private setup entry", () => {
  it("migrates an already-claimed installation with setup passwords permanently closed", async () => {
    const f = fixture();
    // Recreate the boundary before 0015; its permanent database ID stays 0008.
    f.db.connection.exec(`DROP TRIGGER close_setup_password_on_owner_insert;
      DROP TRIGGER close_setup_password_on_owner_update;
      DROP TABLE setup_password;
      DELETE FROM boopity_migrations WHERE name='0008_setup_password.sql';
      INSERT INTO user(id,name,email,email_verified,created_at,updated_at)
      VALUES ('owner','Owner','owner@example.test',1,0,0);
      INSERT INTO business_memberships(user_id,role) VALUES ('owner','owner');`);
    f.stop();
    const restarted = fixture(
      { BOOPITY_SETUP_PASSWORD: "obsolete" },
      f.directory,
    );
    expect(restarted.access()).toEqual({ mode: "owner" });
    expect(
      restarted.db.connection.prepare("SELECT * FROM setup_password").get(),
    ).toMatchObject({
      password_hash: null,
      host_hash: null,
      closed_at: 0,
    });
    expect(await restarted.control.setupPassword.enabled()).toBe(false);
  });
  it("uses a privately configured password without generating a setup link", async () => {
    const password = "synthetic private hosting password";
    const f = fixture({ BOOPITY_SETUP_PASSWORD: password });
    expect(f.access()).toEqual({ mode: "password" });
    expect(
      f.db.connection
        .prepare("SELECT count(*) AS n FROM operator_tokens")
        .get()!.n,
    ).toBe(0);
    const hash = f.db.connection
      .prepare("SELECT password_hash FROM setup_password")
      .get()!.password_hash;
    expect(hash).not.toContain(password);
    f.stop();
    const restarted = fixture(
      { BOOPITY_SETUP_PASSWORD: password },
      f.directory,
    );
    expect(
      restarted.db.connection
        .prepare("SELECT password_hash FROM setup_password")
        .get()!.password_hash,
    ).toBe(hash);
    expect(await restarted.control.setupEntry(restarted.env)).toBe("password");
    expect(await restarted.control.owner()).toBeNull();
  });
  it("allows private hosting recovery by changing the password and restarting", async () => {
    const f = fixture({
      BOOPITY_SETUP_PASSWORD: "synthetic previous hosting password",
    });
    const session = await f.control.setupPassword.unlock(
      "synthetic previous hosting password",
      604800,
    );
    f.stop();
    const replacement = "synthetic replacement hosting password";
    const restarted = fixture(
      { BOOPITY_SETUP_PASSWORD: replacement },
      f.directory,
    );
    expect(
      restarted.db.connection
        .prepare("SELECT 1 FROM operator_sessions WHERE digest=?")
        .get(digest(session)),
    ).toBeUndefined();
    await expect(
      restarted.control.setupPassword.unlock(
        "synthetic previous hosting password",
        604800,
      ),
    ).rejects.toThrow();
    await expect(
      restarted.control.setupPassword.unlock(replacement, 604800),
    ).resolves.toBeTruthy();
  });
  it("ignores an empty optional hosting setting and fails safely on an invalid password", () => {
    expect(fixture({ BOOPITY_SETUP_PASSWORD: "" }).access().mode).toBe("link");
    for (const value of ["short-secret", " ".repeat(15), "a".repeat(129)])
      expect(() => fixture({ BOOPITY_SETUP_PASSWORD: value })).toThrow(
        "The setup password must contain 15 to 128 characters.",
      );
  });
  it("creates a hashed, expiring link only when startup explicitly requests it, without mail or ownership", async () => {
    const f = fixture();
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("No network allowed"));
    expect(
      f.db.connection
        .prepare("SELECT count(*) AS n FROM operator_tokens")
        .get()!.n,
    ).toBe(0);
    const access = f.access();
    expect(access.mode).toBe("link");
    if (access.mode !== "link") throw new Error("Expected link");
    const stored = f.db.connection
      .prepare("SELECT * FROM operator_tokens")
      .get()!;
    expect(stored.digest).toBe(digest(access.token));
    expect(stored.expires_at).toBeGreaterThan(Date.now());
    expect(Number(stored.expires_at) - Date.now()).toBeLessThanOrEqual(
      30 * 60_000,
    );
    expect(JSON.stringify(stored)).not.toContain(access.token);
    for (const path of [
      "/api/ready",
      "/api/installation",
      "/api/setup/entry",
      "/api/setup/status",
    ]) {
      const reply = await f.app.request(f.config.appUrl + path);
      expect(await reply.text()).not.toContain(access.token);
      if (path === "/api/setup/status") expect(reply.status).toBe(401);
    }
    expect(await f.control.owner()).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });
  it("rotates an unused link on restart and rejects the earlier link", async () => {
    const f = fixture(),
      first = f.access();
    if (first.mode !== "link") throw new Error("Expected link");
    f.stop();
    const next = fixture({}, f.directory),
      second = next.access();
    if (second.mode !== "link") throw new Error("Expected link");
    expect(second.token).not.toBe(first.token);
    await expect(next.control.consume(first.token, "setup")).rejects.toThrow();
    await expect(
      next.control.consume(second.token, "setup"),
    ).resolves.toBeTruthy();
    await expect(next.control.consume(second.token, "setup")).rejects.toThrow();
  });
  it("preserves an active wizard session across restart and replaces access after expiry", async () => {
    const f = fixture(),
      first = f.access();
    if (first.mode !== "link") throw new Error("Expected link");
    const session = await f.control.consume(first.token, "setup");
    f.stop();
    const next = fixture({}, f.directory);
    expect(next.access()).toEqual({ mode: "resume" });
    expect(
      next.db.connection
        .prepare("SELECT 1 FROM operator_sessions WHERE digest=?")
        .get(digest(session)),
    ).toBeTruthy();
    const response = await next.app.request(
      next.config.appUrl + "/api/setup/status",
      {
        headers: { cookie: `${next.control.cookie}=${session}` },
      },
    );
    expect(response.status).toBe(200);
    next.db.connection
      .prepare("UPDATE operator_sessions SET expires_at=0")
      .run();
    expect(next.access().mode).toBe("link");
    await expect(next.control.consume(first.token, "setup")).rejects.toThrow();
  });
  it("never issues setup access for an owner, including unfinished setup and recovery", () => {
    const f = fixture();
    f.db.connection
      .exec(`INSERT INTO user(id,name,email,email_verified,created_at,updated_at)
      VALUES ('owner','Owner','owner@example.test',0,0,0);
      INSERT INTO business_memberships(user_id,role) VALUES ('owner','owner');`);
    expect(f.access()).toEqual({ mode: "owner" });
    expect(
      f.db.connection
        .prepare("SELECT count(*) AS n FROM operator_tokens")
        .get()!.n,
    ).toBe(0);
  });
  it.each([
    [{ BOOPITY_SETUP_LINK: "manual" }, "manual"],
    [
      { BOOPITY_SETUP_TOKEN: "synthetic-host-token-0000000000000000" },
      "manual",
    ],
    [{ BOOPITY_OWNER_EMAIL: "owner@example.test" }, "guided"],
  ])(
    "preserves explicitly configured bootstrap modes: %j",
    (environment, mode) => {
      const f = fixture(environment);
      const before = f.db.connection
        .prepare("SELECT * FROM operator_tokens")
        .all();
      expect(f.access()).toEqual({ mode });
      expect(
        f.db.connection.prepare("SELECT * FROM operator_tokens").all(),
      ).toEqual(before);
    },
  );
  it("requires valid startup preferences", () => {
    expect(() => loadConfig({ BOOPITY_SETUP_LINK: "public" })).toThrow();
    expect(() => loadConfig({ BOOPITY_OPEN_BROWSER: "sometimes" })).toThrow();
  });
});

describe("startup instructions and browser handoff", () => {
  const config = loadConfig({});
  it("opens the ordinary setup URL for password entry without logging credentials", async () => {
    const password = "synthetic private hosting password",
      log = vi.fn(),
      open = vi.fn();
    await announceStartup(
      config,
      { mode: "password" },
      {
        environment: { BOOPITY_SETUP_PASSWORD: password },
        interactive: true,
        log,
        open,
      },
    );
    expect(open).toHaveBeenCalledExactlyOnceWith(`${config.appUrl}/setup`);
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("setup password");
    expect(output).not.toContain(password);
    expect(output).not.toContain("#");
    expect(output).not.toContain("setup-link");
  });
  it("opens the same private fragment link printed to the local terminal", async () => {
    const log = vi.fn(),
      open = vi.fn().mockResolvedValue(true);
    await announceStartup(
      config,
      { mode: "link", token: "synthetic-startup-token-0000000000000" },
      {
        environment: {},
        interactive: true,
        log,
        open,
      },
    );
    const link = new URL(open.mock.calls[0][0]);
    expect(link.origin).toBe(config.appUrl);
    expect(link.pathname).toBe("/setup");
    expect(link.search).toBe("");
    expect(readSetupLink(link.hash).token).toBeTruthy();
    expect(log.mock.calls.flat().join("\n")).toContain(link.href);
  });
  it("opens only an interactive, matching loopback installation", () => {
    expect(canOpenSetupBrowser(config, {}, true)).toBe(true);
    expect(canOpenSetupBrowser(config, {}, false)).toBe(false);
    for (const environment of [
      { BOOPITY_OPEN_BROWSER: "false" },
      { CI: "true" },
      { SSH_CONNECTION: "synthetic" },
      { SSH_CLIENT: "synthetic" },
      { SSH_TTY: "synthetic" },
    ])
      expect(canOpenSetupBrowser(config, environment, true)).toBe(false);
    for (const changed of [
      { host: "0.0.0.0" },
      { host: "::" },
      { port: 3001 },
      { appUrl: "https://care.example.test" },
      { appUrl: "https://localhost:3000" },
    ])
      expect(canOpenSetupBrowser({ ...config, ...changed }, {}, true)).toBe(
        false,
      );
  });
  it("prints a link without launching anything on a server", async () => {
    const log = vi.fn(),
      open = vi.fn();
    await announceStartup(
      loadConfig({ APP_URL: "https://care.example.test", HOST: "0.0.0.0" }),
      { mode: "link", token: "synthetic-startup-token-0000000000000" },
      { environment: {}, interactive: false, log, open },
    );
    expect(open).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join("\n")).toContain(
      "https://care.example.test/setup#setup=",
    );
  });
  it.each(["owner", "resume", "guided", "manual"] as const)(
    "prints no credential and opens no browser in %s mode",
    async (mode) => {
      const log = vi.fn(),
        open = vi.fn();
      await announceStartup(
        config,
        { mode },
        { environment: {}, interactive: true, log, open },
      );
      expect(open).not.toHaveBeenCalled();
      expect(log.mock.calls.flat().join("\n")).not.toContain("#setup=");
    },
  );
  it("keeps a usable link if browser launch fails without echoing launch errors", async () => {
    const log = vi.fn(),
      open = vi.fn().mockRejectedValue(new Error("private-launch-error"));
    await announceStartup(
      config,
      { mode: "link", token: "synthetic-startup-token-0000000000000" },
      {
        environment: {},
        interactive: true,
        log,
        open,
      },
    );
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("Open the Finish setup link above");
    expect(output).not.toContain("private-launch-error");
  });
});

describe("simple setup welcome", () => {
  function render(recovery: boolean, linkToken: string | null) {
    return renderToStaticMarkup(
      createElement(Unlock, {
        recovery,
        linkToken,
        busy: false,
        run: async () => {},
        clearLink: () => {},
      }),
    );
  }
  it("has no setup-code field in the normal flow, with or without a link", () => {
    const linked = render(false, "synthetic-startup-token-0000000000000"),
      blank = render(false, null);
    for (const html of [linked, blank]) {
      expect(html).not.toContain("<input");
      expect(html).not.toContain("Advanced setup");
      expect(html).not.toContain("npm run manage");
    }
    expect(linked).toContain("expires after 30 minutes");
    expect(linked).toContain("Start setup");
    expect(linked).not.toContain("synthetic-startup-token");
    expect(blank).not.toContain("<form");
    expect(blank).toContain("Run the Boopity launcher again");
  });
  it("preserves the recovery code and limited-access warning", () => {
    const html = render(true, null);
    expect(html).toContain('type="password"');
    expect(html).toContain("Recovery code");
    expect(html).toContain("cannot access client records");
  });
});
