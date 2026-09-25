import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const compiler = resolve(
  dirname(fileURLToPath(import.meta.resolve("typescript/package.json"))),
  "bin/tsc",
);
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

function resolvedConfig(path: string) {
  return JSON.parse(
    execFileSync(process.execPath, [compiler, "--showConfig", "-p", path], {
      cwd: root,
      encoding: "utf8",
    }),
  );
}

describe("test type-checking gate", () => {
  it("includes every TypeScript test and harness, excluding private archives", () => {
    const config = resolvedConfig("tsconfig.tests.json");
    const files = config.files.map((path: string) => resolve(root, path));
    const testFiles = readdirSync(resolve(root, "tests"), {
      recursive: true,
      encoding: "utf8",
    })
      .filter((path) => /\.tsx?$/.test(path))
      .map((path) => resolve(root, "tests", path));

    expect(files.sort()).toEqual(testFiles.sort());
    expect(files).toContain(
      resolve(root, "tests/integration/setup-browser-local.ts"),
    );
    expect(files).toContain(
      resolve(root, "tests/integration/portal-browser-local.ts"),
    );
    expect(files).toContain(
      resolve(root, "tests/integration/payment-browser-local.ts"),
    );
    expect(config.compilerOptions).toMatchObject({
      strict: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noEmit: true,
    });
  });

  it("keeps test sources out of production build projects", () => {
    const projects = JSON.parse(read("tsconfig.json")).references;
    for (const project of projects) {
      const config = resolvedConfig(project.path);
      for (const path of config.files) {
        expect(resolve(root, path)).not.toMatch(/\/tests\//);
      }
    }
    expect(read(".dockerignore").split(/\r?\n/)).toContain("tests");
  });

  it("checks types before verification tests and uses the supported Node major", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.typecheck).toBe("tsc -b && tsc -p tsconfig.tests.json");
    expect(pkg.scripts["verify"]).toMatch(
      /^npm run typecheck && npm run lint && npm run format:check && npm test &&/,
    );
    expect(read(".github/workflows/verify.yml")).toContain("npm run verify");
    expect(pkg.devDependencies["@types/node"]).toMatch(/^\^24\./);
    const lock = JSON.parse(read("package-lock.json"));
    expect(lock.packages["node_modules/@types/node"].version).toMatch(/^24\./);
  });
});
