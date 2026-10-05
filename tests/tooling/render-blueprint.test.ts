import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

// These are deployment-contract checks, not a substitute for Render validation.
const blueprint = read("render.yaml");

describe("optional Render installation", () => {
  it("runs one paid instance of the reviewed public release image", () => {
    expect(blueprint.match(/^  - type: web$/gm)).toHaveLength(1);
    for (const setting of [
      "    name: boopity",
      "    runtime: image",
      "    plan: 0.5c-512mb",
      "    numInstances: 1",
      "    healthCheckPath: /api/ready",
    ])
      expect(blueprint).toContain(setting);
    expect(blueprint).toContain(
      "url: ghcr.io/artwork-not-final/boopity@sha256:a753f4e0b63cf6d89573ce41cd3b85bda171b78e1808298e9c690dc60c318ecd",
    );
    expect(blueprint).not.toMatch(
      /^\s*(?:registryCredential|dockerCommand|buildCommand|startCommand|scaling|databases):/m,
    );
  });

  it("preserves the database and generated keys on a persistent data disk", () => {
    expect(blueprint).toContain(
      "    disk:\n      name: boopity-data\n      mountPath: /data\n      sizeGB: 1",
    );
    expect(blueprint).toContain("- key: DATA_DIR\n        value: /data");
    expect(blueprint).toContain("- key: HOST\n        value: 0.0.0.0");
    expect(blueprint).toContain('- key: PORT\n        value: "3000"');
    expect(blueprint).toContain("- key: NODE_ENV\n        value: production");
    expect(blueprint).toContain(
      '- key: BOOPITY_OPEN_BROWSER\n        value: "false"',
    );
    expect(blueprint).not.toMatch(
      /key: (?:SETUP_TOKEN|SETUP_PASSWORD|BETTER_AUTH_SECRET|DATABASE_URL)/,
    );
  });

  it("resolves the actual HTTPS origin through a self-reference, not an assumed hostname", () => {
    expect(blueprint).toContain(
      "- key: APP_URL\n        fromService:\n          type: web\n          name: boopity\n          envVarKey: RENDER_EXTERNAL_URL",
    );
    expect(blueprint).not.toMatch(/\$\{|\.onrender\.com|TRUSTED_PROXY_IPS/);
    // Provider-specific wiring belongs in the template, not the application.
    expect(read("server/runtime/config.ts")).not.toContain("RENDER_");
  });

  it("documents manual update control and the outstanding live-host checks", () => {
    expect(blueprint).toMatch(/generation: ["']?off["']?/);
    const guide = read("docs/guides/render.md");
    expect(guide).toContain(
      "https://render.com/deploy?repo=https://github.com/artwork-not-final/boopity",
    );
    expect(guide).toContain("**Auto Sync** to **No**");
    expect(guide).toContain("live Render acceptance check");
    expect(guide).toContain("operations.md#backup-contract");
    expect(guide).toContain("operations.md#upgrades-and-rollback");
    expect(guide).toContain("Review the price Render shows before approving.");
    expect(read(".dockerignore").split(/\r?\n/)).toContain("render.yaml");
  });
});
