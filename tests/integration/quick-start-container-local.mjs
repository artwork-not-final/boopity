// Opt-in Quick Start ZIP rehearsal. Never opens a browser or sends provider mail.
// Only names/port/image in an extracted COPY are isolated for this run.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { packageQuickStart } from "../../scripts/release-quick-start.mjs";

assert.equal(process.env.BOOPITY_CONTAINER_QA, "quick-start-disposable");
assert.equal(
  process.argv.length,
  4,
  "Supply a local image and the installer source directory",
);
const [tag, sourceArgument] = process.argv.slice(2);
assert(/^[A-Za-z0-9][A-Za-z0-9:@._/-]+$/.test(tag));
const source = resolve(sourceArgument);
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  BOOPITY_OPEN_BROWSER: "false",
};
const options = {
  env,
  encoding: "utf8",
  stdio: ["pipe", "pipe", "pipe"],
  timeout: 60000,
  maxBuffer: 1024 * 1024,
};
const docker = (args, input) =>
  execFileSync("docker", args, { ...options, input });
const image = JSON.parse(docker(["image", "inspect", tag]))[0];
assert.equal(image.Config.User, "node");
const project = `boopity-quick-start-test-${randomUUID()}`;
const volume = `${project}_boopity-data`;
assert.equal(
  docker([
    "volume",
    "ls",
    "--filter",
    `name=^${volume}$`,
    "--format",
    "{{.Name}}",
  ]).trim(),
  "",
);
const temporary = mkdtempSync(join(tmpdir(), "boopity-quick-start-qa-"));
const placeholderImage = `ghcr.io/artwork-not-final/boopity@sha256:${"0".repeat(64)}`;
const release = packageQuickStart(
  source,
  temporary,
  "0.0.0-test",
  placeholderImage,
);
const extracted = join(temporary, "Extracted download with spaces");
mkdirSync(extracted);
execFileSync("unzip", ["-q", release.archive, "-d", extracted], options);
let root = join(extracted, "Boopity Quick Start");
const compose = (args) =>
  docker([
    "compose",
    "--env-file",
    "/dev/null",
    "--project-name",
    project,
    "--project-directory",
    root,
    "-f",
    join(root, "compose.image.yaml"),
    ...args,
  ]);
const config = JSON.parse(compose(["config", "--format", "json"]));
assert.equal(config.services.boopity.image, placeholderImage);
assert.equal(config.services.boopity.ports[0].host_ip, "127.0.0.1");
assert.equal(String(config.services.boopity.ports[0].published), "3000");
assert.equal(
  config.services.boopity.environment.APP_URL,
  "http://localhost:3000",
);
assert.equal(config.services.boopity.environment.BOOPITY_SETUP_LINK, "manual");
assert.equal(config.services.boopity.read_only, true);
assert.deepEqual(config.services.boopity.cap_drop, ["ALL"]);
assert.deepEqual(config.services.boopity.security_opt, [
  "no-new-privileges:true",
]);
assert.equal(config.services.boopity.labels["org.boopity.quick-start"], "1");
assert.equal(
  config.volumes["boopity-data"].labels["org.boopity.quick-start"],
  "1",
);

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
// These explicit test-only substitutions keep the real port 3000/installation alone.
const composePath = join(root, "compose.image.yaml");
const isolatedCompose = readFileSync(composePath, "utf8")
  .replaceAll("boopity-quick-start", project)
  .replaceAll("localhost:3000", `localhost:${port}`)
  .replace("127.0.0.1:3000:3000", `127.0.0.1:${port}:3000`)
  .replace(placeholderImage, image.Id);
writeFileSync(composePath, isolatedCompose);
const checks = join(root, "scripts/install/quick-start-checks.sh");
writeFileSync(
  checks,
  readFileSync(checks, "utf8")
    .replace("quick_project=boopity-quick-start", `quick_project=${project}`)
    .replace("quick_port=3000", `quick_port=${port}`),
);
const launcher = () =>
  spawnSync("sh", [join(root, "Start Boopity.command")], {
    ...options,
    timeout: 240000,
    cwd: temporary,
  });
const requireSuccess = (result) => {
  // Do not let assertion output disclose the captured private setup link.
  if (result.status !== 0)
    throw new Error(
      `Launcher failed: ${result.stderr.replace(/https?:\/\/\S+/g, "[address omitted]")}`,
    );
};
const currentContainer = () =>
  compose(["ps", "--all", "--quiet", "boopity"]).trim();
const execute = (script) =>
  docker(
    ["exec", "-i", currentContainer(), "node", "--input-type=module", "-"],
    script,
  );
