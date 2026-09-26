import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";

/** Bundle the same test contract against one specific source snapshot. */
export async function bundleUpgradeFixture(source, fixture) {
  const runtime = existsSync(join(resolve(source), "server/runtime/runtime.ts"))
    ? "server/runtime/runtime"
    : "platform/node/runtime";
  // Resolve from the snapshot root, which exists in both layouts. esbuild cannot
  // resolve relative imports from an absent directory such as preview's tests/support.
  const contents = fixture
    .replace('from "../../server/runtime/runtime"', `from "./${runtime}"`)
    .replace('from "../../src/shared/setup"', 'from "./src/shared/setup"');
  const result = await build({
    stdin: {
      contents,
      loader: "ts",
      resolveDir: resolve(source),
      sourcefile: "upgrade-container-fixture.ts",
    },
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    packages: "external",
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles[0].contents;
}
