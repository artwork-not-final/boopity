// Explicit local Docker QA: only generated, labelled resources and synthetic data.
// No application server, email, provider calls, public ports or image publication.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

assert.equal(process.env.BOOPITY_CONTAINER_QA, "phase5-disposable");
const image = process.argv[2];
assert(
  image && /^[A-Za-z0-9][A-Za-z0-9:._/-]+$/.test(image),
  "Supply the locally built QA image",
);
const tag = randomUUID(),
  source = `boopity-qa-source-${tag}`,
  target = `boopity-qa-restore-${tag}`;
const container = `boopity-qa-snapshot-${tag}`,
  label = `org.boopity.recovery-qa=${tag}`;
const data = mkdtempSync(join(tmpdir(), "boopity-container-recovery-"));
const volumes = [];
let createdContainer = false;
const docker = (args, input) =>
  execFileSync("docker", args, {
    input,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
function inspect(kind, id) {
  return JSON.parse(docker([kind, "inspect", id]).toString())[0];
}
function run(volume, command, input) {
  return docker(
    [
      "run",
      "--rm",
      "-i",
      "--network",
      "none",
      "--mount",
      `source=${volume},target=/data`,
      image,
      ...command,
    ],
    input,
  );
}
try {
  // Resolve the exact local image; never pull a remote image as part of this check.
  const imageInfo = inspect("image", image);
  assert.equal(imageInfo.Config.User, "node");
  for (const name of [source, target]) {
    let exists = true;
    try {
      inspect("volume", name);
    } catch {
      exists = false;
    }
    assert(!exists, "QA volume name must be unused");
    docker(["volume", "create", "--label", label, name]);
    volumes.push(name);
  }
  docker([
    "create",
    "--name",
    container,
    "--label",
    label,
    "--network",
    "none",
    "--mount",
    `source=${source},target=/data`,
    imageInfo.Id,
    "node",
    "dist/server/manage.mjs",
    "status",
  ]);
  createdContainer = true;
  assert.equal(
    JSON.parse(docker(["start", "--attach", container]).toString())
      .ownerClaimed,
    false,
  );
  const fixture = readFileSync(
    "tests/support/self-hosted-container-fixture.mjs",
  );
  docker(
    [
      "run",
      "--rm",
      "-i",
      "--network",
      "none",
      "--mount",
      `source=${source},target=/data`,
      "-e",
      "BOOPITY_CONTAINER_QA=phase1-disposable",
      imageInfo.Id,
      "node",
      "--input-type=module",
      "-",
      "seed",
    ],
    fixture,
  );
  const keyHashCode = `const fs=require('node:fs'), crypto=require('node:crypto'); console.log(JSON.stringify(['auth-secret','settings-key'].map(name=>crypto.createHash('sha256').update(fs.readFileSync('/data/'+name)).digest('hex'))));`;
  const before = run(source, ["node", "-e", keyHashCode]).toString();
  assert.equal(inspect("container", container).State.Running, false);
  const archive = join(data, "data.tar"),
    fd = openSync(archive, "wx", 0o600);
  try {
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--volumes-from",
        `${container}:ro`,
        "--entrypoint",
        "tar",
        imageInfo.Id,
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
  docker(
    [
      "run",
      "--rm",
      "-i",
      "--network",
      "none",
      "--mount",
      `source=${target},target=/data`,
      "--entrypoint",
      "tar",
      imageInfo.Id,
      "-C",
      "/data",
      "-xf",
      "-",
    ],
    readFileSync(archive),
  );
  assert.equal(
    JSON.parse(
      run(target, ["node", "dist/server/manage.mjs", "status"]).toString(),
    ).ownerClaimed,
    false,
  );
  docker(
    [
      "run",
      "--rm",
      "-i",
      "--network",
      "none",
      "--mount",
      `source=${target},target=/data`,
      "-e",
      "BOOPITY_CONTAINER_QA=phase1-disposable",
      imageInfo.Id,
      "node",
      "--input-type=module",
      "-",
      "verify",
    ],
    fixture,
  );
  assert.equal(run(target, ["node", "-e", keyHashCode]).toString(), before);
  const checks = JSON.parse(
    run(target, [
      "node",
      "-e",
      `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/data/boopity.sqlite');console.log(JSON.stringify([db.prepare('PRAGMA quick_check').all(),db.prepare('PRAGMA foreign_key_check').all()]));db.close();`,
    ]).toString(),
  );
  assert.deepEqual(checks, [[{ quick_check: "ok" }], []]);
  console.log(
    `Docker recovery passed (${imageInfo.Os}/${imageInfo.Architecture}): fresh non-root installation, stopped read-only volume archive, isolated new-volume restore, branding/upload/key persistence and SQLite integrity. No provider calls or public ports.`,
  );
} finally {
  // Exact generated targets, additionally checked by a unique label. No prune commands.
  if (createdContainer) {
    const owned = inspect("container", container);
    assert.equal(owned.Config.Labels["org.boopity.recovery-qa"], tag);
    assert.equal(owned.State.Running, false);
    docker(["container", "rm", container]);
  }
  for (const name of volumes) {
    assert.equal(
      inspect("volume", name).Labels["org.boopity.recovery-qa"],
      tag,
    );
    docker(["volume", "rm", name]);
  }
  rmSync(data, { recursive: true, force: true });
}
