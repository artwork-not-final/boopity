// Opt-in, offline commit-to-candidate rehearsal. No existing volume is accepted.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

assert.equal(process.env.BOOPITY_CONTAINER_QA, "upgrade-disposable");
const [oldTag, newTag, oldSource, newSource] = process.argv.slice(2);
assert.equal(
  process.argv.length,
  6,
  "Supply old image, new image, old source, new source",
);
for (const image of [oldTag, newTag])
  assert(/^[A-Za-z0-9][A-Za-z0-9:._/-]+$/.test(image));
const docker = (args, input) =>
  execFileSync("docker", args, {
    input,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
const inspect = (kind, id) =>
  JSON.parse(docker([kind, "inspect", id]).toString())[0];
const oldImage = inspect("image", oldTag),
  newImage = inspect("image", newTag);
assert.notEqual(
  oldImage.Id,
  newImage.Id,
  "A same-image restore is not an upgrade",
);
for (const image of [oldImage, newImage])
  assert.equal(image.Config.User, "node");
const fixture = readFileSync(
  new URL("../support/upgrade-container-fixture.ts", import.meta.url),
  "utf8",
);
async function bundle(source) {
  // Same test contract, actual runtime code from each supplied source snapshot.
  // The first source preview predates the server/ folder consolidation. Resolve
  // that one implementation import against its snapshot, not the candidate.
  const contents = existsSync(
    join(resolve(source), "server/runtime/runtime.ts"),
  )
    ? fixture
    : fixture.replace(
        'from "../../server/runtime/runtime"',
        'from "../../platform/node/runtime"',
      );
  const result = await build({
    stdin: {
      contents,
      loader: "ts",
      resolveDir: join(resolve(source), "tests", "support"),
      sourcefile: "upgrade-container-fixture.ts",
    },
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    packages: "external",
    write: false,
  });
  return result.outputFiles[0].contents;
}
const [oldFixture, newFixture] = await Promise.all([
  bundle(oldSource),
  bundle(newSource),
]);
const tag = randomUUID(),
  labelKey = "org.boopity.upgrade-qa",
  label = `${labelKey}=${tag}`;
const [original, upgraded, rollback] = ["original", "upgraded", "rollback"].map(
  (name) => `boopity-qa-${name}-${tag}`,
);
const directory = mkdtempSync(join(tmpdir(), "boopity-upgrade-qa-"));
const volumes = [];
function run(image, volume, command, input, readonly = false) {
  assert(volumes.includes(volume));
  return docker(
    [
      "run",
      "--rm",
      "--pull=never",
      "-i",
      "--network",
      "none",
      "--label",
      label,
      "--mount",
      `source=${volume},target=/data${readonly ? ",readonly" : ""}`,
      "-e",
      "BOOPITY_CONTAINER_QA=upgrade-disposable",
      image.Id,
      ...command,
    ],
    input,
  );
}
function check(image, volume, code, mode) {
  const result = JSON.parse(
    run(
      image,
      volume,
      ["node", "--input-type=module", "-", mode],
      code,
    ).toString(),
  );
  assert.equal(result.passed, true);
}
function status(image, volume) {
  const result = JSON.parse(
    run(image, volume, ["node", "dist/server/manage.mjs", "status"]).toString(),
  );
  assert.equal(result.ownerClaimed, true);
  assert.equal(result.setup.setup_state, "ready");
}
function restore(volume, archive) {
  run(
    oldImage,
    volume,
    ["tar", "-C", "/data", "-xf", "-"],
    readFileSync(archive),
  );
}
const hash = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
try {
  for (const name of [original, upgraded, rollback]) {
    assert.equal(
      docker([
        "volume",
        "ls",
        "--filter",
        `name=^${name}$`,
        "--format",
        "{{.Name}}",
      ])
        .toString()
        .trim(),
      "",
    );
    docker(["volume", "create", "--label", label, name]);
    volumes.push(name);
  }
  check(oldImage, original, oldFixture, "seed");
  status(oldImage, original); // Exercise the image's shipped management binary as well.
  check(oldImage, original, oldFixture, "verify");
  // All writers above have exited. Read-only archive of the complete stopped volume.
  const archive = join(directory, "before-upgrade.tar"),
    fd = openSync(archive, "wx", 0o600);
  try {
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--pull=never",
        "--network",
        "none",
        "--label",
        label,
        "--mount",
        `source=${original},target=/data,readonly`,
        oldImage.Id,
        "tar",
        "-C",
        "/data",
        "-cf",
        "-",
        ".",
      ],
      { stdio: ["ignore", fd, "pipe"] },
    );
  } finally {
    closeSync(fd);
  }
  assert.equal(statSync(archive).mode & 0o777, 0o600);
  const backupHash = hash(archive);
  restore(upgraded, archive);
  status(newImage, upgraded);
  check(newImage, upgraded, newFixture, "verify");
  status(newImage, upgraded); // Restart remains idempotent.
  check(newImage, upgraded, newFixture, "mutate");
  restore(rollback, archive); // Never start the old app against the upgraded DB.
  status(oldImage, rollback);
  check(oldImage, rollback, oldFixture, "verify");
  check(oldImage, original, oldFixture, "verify");
  assert.equal(hash(archive), backupHash);
  console.log(
    JSON.stringify(
      {
        passed: true,
        oldImage: oldImage.Id,
        newImage: newImage.Id,
        platform: `${newImage.Os}/${newImage.Architecture}`,
        checks: [
          "populated upgrade",
          "restart",
          "encrypted provider decryption",
          "stopped backup rollback",
          "original unchanged",
          "keys and uploads",
          "receipt/refund history",
          "SQLite integrity",
        ],
        scope:
          "Synthetic local image/source pair; no hosted or released-version compatibility claim",
      },
      null,
      2,
    ),
  );
} finally {
  for (const name of volumes) {
    assert.equal(inspect("volume", name).Labels[labelKey], tag);
    docker(["volume", "rm", name]);
  }
  rmSync(directory, { recursive: true, force: true });
}
