import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
// @ts-expect-error The standalone Node harness imports this JavaScript helper directly.
import { bundleUpgradeFixture } from "../support/upgrade-fixture-bundle.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

it.each(["preview", "current"])(
  "bundles the %s source without assuming the other version's test layout",
  async (layout) => {
    const root = mkdtempSync(join(tmpdir(), "boopity-upgrade-source-"));
    roots.push(root);
    const runtime = layout === "preview" ? "platform/node" : "server/runtime";
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    mkdirSync(join(root, layout === "preview" ? "tests" : "tests/support"), {
      recursive: true,
    });
    write(
      `${runtime}/runtime.ts`,
      `export const runtime = ${JSON.stringify(layout)};`,
    );
    write(
      "src/shared/setup.ts",
      'export const emptyProviders = "fixture providers";',
    );
    const code = await bundleUpgradeFixture(
      root,
      `
      import { runtime } from "../../server/runtime/runtime";
      import { emptyProviders } from "../../src/shared/setup";
      console.log(JSON.stringify({ runtime, emptyProviders }));
    `,
    );
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "-"],
      {
        input: code,
        encoding: "utf8",
      },
    );
    expect(JSON.parse(output)).toEqual({
      runtime: layout,
      emptyProviders: "fixture providers",
    });
    if (layout === "preview")
      expect(existsSync(join(root, "tests/support"))).toBe(false);
  },
);
