import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect } from "vitest";
// @ts-expect-error Standalone release tool has no runtime dependencies.
import { verifyMaterials } from "../scripts/verify-materials.mjs";
const roots: string[] = [];
function fixture(path = "license.txt") {
  const root = mkdtempSync(join(tmpdir(), "boopity-materials-"));
  roots.push(root);
  const text = "upstream notice";
  writeFileSync(join(root, "license.txt"), text);
  writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      files: [
        {
          path,
          bytes: Buffer.byteLength(text),
          sha256: createHash("sha256").update(text).digest("hex"),
        },
      ],
    }),
  );
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
describe("source-materials integrity", () => {
  it("verifies exact bytes and returns a manifest digest", () => {
    expect(verifyMaterials(fixture())).toEqual({
      files: 1,
      manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
  it.each(["../outside", "/outside", "a/../outside", "manifest.json"])(
    "rejects unsafe manifest path %s",
    (path) => {
      expect(() => verifyMaterials(fixture(path))).toThrow(
        "Unsafe manifest entry",
      );
    },
  );
  it("rejects changed, missing, extra and symlinked files", () => {
    const root = fixture();
    writeFileSync(join(root, "license.txt"), "changed content");
    expect(() => verifyMaterials(root)).toThrow();
    rmSync(join(root, "license.txt"));
    expect(() => verifyMaterials(root)).toThrow("Missing materials file");
    writeFileSync(join(root, "extra"), "unexpected");
    expect(() => verifyMaterials(root)).toThrow("Unlisted materials file");
    rmSync(join(root, "extra"));
    symlinkSync("manifest.json", join(root, "license.txt"));
    expect(() => verifyMaterials(root)).toThrow("Symlink in materials");
  });
});
