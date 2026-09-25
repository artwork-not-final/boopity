import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, loadConfig } from "../../platform/node/runtime";
import { createNodeApp } from "../../platform/node/app";

const fixtures: { runtime: ReturnType<typeof createRuntime>; data: string }[] =
  [];
afterEach(() => {
  for (const { runtime, data } of fixtures.splice(0)) {
    runtime.close();
    rmSync(data, { recursive: true, force: true });
  }
});
function fixture() {
  const data = mkdtempSync(join(tmpdir(), "boopity-route-surface-"));
  const config = loadConfig({ DATA_DIR: data });
  const runtime = createRuntime(config, {});
  fixtures.push({ runtime, data });
  return createNodeApp(runtime.env, config, runtime.control);
}

describe("shipped Node API surface", () => {
  it("matches the documented registered methods and paths", () => {
    const app = fixture();
    const actual = [
      ...new Set(
        app.routes
          .filter(
            (route) => route.method !== "ALL" && route.path.startsWith("/api/"),
          )
          .map((route) => `${route.method} ${route.path}`),
      ),
    ].sort();
    const documentation = readFileSync(
      new URL("../../API-ROUTES.md", import.meta.url),
      "utf8",
    );
    const documented = [
      ...documentation.matchAll(/^(?:GET|HEAD|POST|PUT|DELETE) \/api\/\S+$/gm),
    ]
      .map((match) => match[0])
      .sort();
    expect(actual).toEqual(documented);
  });

  it("registers one handler for each CRM list/detail read", () => {
    const app = fixture();
    for (const suffix of [
      "clients",
      "clients/:id",
      "pets",
      "pets/:id",
      "services",
      "services/:id",
    ]) {
      expect(
        app.routes.filter(
          (route) =>
            route.method === "GET" &&
            route.path === `/api/business/owner/${suffix}`,
        ),
        suffix,
      ).toHaveLength(1);
    }
    expect(
      app.routes.some((route) =>
        /\/photo(?:\/|$)|\/documents(?:\/|$)|\/uploads(?:\/|$)|\/notifications(?:\/|$)/.test(
          route.path,
        ),
      ),
    ).toBe(false);
  });

  it("returns an API 404 rather than a setup error or HTML for unknown public routes", async () => {
    const app = fixture();
    for (const path of [
      "/api/not-a-feature",
      "/api/clients",
      "/api/documents",
      "/api/uploads",
      "/api/pets/example/photo",
      "/api/billing/checkout",
    ]) {
      const response = await app.request(`http://localhost:3000${path}`);
      expect(response.status, path).toBe(404);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(await response.json()).toEqual({
        error: "API endpoint not found.",
        code: "NOT_FOUND",
      });
    }
  });
});
