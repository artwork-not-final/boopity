// Actual compiled-server startup, using disposable local data and no provider credentials.
// Private links are captured in memory, never printed by this test.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as pause } from "node:timers/promises";

const directory = mkdtempSync(join(tmpdir(), "boopity-startup-cli-"));
let child, database;
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try {
    await exited;
  } finally {
    clearTimeout(timeout);
  }
}
async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
try {
  const port = await freePort(),
    origin = `http://127.0.0.1:${port}`;
  async function start() {
    let output = "",
      failed = false;
    child = spawn(process.execPath, ["dist/server/index.mjs"], {
      env: {
        PATH: process.env.PATH,
        APP_URL: origin,
        PORT: String(port),
        HOST: "127.0.0.1",
        DATA_DIR: directory,
        BOOPITY_OPEN_BROWSER: "false",
        NODE_NO_WARNINGS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", () => {});
    child.on("error", () => {
      failed = true;
    });
    const deadline = Date.now() + 10_000;
    while (!output.includes("Boopity is ready at")) {
      if (failed || child.exitCode !== null || Date.now() > deadline)
        throw new Error("Compiled startup failed");
      await pause(25);
    }
    // Startup prints the rest of its synchronous instructions in the same turn.
    await pause(50);
    assert.equal(
      (
        await fetch(origin + "/api/ready", {
          signal: AbortSignal.timeout(3_000),
        })
      ).status,
      200,
    );
    return output;
  }
  const first = await start();
  const link = new URL(
    first.match(/http[^\s]+\/setup#setup=[A-Za-z0-9_-]+/)?.[0],
  );
  assert.equal(link.origin, origin);
  assert.equal(link.search, "");
  const token = new URLSearchParams(link.hash.slice(1)).get("setup");
  assert(token);
  for (const path of [
    "/",
    "/setup",
    "/api/installation",
    "/api/setup/entry",
    "/api/setup/status",
  ]) {
    const response = await fetch(origin + path);
    assert(!(await response.text()).includes(token));
    if (path === "/api/setup/status") assert.equal(response.status, 401);
  }
  const request = (path, body, cookie) =>
    fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        origin,
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal(
    (
      await request("/api/setup/identity", {
        name: "Untrusted visitor",
        email: "visitor@example.test",
      })
    ).status,
    401,
  );
  const unlocked = await request("/api/setup/unlock", { token, kind: "setup" });
  assert.equal(unlocked.status, 200);
  assert(
    unlocked.headers
      .getSetCookie()
      .some(
        (value) =>
          value.includes("Max-Age=604800") &&
          value.includes("HttpOnly") &&
          value.includes("SameSite=Strict"),
      ),
  );
  const cookie = unlocked.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.equal(
    (
      await request(
        "/api/setup/identity",
        { name: "Synthetic owner", email: "owner@example.test" },
        cookie,
      )
    ).status,
    200,
  );
  await stop();
  const resumed = await start();
  assert(!resumed.includes("#setup="));
  assert(resumed.includes("Setup is in progress"));
  const status = await request("/api/setup/status", undefined, cookie);
  assert.equal(status.status, 200);
  const savedWithoutPassword = await status.json();
  assert.equal(savedWithoutPassword.pending.email, "owner@example.test");
  assert.equal(savedWithoutPassword.setupPasswordSet, false);
  assert.equal(savedWithoutPassword.owner, null);
  assert.equal(
    (await request("/api/setup/unlock", { token, kind: "setup" })).status,
    401,
  );
  await stop();
  database = new DatabaseSync(join(directory, "boopity.sqlite"));
  database.exec("UPDATE operator_sessions SET expires_at=0");
  const replacement = await start();
  assert(replacement.includes("#setup="));
  assert(!replacement.includes(token));
  const replacementLink = new URL(
    replacement.match(/http[^\s]+\/setup#setup=[A-Za-z0-9_-]+/)?.[0],
  );
  const access = await request("/api/setup/unlock", {
    token: new URLSearchParams(replacementLink.hash.slice(1)).get("setup"),
    kind: "setup",
  });
  assert.equal(access.status, 200);
  const nextCookie = access.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const setupPassword = "synthetic compiled setup password";
  assert.equal(
    (
      await request(
        "/api/setup/identity",
        {
          name: "Synthetic owner",
          email: "owner@example.test",
          setupPassword,
        },
        nextCookie,
      )
    ).status,
    200,
  );
  await stop();
  database.exec("UPDATE operator_sessions SET expires_at=0");
  const passwordStartup = await start();
  assert(!passwordStartup.includes("#setup="));
  assert(!passwordStartup.includes(setupPassword));
  assert(passwordStartup.includes("setup password"));
  assert.deepEqual(await (await request("/api/setup/entry")).json(), {
    mode: "password",
    started: true,
  });
  const signedIn = await request("/api/setup/password/unlock", {
    password: setupPassword,
  });
  assert.equal(signedIn.status, 200);
  const returnCookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const saved = await (
    await request("/api/setup/status", undefined, returnCookie)
  ).json();
  assert.equal(saved.pending.email, "owner@example.test");
  assert.equal(saved.setupPasswordSet, true);
  assert.equal(saved.readiness.email, false);
  await stop();
  database.exec(`INSERT INTO user(id,name,email,email_verified,created_at,updated_at)
    VALUES ('owner','Synthetic owner','owner@example.test',1,0,0);
    INSERT INTO business_memberships(user_id,role) VALUES ('owner','owner');`);
  const claimed = await start();
  assert(!claimed.includes("#setup="));
  assert(!claimed.includes("Finish setup"));
  assert.equal(
    (await request("/api/setup/password/unlock", { password: setupPassword }))
      .status,
    401,
  );
  assert.equal(
    database.prepare("SELECT password_hash FROM setup_password").get()
      .password_hash,
    null,
  );
  console.log(
    "Compiled startup passed: private entry, restart/resume, setup-password return without email, and password removal after owner claim. No emails sent or credentials printed by this test.",
  );
} catch {
  // Even an assertion error can contain a setup URL. Keep failure output secret-free.
  console.error(
    "Compiled startup checks failed. Re-run the local startup tests; private output was withheld.",
  );
  process.exitCode = 1;
} finally {
  await stop();
  database?.close();
  rmSync(directory, { recursive: true, force: true });
}
