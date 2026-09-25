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
} from "../platform/node/runtime";
import { createNodeApp } from "../platform/node/app";
// @ts-expect-error Standalone dependency-free maintainer tooling.
import { renderBlueprint } from "../scripts/render-blueprint.mjs";

const renderEnvironment = {
  BOOPITY_HOSTING: "render",
  RENDER: "true",
  RENDER_EXTERNAL_URL: "https://maple-fixture.onrender.com",
  RENDER_EXTERNAL_HOSTNAME: "maple-fixture.onrender.com",
};
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
    ...renderEnvironment,
    DATA_DIR: data,
    ASSET_DIR: data,
    ...environment,
  });
  const instance = createRuntime(config, environment);
  instances.add(instance);
  const app = createNodeApp(instance.env, config, instance.control);
  return { ...instance, config, app, instance };
}

describe("Render prototype", () => {
  it("uses the platform's HTTPS address only with an explicit adapter opt-in", () => {
    expect(loadConfig(renderEnvironment).appUrl).toBe(
      renderEnvironment.RENDER_EXTERNAL_URL,
    );
    expect(
      loadConfig({ ...renderEnvironment, BOOPITY_HOSTING: undefined }).appUrl,
    ).toBe("http://localhost:3000");
    expect(
      loadConfig({ ...renderEnvironment, APP_URL: "https://pets.example" })
        .appUrl,
    ).toBe("https://pets.example");
    expect(loadConfig({ APP_URL: "https://pets.example" }).appUrl).toBe(
      "https://pets.example",
    );
    expect(() => loadConfig({ BOOPITY_HOSTING: "unknown" })).toThrow();
  });
  it.each([
    { RENDER: "false" },
    { RENDER_EXTERNAL_URL: undefined },
    { RENDER_EXTERNAL_HOSTNAME: "other.onrender.com" },
    { RENDER_EXTERNAL_URL: "http://maple-fixture.onrender.com" },
    { RENDER_EXTERNAL_URL: "https://maple-fixture.onrender.com:3000" },
    { RENDER_EXTERNAL_URL: "https://maple-fixture.onrender.com/setup" },
    { RENDER_EXTERNAL_URL: "https://maple-fixture.onrender.com/?secret=value" },
    { RENDER_EXTERNAL_URL: "https://maple-fixture.onrender.com/#setup" },
    { RENDER_EXTERNAL_URL: "https://someone@maple-fixture.onrender.com" },
    {
      RENDER_EXTERNAL_URL: "https://onrender.com.evil.example",
      RENDER_EXTERNAL_HOSTNAME: "onrender.com.evil.example",
    },
  ])("fails closed on invalid platform metadata %j", (extra) => {
    expect(() => loadConfig({ ...renderEnvironment, ...extra })).toThrow();
  });
  it("does not start trusting forwarding headers merely because Render is selected", () => {
    const config = loadConfig(renderEnvironment);
    const request = new Request("http://maple-fixture.onrender.com/api/ready", {
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
  it("requires a digest and includes one paid disk-backed instance with no email, credentials or migrations hook", () => {
    const image = `registry.example/boopity/app@sha256:${"1234567890abcdef".repeat(4)}`;
    const blueprint = renderBlueprint(image);
    expect(blueprint.services).toHaveLength(1);
    const service = blueprint.services[0];
    expect(service).toMatchObject({
      runtime: "image",
      image: { url: image },
      plan: "0.5c-512mb",
      numInstances: 1,
      healthCheckPath: "/api/ready",
      disk: { mountPath: "/data", sizeGB: 1 },
    });
    expect(
      service.envVars.some(
        (v: { key: string }) => v.key === "BOOPITY_SETUP_TOKEN",
      ),
    ).toBe(false);
    expect(service.envVars.map((v: { key: string }) => v.key)).toEqual([
      "BOOPITY_HOSTING",
      "NODE_ENV",
      "HOST",
      "PORT",
      "DATA_DIR",
      "BOOPITY_SETUP_PASSWORD",
    ]);
    expect(
      service.envVars.find(
        (v: { key: string }) => v.key === "BOOPITY_SETUP_PASSWORD",
      ),
    ).toEqual({ key: "BOOPITY_SETUP_PASSWORD", sync: false });
    for (const key of [
      "repo",
      "buildCommand",
      "preDeployCommand",
      "initialDeployHook",
      "scaling",
      "autoDeployTrigger",
    ])
      expect(service[key]).toBeUndefined();
    const compose = readFileSync(
      new URL("../compose.image.yaml", import.meta.url),
      "utf8",
    );
    expect(compose).not.toContain("build:");
    expect(compose).toContain("${BOOPITY_IMAGE:?");
    expect(compose).toContain("boopity-data:/data");
    expect(compose).toContain(
      "BOOPITY_SETUP_PASSWORD: ${BOOPITY_SETUP_PASSWORD:-}",
    );
  });
  it.each([
    undefined,
    "",
    "registry.example/boopity:latest",
    "https://registry.example/a",
    "local-image",
    `registry.example/a@sha256:${"0".repeat(64)}`,
    `registry.example/a@sha256:${"ab".repeat(32)}\n`,
  ])("rejects absent or unpinned image input %j", (image) => {
    expect(() => renderBlueprint(image)).toThrow();
  });
});
