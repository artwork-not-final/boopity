// Opt-in, disposable loopback QA only. No environment files or provider keys are loaded.
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { serve } from "@hono/node-server";
import { ingressRequest } from "../../server/runtime/runtime";
import {
  largeListFixture,
  key,
  smallLists,
} from "../support/large-list-fixture";

const browser = process.argv.includes("--browser");
const browserPort =
  process.argv.find((arg) => /^--port=\d+$/.test(arg))?.slice(7) ?? "3360";
const origin = browser
  ? `http://localhost:${browserPort}`
  : "http://localhost:3362";
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (browser || url.origin !== origin)
    throw new Error("External network is blocked in local large-list QA");
  return nativeFetch(input, init);
};
const f = largeListFixture(
  origin,
  browser
    ? smallLists
    : {
        clients: 10_000,
        services: 2_000,
        bookings: 20_000,
        pets: 200,
        payments: 5_000,
        refunds: 200,
        history: 5_000,
      },
);
const server = serve({
  hostname: f.config.host,
  port: f.config.port,
  fetch(request, connection) {
    const normalized = ingressRequest(
      request,
      f.config,
      connection.incoming.socket.remoteAddress ?? "unknown",
    );
    if (!normalized) return new Response("Wrong host", { status: 421 });
    if (
      browser &&
      new URL(normalized.url).pathname === "/__qa_inbox" &&
      request.method === "GET"
    ) {
      return new Response(
        `<!doctype html><title>Synthetic list QA inbox</title><h1>Local synthetic inbox</h1><p>No emails or provider calls leave this computer.</p><ul>${[...f.codes].map(([email, code]) => `<li>${email}: <strong>${code}</strong></li>`).join("")}</ul>`,
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "content-security-policy":
              "default-src 'none'; frame-ancestors 'none'",
            "referrer-policy": "no-referrer",
          },
        },
      );
    }
    return f.app.fetch(normalized);
  },
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    if ("closeIdleConnections" in server) server.closeIdleConnections();
  });
  f.close();
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
try {
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  if (browser) {
    console.log(
      JSON.stringify({
        app: origin + "/app",
        inbox: origin + "/__qa_inbox",
        owner: "owner@example.test",
        client: "alice@example.test",
        counts: { ...f.size, pets: f.size.clients + f.size.pets },
        data: f.data,
        providerNetwork: "blocked",
      }),
    );
  } else {
    await f.login("owner");
    await f.login("alice");
    await f.login("bob");
    const workloads = [
      ["clients-first", "owner", "/owner/clients"],
      ["clients-deep", "owner", "/owner/clients?offset=9950"],
      ["clients-search", "owner", "/owner/clients?search=alice%40example.test"],
      ["services-deep", "owner", "/services?offset=1950"],
      ["bookings-deep", "owner", "/bookings?offset=19950"],
      ["followups-deep", "owner", "/owner/financial-followups?offset=19950"],
      [
        "payments-deep",
        "alice",
        `/payments/bookings/${key("booking", 0)}?attemptOffset=4950&historyOffset=4950`,
      ],
      [
        "refunds-deep",
        "alice",
        `/payments/attempts/${key("attempt", 4999)}/refunds?offset=150`,
      ],
      ["pets-deep", "alice", "/pets?offset=200"],
      ["household-bookings", "alice", "/bookings?offset=9950"],
    ] as const;
    const samples: { name: string; ms: number; bytes: number }[] = [];
    const request = async (role: string, path: string, ip: string) => {
      const response = await fetch(origin + "/api/business" + path, {
        headers: {
          origin,
          cookie: f.cookies.get(role)!,
          "x-forwarded-for": ip,
        },
      });
      return { response, text: await response.text() };
    };
    // Warm every query shape before timing; keep the production 120/minute/IP limiter enabled.
    for (const [, role, path] of workloads)
      assert.equal(
        (await request(role, path, "198.51.100.1")).response.status,
        200,
      );
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    const started = performance.now(),
      cpuStart = process.cpuUsage();
    const concurrency = 12,
      requestsPerClient = 60;
    await Promise.all(
      Array.from({ length: concurrency }, async (_, client) => {
        for (let n = 0; n < requestsPerClient; n++) {
          const [name, role, path] = workloads[(client + n) % workloads.length];
          const before = performance.now();
          const { response, text } = await request(
            role,
            path,
            `198.51.100.${client + 10}`,
          );
          assert.equal(response.status, 200, `${name}: ${response.status}`);
          const body = JSON.parse(text);
          if (name === "payments-deep")
            assert.equal(
              body.balances.find((b: { mode: string }) => b.mode === "live")
                .receivedCents,
              5000,
            );
          if (role === "alice")
            assert.ok(
              !text.includes("PRIVATE"),
              "Private notes escaped the client boundary",
            );
          samples.push({
            name,
            ms: performance.now() - before,
            bytes: Buffer.byteLength(text),
          });
        }
      }),
    );
    const elapsedMs = performance.now() - started,
      cpu = process.cpuUsage(cpuStart);
    delay.disable();
    assert.equal(
      (
        await request(
          "bob",
          `/payments/bookings/${key("booking", 0)}`,
          "198.51.100.100",
        )
      ).response.status,
      404,
    );
    assert.equal(
      (await request("alice", "/owner/clients?offset=9950", "198.51.100.100"))
        .response.status,
      403,
    );
    let limited = 0;
    for (let i = 0; i < 125; i++) {
      const { response } = await request(
        "owner",
        "/services?offset=1950",
        "198.51.100.200",
      );
      assert.ok(response.status === 200 || response.status === 429);
      if (response.status === 429) {
        limited++;
        assert.ok(response.headers.get("retry-after"));
      }
    }
    assert.equal(limited, 5, "Production per-IP limiter must remain active");
    const percentile = (values: number[], p: number) =>
      Math.round(
        [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] *
          10,
      ) / 10;
    console.log(
      JSON.stringify(
        {
          date: new Date().toISOString(),
          runtime: process.version,
          platform: process.platform,
          arch: process.arch,
          cpu: cpus()[0]?.model,
          cores: cpus().length,
          hostMemoryGiB: Math.round(totalmem() / 2 ** 30),
          counts: {
            ...f.size,
            pets: f.size.clients + f.size.pets,
            followups: f.size.bookings,
            ledgerEntries: f.size.payments,
          },
          databaseBytes: ["boopity.sqlite", "boopity.sqlite-wal"].reduce(
            (sum, file) => {
              try {
                return sum + statSync(join(f.data, file)).size;
              } catch {
                return sum;
              }
            },
            0,
          ),
          concurrency,
          requests: samples.length,
          failures: 0,
          elapsedMs: Math.round(elapsedMs),
          requestsPerSecond: Math.round((samples.length * 1000) / elapsedMs),
          cpuMs: Math.round((cpu.user + cpu.system) / 1000),
          rssMiB: Math.round(process.memoryUsage().rss / 2 ** 20),
          eventLoopP95Ms: Math.round(delay.percentile(95) / 1e5) / 10,
          results: workloads.map(([name]) => {
            const rows = samples.filter((s) => s.name === name);
            return {
              name,
              requests: rows.length,
              p50Ms: percentile(
                rows.map((s) => s.ms),
                0.5,
              ),
              p95Ms: percentile(
                rows.map((s) => s.ms),
                0.95,
              ),
              maxMs: percentile(
                rows.map((s) => s.ms),
                1,
              ),
              maxBytes: Math.max(...rows.map((s) => s.bytes)),
            };
          }),
          crossHouseholdChecks: "passed",
          rateLimitChecks: { allowed: 120, blocked: limited },
          caveat:
            "Synthetic loopback reads on this host, not a hosting capacity guarantee. SQLite is single-process; offset browsing is not a snapshot.",
          externalProviderRequests: 0,
        },
        null,
        2,
      ),
    );
    await stop();
  }
} catch (error) {
  await stop().catch(() => f.close());
  throw error;
}