const snapshot = () =>
  JSON.parse(
    execute(`
  import { createHash } from 'node:crypto';
  import { readFileSync } from 'node:fs';
  import { DatabaseSync } from 'node:sqlite';
  const db = new DatabaseSync('/data/boopity.sqlite');
  const hashes = ['auth-secret', 'settings-key'].map(name => createHash('sha256').update(readFileSync('/data/' + name)).digest('hex'));
  console.log(JSON.stringify({ hashes, business: db.prepare('SELECT business_name FROM installation').get(), tokens: db.prepare('SELECT COUNT(*) AS count FROM operator_tokens').get() }));
  db.close();
`),
  );
let container, previousInstallation;
try {
  previousInstallation = docker([
    "create",
    "--label",
    "com.docker.compose.service=boopity",
    "--label",
    `org.boopity.quick-start-qa=${project}`,
    "--publish",
    `127.0.0.1:${port}:3000`,
    "--entrypoint",
    "node",
    image.Id,
    "--version",
  ]).trim();
  const blocked = launcher();
  assert.equal(blocked.status, 1);
  assert(blocked.stderr.includes("even if it is stopped"));
  assert.equal(currentContainer(), "");
  docker(["rm", previousInstallation]);
  previousInstallation = undefined;
  const first = launcher();
  requireSuccess(first);
  assert.match(
    first.stdout,
    new RegExp(`http://localhost:${port}/setup#setup=[A-Za-z0-9_-]{43}`),
  );
  container = currentContainer();
  assert(/^[a-f0-9]{64}$/.test(container));
  assert.equal(JSON.parse(docker(["inspect", container]))[0].Image, image.Id);
  assert(
    !docker(["logs", container]).includes("#setup="),
    "No setup credential in automatic startup logs",
  );
  const before = snapshot();
  execute(`
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync('/data/boopity.sqlite');
    db.exec("UPDATE installation SET business_name='Quick Start Test', setup_state='ready'; INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES('quick-start-test','Synthetic Owner','owner@example.test',1,0,0); INSERT INTO business_memberships(user_id,role) VALUES('quick-start-test','owner');");
    db.close();
  `);
  const populated = snapshot();
  assert.deepEqual(populated.hashes, before.hashes);
  assert.equal(populated.business.business_name, "Quick Start Test");
  const moved = join(temporary, "Moved Boopity folder");
  renameSync(root, moved);
  root = moved;
  compose(["stop", "boopity"]);
  const resumed = launcher();
  requireSuccess(resumed);
  assert(resumed.stdout.includes(`http://localhost:${port}/app`));
  assert(!resumed.stdout.includes("#setup="));
  assert.equal(currentContainer(), container);
  assert.deepEqual(snapshot(), populated);
  // A newly downloaded bundle may select another image. Opening must not upgrade.
  writeFileSync(
    join(root, "compose.image.yaml"),
    isolatedCompose.replace(image.Id, placeholderImage),
  );
  const reopened = launcher();
  requireSuccess(reopened);
  assert.equal(currentContainer(), container);
  assert.equal(JSON.parse(docker(["inspect", container]))[0].Image, image.Id);
  assert.deepEqual(snapshot(), populated);
  docker(["rm", "--force", container]);
  container = undefined;
  const orphaned = launcher();
  assert.equal(orphaned.status, 1);
  assert(orphaned.stderr.includes("container is missing"));
  assert.equal(currentContainer(), "");
  assert.equal(
    JSON.parse(docker(["volume", "inspect", volume]))[0].Labels[
      "org.boopity.quick-start"
    ],
    "1",
  );
  console.log(
    "Quick Start ZIP: Compose protections, stopped-installation conflict, private handoff, folder move, restart, retained owner/details/keys, no implicit update, and orphan-volume refusal passed. Only isolated names/port/image were substituted; no real data or providers were used.",
  );
} finally {
  // Exact generated project, with ownership checks before any cleanup.
  if (previousInstallation) {
    assert.equal(
      JSON.parse(docker(["inspect", previousInstallation]))[0].Config.Labels[
        "org.boopity.quick-start-qa"
      ],
      project,
    );
    docker(["rm", previousInstallation]);
  }
  const remaining = currentContainer();
  if (remaining) {
    const item = JSON.parse(docker(["inspect", remaining]))[0];
    assert.equal(item.Config.Labels["com.docker.compose.project"], project);
    assert.equal(item.Config.Labels["org.boopity.quick-start"], "1");
  }
  const volumeExists = docker([
    "volume",
    "ls",
    "--filter",
    `name=^${volume}$`,
    "--format",
    "{{.Name}}",
  ]).trim();
  if (volumeExists)
    assert.equal(
      JSON.parse(docker(["volume", "inspect", volume]))[0].Labels[
        "org.boopity.quick-start"
      ],
      "1",
    );
  compose(["down", "--volumes", "--timeout", "10"]);
  rmSync(temporary, { recursive: true, force: true });
}
