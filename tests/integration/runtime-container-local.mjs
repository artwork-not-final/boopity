// Opt-in, offline tests against a freshly created volume and an existing local image.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";

assert.equal(process.env.BOOPITY_CONTAINER_QA, "runtime-disposable");
assert.equal(
  process.argv.length,
  4,
  "Supply local image and matching source directory",
);
const [tag, source] = process.argv.slice(2);
assert(/^[A-Za-z0-9][A-Za-z0-9:._/-]+$/.test(tag));
const docker = (args, input) =>
  execFileSync("docker", args, {
    input,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
  });
const inspect = (kind, name) => JSON.parse(docker([kind, "inspect", name]))[0];
const image = inspect("image", tag);
assert.equal(image.Config.User, "node");
assert(["arm64", "amd64"].includes(image.Architecture));
const expectedNode = readFileSync(
  join(resolve(source), ".nvmrc"),
  "utf8",
).trim();
assert(/^24\.\d+\.\d+$/.test(expectedNode));
const fixture = await build({
  stdin: {
    contents: readFileSync(
      new URL("../support/runtime-container-fixture.ts", import.meta.url),
      "utf8",
    ),
    sourcefile: "runtime-container-fixture.ts",
    loader: "ts",
    resolveDir: join(resolve(source), "tests"),
  },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  write: false,
});
const uuid = randomUUID(),
  volume = `boopity-runtime-qa-${uuid}`,
  labelKey = "org.boopity.runtime-qa",
  label = `${labelKey}=${uuid}`;
let created = false;
try {
  docker(["volume", "create", "--label", label, volume]);
  created = true;
  const output = docker(
    [
      "run",
      "--rm",
      "--pull=never",
      "--interactive",
      "--platform",
      `linux/${image.Architecture}`,
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=64m",
      "--label",
      label,
      "--mount",
      `source=${volume},target=/data`,
      "--env",
      "BOOPITY_CONTAINER_QA=runtime-disposable",
      "--env",
      `BOOPITY_EXPECTED_NODE=${expectedNode}`,
      image.Id,
      "node",
      "--input-type=module",
      "-",
    ],
    fixture.outputFiles[0].contents,
  );
  console.log(output.toString().trim());
  // Exercise the shipped management binary with the newly claimed synthetic owner.
  const status = JSON.parse(
    docker([
      "run",
      "--rm",
      "--pull=never",
      "--platform",
      `linux/${image.Architecture}`,
      "--network",
      "none",
      "--label",
      label,
      "--mount",
      `source=${volume},target=/data`,
      image.Id,
      "node",
      "dist/server/manage.mjs",
      "status",
    ]),
  );
  assert.equal(status.ownerClaimed, true);
  console.log(`${image.Architecture}: compiled management command passed.`);
} catch (error) {
  // Node's exec errors include stdin; never print the bundled fixture or credentials.
  if (error.stderr) console.error(String(error.stderr).slice(-4000));
  throw new Error("Disposable runtime check failed; see assertion above.");
} finally {
  if (created) {
    assert.equal(inspect("volume", volume).Labels[labelKey], uuid);
    docker(["volume", "rm", volume]);
  }
}
