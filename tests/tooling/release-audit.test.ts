import { describe, expect, it } from "vitest";
// @ts-expect-error Standalone, dependency-free release script.
import { secretCategories, privatePath } from "../../scripts/release-audit.mjs";

describe("redacted release audit", () => {
  it("classifies common secrets without returning their values", () => {
    const value = "rk_" + "test_" + "A".repeat(28);
    expect(secretCategories(value)).toEqual(["stripe-secret"]);
    expect(JSON.stringify(secretCategories(value))).not.toContain(value);
    expect(secretCategories("-----BEGIN " + "RSA PRIVATE KEY-----")).toEqual([
      "private-key",
    ]);
    expect(
      secretCategories(
        "postgresql://owner:" + "secret-value" + "@db.example.test/boopity",
      ),
    ).toEqual(["credential-url"]);
    expect(
      secretCategories("GOOGLE_CLIENT_SECRET=\nBOOPITY_STRIPE_TEST_KEY=\n"),
    ).toEqual([]);
  });
  it("flags private files without treating example configuration as a secret file", () => {
    for (const path of [
      "web/.env",
      "web/.env.stripe-sandbox",
      "web/.dev.vars.preview",
      "web/.boopity/auth-secret",
      "web/settings-key",
      "web/backups/a",
      "data.sqlite-wal",
      ".idea/settings.xml",
      ".release-candidates/source/review.md",
      "web/.release-candidates/previous-installation/README.md",
      "pre-transition.bundle",
      ".env.self-hosted",
      ".boopity/auth-secret",
    ]) {
      expect(privatePath(path), path).toBe(true);
    }
    for (const path of [
      "web/.env.self-hosted.example",
      "web/.dev.vars.example",
      "web/package.json",
      "web/tests/server/self-hosted.test.ts",
      ".env.self-hosted.example",
      "package.json",
    ]) {
      expect(privatePath(path), path).toBe(false);
    }
  });
});
