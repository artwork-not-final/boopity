// Opt-in, offline checks using the shipped prebuilt Compose definition.
// Only generated, labelled containers/volumes; never accepts installation data.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import { bundleUpgradeFixture } from "../support/upgrade-fixture-bundle.mjs";

assert.equal(process.env.BOOPITY_CONTAINER_QA, "compose-disposable");
assert.equal(process.argv.length, 4, "Supply local image and matching source");
const [tag, sourceArgument] = process.argv.slice(2);
assert(/^[A-Za-z0-9][A-Za-z0-9:._/-]+$/.test(tag));
const source = resolve(sourceArgument);
// Never inherit application credentials, Compose overrides or a user's .env.
const environment = { PATH: process.env.PATH, HOME: process.env.HOME };
const options = {
  env: environment,
  stdio: ["pipe", "pipe", "pipe"],
  maxBuffer: 8 * 1024 * 1024,
  timeout: 60000,
};
const docker = (args, input) =>
  execFileSync("docker", args, { ...options, input });
const inspect = (kind, name) => JSON.parse(docker([kind, "inspect", name]))[0];
const image = inspect("image", tag);
assert.equal(image.Config.User, "node");
assert(["arm64", "amd64"].includes(image.Architecture));
const nodeVersion = readFileSync(join(source, ".nvmrc"), "utf8").trim();
assert(/^24\.\d+\.\d+$/.test(nodeVersion));
const runtimeFixture = await build({
  stdin: {
    contents: readFileSync(
      join(source, "tests/support/runtime-container-fixture.ts"),
      "utf8",
    ),
    sourcefile: "runtime-container-fixture.ts",
    loader: "ts",
    resolveDir: join(source, "tests/support"),
  },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  write: false,
});
const recoveryFixture = await bundleUpgradeFixture(
  source,
  readFileSync(
    join(source, "tests/support/upgrade-container-fixture.ts"),
    "utf8",
  ),
);
const id = randomUUID();
const labelKey = "org.boopity.compose-qa";
const label = `${labelKey}=${id}`;
const project = `boopity-compose-qa-${id}`;
const directory = mkdtempSync(join(tmpdir(), `${project}-`));
const volumes = [];
const containers = [];
const override = join(directory, "offline.json");
const readonly = join(directory, "backup.json");
// Do not override any of the hardening controls: those must come from Compose.
writeFileSync(
  override,
  JSON.stringify({
    services: {
      boopity: {
        platform: `linux/${image.Architecture}`,
        network_mode: "none",
        labels: { [labelKey]: id },
        mem_limit: "512m",
        pids_limit: 128,
      },
    },
    volumes: {
      "boopity-data": { external: true, name: "${BOOPITY_QA_VOLUME:?}" },
    },
  }),
  { flag: "wx", mode: 0o600 },
);
writeFileSync(
  readonly,
  JSON.stringify({
    services: {
      boopity: {
        volumes: [
          {
            type: "volume",
            source: "boopity-data",
            target: "/data",
            read_only: true,
          },
        ],
      },
    },
  }),
  { flag: "wx", mode: 0o600 },
);
function compose(volume, args, input, backup = false, extra = {}) {
  assert(volumes.includes(volume), "Only this run's volumes are allowed");
  const command = [
    "compose",
    "--env-file",
    "/dev/null",
    "--project-name",
    project,
    "-f",
    join(source, "compose.image.yaml"),
    "-f",
    override,
    ...(backup ? ["-f", readonly] : []),
    ...args,
  ];
  return execFileSync("docker", command, {
    ...options,
    ...extra,
    input,
    env: {
      ...environment,
      COMPOSE_DISABLE_ENV_FILE: "true",
      BOOPITY_IMAGE: image.Id,
      BOOPITY_QA_VOLUME: volume,
      APP_URL: "http://localhost:3000",
      BOOPITY_SETUP_PASSWORD: "",
    },
  });
}
const run = (volume, command, input, backup = false, extra = {}) =>
  compose(
    volume,
    [
      "run",
      "--rm",
      "--no-deps",
      "--pull",
      "never",
      "-T",
      "boopity",
      ...command,
    ],
    input,
    backup,
    extra,
  );
