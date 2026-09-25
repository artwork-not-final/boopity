import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repository = fileURLToPath(new URL("../", import.meta.url));
const lintCli = join(
  dirname(fileURLToPath(import.meta.resolve("oxlint/package.json"))),
  "bin/oxlint",
);
const prettierCli = join(
  dirname(fileURLToPath(import.meta.resolve("prettier/package.json"))),
  "bin/prettier.cjs",
);
const fixtures: string[] = [];
afterEach(() => {
  for (const directory of fixtures.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "boopity-tooling-"));
  fixtures.push(directory);
  const write = (path: string, source: string) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), source);
  };
  for (const name of [".oxlintrc.json", ".prettierrc.json", ".prettierignore"])
    write(name, readFileSync(join(repository, name), "utf8"));
  return {
    write,
    lint: () =>
      spawnSync(
        process.execPath,
        [lintCli, "--max-warnings=0", "--format", "json"],
        { cwd: directory, encoding: "utf8" },
      ),
    format: () =>
      spawnSync(process.execPath, [prettierCli, "--check", "."], {
        cwd: directory,
        encoding: "utf8",
      }),
  };
}

describe("code-quality gates", () => {
  it.each([
    ["server/probe.ts", "debugger;\nexport const value = 1;\n", "no-debugger"],
    [
      "scripts/probe.mjs",
      "debugger;\nexport const value = 1;\n",
      "no-debugger",
    ],
    [
      "tests/probe.test.ts",
      "debugger;\nexport const value = 1;\n",
      "no-debugger",
    ],
    [
      "src/client/Probe.tsx",
      'import { useState } from "react"; export function Probe({ enabled }: { enabled: boolean }) { if (enabled) useState(0); return null; }',
      "rules-of-hooks",
    ],
    [
      "src/client/Probe.tsx",
      'import { useEffect } from "react"; export function Probe({ value }: { value: string }) { useEffect(() => { document.title = value; }, []); return null; }',
      "exhaustive-deps",
    ],
  ])("rejects %s with %s (%s)", (path, source, rule) => {
    const f = fixture();
    f.write(path, source);
    const result = f.lint();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(
      JSON.parse(result.stdout).diagnostics.some((issue: { code: string }) =>
        issue.code.includes(rule),
      ),
    ).toBe(true);
  });

  it("excludes private and generated directories without skipping maintained code", () => {
    const f = fixture();
    f.write("src/probe.ts", "export const value = 1;\n");
    for (const directory of [
      "node_modules",
      "dist",
      ".boopity",
      ".wrangler",
      ".release-candidates",
      "release-candidate",
      ".codex",
      ".agents",
      "backups",
      "test-results",
      "web",
      "Boopity",
    ])
      f.write(`${directory}/private.ts`, "not valid TypeScript = ;");
    const result = f.lint();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      diagnostics: [],
      number_of_files: 1,
    });
  });

  it("checks source formatting while leaving archives, lockfiles, and migrations alone", () => {
    const f = fixture();
    f.write("src/probe.ts", "export const value = 1;\n");
    for (const path of [
      ".boopity/private.json",
      ".release-candidates/review.md",
      "web/source.ts",
      "backups/source.ts",
      "dist/source.ts",
      "package-lock.json",
      "drizzle/meta/journal.json",
      "db/self-hosted/example.json",
      "licenses/vendor.md",
    ])
      f.write(path, "unformatted or invalid { content");
    expect(f.format().status).toBe(0);
    f.write("src/probe.ts", "export const value=1");
    const failed = f.format();
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("src/probe.ts");
  });
});
