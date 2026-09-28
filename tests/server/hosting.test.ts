import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig,
  createRuntime,
  ingressRequest,
} from "../../server/runtime/runtime";
import { createNodeApp } from "../../server/runtime/app";

const appUrl = "https://pets.example.test";
const directories: string[] = [];
const instances = new Set<ReturnType<typeof createRuntime>>();
afterEach(() => {
  for (const instance of instances) instance.close();
  instances.clear();
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function fixture(environment: NodeJS.ProcessEnv = {}) {
  const data = mkdtempSync(join(tmpdir(), "boopity-hosting-"));
  directories.push(data);
  const config = loadConfig({
    APP_URL: appUrl,
    DATA_DIR: data,
    ASSET_DIR: data,
    ...environment,
  });
  const instance = createRuntime(config, environment);
  instances.add(instance);
  const app = createNodeApp(instance.env, config, instance.control);
  return { ...instance, config, app, instance };
}

describe("provider-neutral hosting", () => {
  it("uses an explicit public origin independently of the host's port and bind address", () => {
    expect(
      loadConfig({ APP_URL: `${appUrl}/`, HOST: "0.0.0.0", PORT: "8080" }),
    ).toMatchObject({ appUrl, host: "0.0.0.0", port: 8080 });
    expect(loadConfig({}).appUrl).toBe("http://localhost:3000");
  });
  it("does not use retired adapter settings or platform metadata to choose an origin", () => {
    const metadata = {
      BOOPITY_HOSTING: "render",
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://untrusted.example.test",
      RENDER_EXTERNAL_HOSTNAME: "untrusted.example.test",
    };
    expect(loadConfig(metadata).appUrl).toBe("http://localhost:3000");
    expect(loadConfig({ ...metadata, APP_URL: appUrl }).appUrl).toBe(appUrl);
    expect(() => loadConfig({ ...metadata, APP_URL: "" })).toThrow();
  });
  it.each([
    "",
    "not a URL",
    "http://pets.example.test",
    "https://pets.example.test/setup",
    "https://pets.example.test/?secret=value",
    "https://pets.example.test/#setup",
    "https://someone@pets.example.test",
    "ftp://pets.example.test",
  ])("rejects unsafe or malformed APP_URL %j", (APP_URL) => {
    expect(() => loadConfig({ APP_URL })).toThrow();
  });
  it("rejects origins containing embedded credentials", () => {
    const address = new URL(appUrl);
    address.username = "fixture";
    address.password = "fixture";
    expect(() => loadConfig({ APP_URL: address.href })).toThrow();
  });
  it("does not trust forwarding headers without an explicitly trusted proxy", () => {
    const config = loadConfig({ APP_URL: appUrl });
    const request = new Request("http://pets.example.test/api/ready", {
      headers: {
        "x-forwarded-for": "198.51.100.10",
        "cf-connecting-ip": "198.51.100.11",
        "x-forwarded-proto": "http",
      },
    });
    const normalized = ingressRequest(request, config, "192.0.2.10")!;
    expect(normalized.url).toBe(`${config.appUrl}/api/ready`);
    expect(normalized.headers.get("cf-connecting-ip")).toBe("192.0.2.10");
    expect(normalized.headers.get("x-forwarded-proto")).toBeNull();
    expect(
      ingressRequest(
        new Request("http://evil.example/api/ready"),
        config,
        "192.0.2.10",
      ),
    ).toBeNull();
  });
  it("accepts the host's base64 setup code without email and preserves one-time consumption across restart", async () => {
    const token = randomBytes(32).toString("base64");
    const environment = { BOOPITY_SETUP_TOKEN: token };
    const f = fixture(environment);
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("No provider calls allowed"));
    const publicReply = await f.app.request(
      `${f.config.appUrl}/api/installation`,
    );
    expect(await publicReply.text()).not.toContain(token);
    expect(
      (await f.app.request(`${f.config.appUrl}/api/setup/status`)).status,
    ).toBe(401);
    const unlock = await f.app.request(`${f.config.appUrl}/api/setup/unlock`, {
      method: "POST",
      headers: { origin: f.config.appUrl, "content-type": "application/json" },
      body: JSON.stringify({ kind: "setup", token }),
    });
    expect(unlock.status).toBe(200);
    const cookie = unlock.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    const status = await f.app.request(`${f.config.appUrl}/api/setup/status`, {
      headers: { cookie: cookie.split(";")[0] },
    });
    expect(status.status).toBe(200);
    expect((await status.json()).readiness).toMatchObject({
      email: false,
      https: true,
      privateStorage: true,
    });
    expect(await f.control.owner()).toBeNull();
    expect(network).not.toHaveBeenCalled();
    const key = f.env.BETTER_AUTH_SECRET;
    f.close();
    instances.delete(f.instance);
    const restarted = createRuntime(f.config, environment);
    instances.add(restarted);
    expect(restarted.env.BETTER_AUTH_SECRET).toBe(key);
    await expect(restarted.control.consume(token, "setup")).rejects.toThrow();
  });
});

describe("host readiness", () => {
  it("keeps the noindex header on raw static responses, including cached assets and HEAD", async () => {
    const f = fixture();
    writeFileSync(
      join(f.config.assetDirectory, "index.html"),
      "<html><body>Fixture</body></html>",
    );
    mkdirSync(join(f.config.assetDirectory, "assets"));
    writeFileSync(
      join(f.config.assetDirectory, "assets", "fixture-123.js"),
      "export {};",
    );
    for (const method of ["GET", "HEAD"]) {
      for (const path of ["/", "/setup", "/app", "/assets/fixture-123.js"]) {
        const response = await f.app.request(`${f.config.appUrl}${path}`, {
          method,
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
        expect(response.headers.get("cache-control")).toBe(
          path.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "no-store",
        );
      }
    }
  });
  it("keeps repeated probes independent from provider configuration and visitor budgets", async () => {
    const f = fixture();
    const limiter = vi.spyOn(f.env.API_RATE_LIMITER!, "limit");
    const bindings = vi
      .spyOn(f.control, "bindings")
      .mockRejectedValue(new Error("Provider settings unavailable"));
    for (let count = 0; count < 130; count++) {
      const response = await f.app.request(`${f.config.appUrl}/api/ready`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(limiter).not.toHaveBeenCalled();
    expect(bindings).not.toHaveBeenCalled();
    expect((await f.app.request(`${f.config.appUrl}/api/health`)).status).toBe(
      500,
    );
    expect(bindings).toHaveBeenCalledTimes(1);
  });
  it("does not bypass origin checks, apply to mutations/adjacent paths, or hide database failure", async () => {
    const f = fixture();
    expect((await f.app.request("https://evil.example/api/ready")).status).toBe(
      421,
    );
    const limiter = vi.spyOn(f.env.API_RATE_LIMITER!, "limit");
    expect(
      (await f.app.request(`${f.config.appUrl}/api/ready`, { method: "HEAD" }))
        .status,
    ).toBe(200);
    expect(limiter).not.toHaveBeenCalled();
    expect(
      (await f.app.request(`${f.config.appUrl}/api/ready`, { method: "POST" }))
        .status,
    ).toBe(403);
    await f.app.request(`${f.config.appUrl}/api/ready-extra`);
    expect(limiter).toHaveBeenCalledTimes(2);
    f.close();
    instances.delete(f.instance);
    expect((await f.app.request(`${f.config.appUrl}/api/ready`)).status).toBe(
      500,
    );
  });
});

describe("image deployment packaging", () => {
  it("keeps prebuilt Compose portable with private setup configuration and persistent storage", () => {
    const compose = readFileSync(
      new URL("../../compose.image.yaml", import.meta.url),
      "utf8",
    );
    expect(compose).not.toContain("build:");
    expect(compose).toContain("${BOOPITY_IMAGE:?");
    expect(compose).toContain("boopity-data:/data");
    expect(compose).toContain(
      "BOOPITY_SETUP_PASSWORD: ${BOOPITY_SETUP_PASSWORD:-}",
    );
  });
});