function contract(volume, backup = false) {
  const config = JSON.parse(
    compose(volume, ["config", "--format", "json"], undefined, backup),
  );
  const service = config.services.boopity;
  assert.equal(service.read_only, true);
  assert.deepEqual(service.cap_drop, ["ALL"]);
  assert.deepEqual(service.security_opt, ["no-new-privileges:true"]);
  assert.deepEqual(service.tmpfs, ["/tmp:rw,noexec,nosuid,size=64m"]);
  assert.equal(service.network_mode, "none");
  assert(!service.privileged && !service.cap_add && !service.user);
  assert.equal(service.volumes.length, 1);
  assert.equal(service.volumes[0].target, "/data");
  assert.equal(Boolean(service.volumes[0].read_only), backup);
}
const runtimeCheck = `
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
assert.equal(process.getuid(), 1000);
const status = readFileSync('/proc/self/status', 'utf8');
assert(/^NoNewPrivs:\\s+1$/m.test(status));
assert(/^CapEff:\\s+0+$/m.test(status));
assert(/^CapBnd:\\s+0+$/m.test(status));
const mounts = readFileSync('/proc/self/mountinfo', 'utf8').split('\\n').map(line => line.split(' '));
assert(mounts.find(row => row[4] === '/')[5].split(',').includes('ro'));
const tmp = mounts.find(row => row[4] === '/tmp');
for (const flag of ['rw', 'noexec', 'nosuid']) assert(tmp[5].split(',').includes(flag));
writeFileSync('/tmp/compose-qa', 'temporary test', { flag: 'wx' });
unlinkSync('/tmp/compose-qa');
console.log('Runtime restrictions and writable temporary storage passed.');
`;
function verify(volume) {
  const result = JSON.parse(
    run(
      volume,
      [
        "env",
        "BOOPITY_CONTAINER_QA=upgrade-disposable",
        "node",
        "--input-type=module",
        "-",
        "verify",
      ],
      recoveryFixture,
    ),
  );
  assert.equal(result.passed, true);
  const status = JSON.parse(
    run(volume, ["node", "dist/server/manage.mjs", "status"]),
  );
  assert.equal(status.ownerClaimed, true);
  assert.equal(status.setup.setup_state, "ready");
}
async function startAndStop(volume) {
  const name = `${project}-${containers.length}`;
  // `compose run` does NOT publish service ports without --service-ports.
  compose(volume, [
    "run",
    "--detach",
    "--no-deps",
    "--pull",
    "never",
    "--name",
    name,
    "boopity",
  ]);
  containers.push(name);
  const current = inspect("container", name);
  assert.equal(current.Config.Labels[labelKey], id);
  assert.equal(current.HostConfig.NetworkMode, "none");
  assert.equal(current.HostConfig.ReadonlyRootfs, true);
  assert.equal(Object.keys(current.HostConfig.PortBindings ?? {}).length, 0);
  assert.equal(
    current.Mounts.find((m) => m.Destination === "/data").Name,
    volume,
  );
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      docker(["exec", name, "node", "dist/server/healthcheck.mjs"]);
      ready = true;
      break;
    } catch {
      if (!inspect("container", name).State.Running) break;
      await delay(250);
    }
  }
  assert(ready, "Shipped server/healthcheck must start with Compose hardening");
  docker(
    ["exec", "-i", name, "node", "--input-type=module", "-"],
    runtimeCheck,
  );
  docker(["stop", "--time", "10", name]);
  assert.equal(inspect("container", name).State.Running, false);
}
try {
  for (const kind of ["setup", "populated", "restored"]) {
    const volume = `${project}-${kind}`;
    assert.equal(
      docker([
        "volume",
        "ls",
        "--filter",
        `name=^${volume}$`,
        "--format",
        "{{.Name}}",
      ])
        .toString()
        .trim(),
      "",
    );
    docker(["volume", "create", "--label", label, volume]);
    volumes.push(volume);
  }
  const [setup, populated, restored] = volumes;
  contract(setup);
  run(setup, ["node", "--input-type=module", "-"], runtimeCheck);
  console.log(
    run(
      setup,
      [
        "env",
        "BOOPITY_CONTAINER_QA=runtime-disposable",
        `BOOPITY_EXPECTED_NODE=${nodeVersion}`,
        "node",
        "--input-type=module",
        "-",
      ],
      runtimeFixture.outputFiles[0].contents,
    )
      .toString()
      .trim(),
  );
  assert.equal(
    JSON.parse(run(setup, ["node", "dist/server/manage.mjs", "status"]))
      .ownerClaimed,
    true,
  );
  run(
    populated,
    [
      "env",
      "BOOPITY_CONTAINER_QA=upgrade-disposable",
      "node",
      "--input-type=module",
      "-",
      "seed",
    ],
    recoveryFixture,
  );
  verify(populated);
  await startAndStop(populated);
  verify(populated);
  await startAndStop(populated);
  verify(populated);
  // Every writer is stopped. Archive the source volume read-only as UID 1000.
  contract(populated, true);
  const archive = join(directory, "synthetic-backup.tar");
  const fd = openSync(archive, "wx", 0o600);
  try {
    run(populated, ["tar", "-C", "/data", "-cf", "-", "."], undefined, true, {
      stdio: ["ignore", fd, "pipe"],
    });
  } finally {
    closeSync(fd);
  }
  assert.equal(statSync(archive).mode & 0o777, 0o600);
  run(restored, ["tar", "-C", "/data", "-xf", "-"], readFileSync(archive));
  verify(restored);
  await startAndStop(restored);
  verify(restored);
  verify(populated);
  console.log(
    JSON.stringify({
      passed: true,
      image: image.Id,
      architecture: image.Architecture,
      checks: [
        "actual Compose controls",
        "offline setup/authentication",
        "compiled server and management",
        "container replacement",
        "keys/encrypted settings/records/uploads persist",
        "stopped read-only backup",
        "new-volume restore",
        "SQLite integrity",
      ],
      scope:
        "Disposable offline data; no providers, host ports, publishing or deployment",
    }),
  );
} catch (error) {
  if (error.stderr) console.error(String(error.stderr).slice(-4000));
  throw new Error("Disposable Compose validation failed", {
    cause: new Error(error.message.split("\n")[0]),
  });
} finally {
  for (const name of containers) {
    const current = inspect("container", name);
    assert.equal(current.Config.Labels[labelKey], id);
    if (current.State.Running) docker(["stop", "--time", "10", name]);
    docker(["container", "rm", name]);
  }
  for (const volume of volumes) {
    assert.equal(inspect("volume", volume).Labels[labelKey], id);
    docker(["volume", "rm", volume]);
  }
  rmSync(directory, { recursive: true, force: true });
}
