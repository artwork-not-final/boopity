import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Standalone release tooling has no runtime dependencies.
import * as releaseSource from "../scripts/release-source.mjs";
const { exportSource, planSource, readSource, safeSourcePath } = releaseSource;

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "boopity-source-test-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("source-only release snapshots", () => {
  it("exports current edits and new files, omits deletions and ignored data, without Git history", () => {
    const root = fixture(),
      parent = fixture();
    writeFileSync(join(root, ".gitignore"), ".boopity/\n");
    writeFileSync(join(root, "current.ts"), "old");
    writeFileSync(join(root, "deleted.ts"), "old");
    execFileSync("git", ["-C", root, "add", "."]);
    writeFileSync(join(root, "current.ts"), "current");
    writeFileSync(join(root, "new.ts"), "new");
    rmSync(join(root, "deleted.ts"));
    mkdirSync(join(root, ".boopity"));
    writeFileSync(
      join(root, ".boopity", "auth-secret"),
      "must not read or export",
    );
    const result = exportSource(root, parent);
    expect(result.files).toBe(3);
    expect(readFileSync(join(result.source, "current.ts"), "utf8")).toBe(
      "current",
    );
    expect(readFileSync(join(result.source, "new.ts"), "utf8")).toBe("new");
    for (const name of [".git", ".boopity", "deleted.ts"])
      expect(existsSync(join(result.source, name))).toBe(false);
    const manifest = readFileSync(join(result.destination, "manifest.json"));
    expect(createHash("sha256").update(manifest).digest("hex")).toBe(
      result.manifestSha256,
    );
    expect(JSON.parse(manifest.toString()).historyIncluded).toBe(false);
    const file = JSON.parse(manifest.toString()).files.find(
      (file: { path: string }) => file.path === "current.ts",
    );
    expect(file.sha256).toBe(
      createHash("sha256").update("current").digest("hex"),
    );
  });
  it.each([
    "../secret",
    "/absolute",
    ".git/config",
    ".env.local",
    ".boopity/auth-secret",
    "web/old.ts",
    "backups/a",
    "dist/a.js",
    ".codex/state",
    "data.sqlite",
    "source.tar.gz",
  ])("rejects %s", (path) => {
    expect(() => safeSourcePath(path)).toThrow();
  });
  it("rejects symlinked files and parents, binaries, invalid UTF-8, and detectable secrets", () => {
    const root = fixture(),
      outside = fixture();
    writeFileSync(join(outside, "value.ts"), "private");
    symlinkSync(join(outside, "value.ts"), join(root, "file.ts"));
    symlinkSync(outside, join(root, "parent"));
    expect(() => readSource(root, "file.ts")).toThrow("Non-regular");
    expect(() => readSource(root, "parent/value.ts")).toThrow("Non-regular");
    unlinkSync(join(root, "file.ts"));
    unlinkSync(join(root, "parent"));
    for (const value of [
      Buffer.from([0, 1]),
      Buffer.from([255]),
      Buffer.from("rk_" + "live_" + "A".repeat(32)),
    ]) {
      writeFileSync(join(root, "value.ts"), value);
      expect(() => planSource(root)).toThrow();
    }
  });
  it("does not silently export a tracked private file even when ignored", () => {
    const root = fixture();
    writeFileSync(join(root, ".env"), "private");
    execFileSync("git", ["-C", root, "add", ".env"]);
    writeFileSync(join(root, ".gitignore"), ".env\n");
    expect(() => planSource(root)).toThrow("Rejected source path");
  });
  it("exports only the requested commit, not later edits or historical Git objects", () => {
    const root = fixture(),
      parent = fixture();
    writeFileSync(join(root, "source.ts"), "committed source");
    execFileSync("git", ["-C", root, "add", "."]);
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=Synthetic",
      "-c",
      "user.email=qa@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "Synthetic baseline",
    ]);
    const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"])
      .toString()
      .trim();
    writeFileSync(join(root, "source.ts"), "uncommitted edit");
    writeFileSync(join(root, "new.ts"), "not part of baseline");
    const result = exportSource(root, parent, commit);
    expect(result.files).toBe(1);
    expect(readFileSync(join(result.source, "source.ts"), "utf8")).toBe(
      "committed source",
    );
    expect(existsSync(join(result.source, ".git"))).toBe(false);
    expect(() => planSource(root, "HEAD")).toThrow("full commit ID");
  });
});
