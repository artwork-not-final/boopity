import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  packageQuickStart,
  quickStartFiles,
} from "../../scripts/release-quick-start.mjs";

const source = fileURLToPath(new URL("../../", import.meta.url));
const version = "0.1.0-preview.4";
const image = `ghcr.io/artwork-not-final/boopity@sha256:${"1".repeat(64)}`;
const entry = `http://localhost:3000/setup#setup=${"a".repeat(43)}`;
const project = "boopity-quick-start";
const volume = `${project}_boopity-data`;
const directories: string[] = [];
function temporary() {
  const path = realpathSync(
    mkdtempSync(join(tmpdir(), "boopity quick-start-test-")),
  );
  directories.push(path);
  return path;
}
function fixture() {
  const path = temporary();
  for (const file of quickStartFiles(source, version, image)) {
    const destination = join(path, file.path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, file.content);
  }
  return path;
}
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("Quick Start packaging", () => {
  it("ships only pinned configuration, launcher code, instructions and license", () => {
    const files = quickStartFiles(source, version, image);
    expect(files.map((file) => file.path).sort()).toEqual([
      "BUNDLE.json",
      "LICENSE",
      "Read Me.txt",
      "Start Boopity.command",
      "compose.image.yaml",
      "scripts/install/quick-start-checks.sh",
      "scripts/install/setup-entry.mjs",
      "scripts/start-docker.sh",
    ]);
    const compose = files.find(
      (file) => file.path === "compose.image.yaml",
    )!.content;
    expect(compose).toContain(`image: ${image}`);
    expect(compose).toContain(`name: ${project}`);
    expect(compose).toContain('"127.0.0.1:3000:3000"');
    expect(compose).toContain("APP_URL: http://localhost:3000");
    expect(compose).toContain("BOOPITY_SETUP_LINK: manual");
    expect(compose).toContain("read_only: true");
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).not.toMatch(/\$\{|build:|BOOPITY_SETUP_PASSWORD|latest/);
    expect(compose.match(/org\.boopity\.quick-start: "1"/g)).toHaveLength(2);
    const manifest = JSON.parse(
      files.find((file) => file.path === "BUNDLE.json")!.content,
    );
    expect(manifest.image).toBe(image);
    for (const item of manifest.files) {
      const file = files.find((candidate) => candidate.path === item.path)!;
      expect(item.sha256).toBe(
        createHash("sha256").update(file.content).digest("hex"),
      );
    }
    expect(
      files.find((file) => file.path === "Read Me.txt")!.content,
    ).toContain(`releases/tag/v${version}`);
  });
  it.each(["latest", "../escape", "v0.1.0", "0.1.0;echo bad", ""])(
    "rejects unsafe or ambiguous version %s",
    (value) => {
      expect(() => quickStartFiles(source, value, image)).toThrow(/version/);
    },
  );
  it.each([
    "boopity:latest",
    "ghcr.io/artwork-not-final/boopity:0.1.0",
    "https://elsewhere/image",
    "",
  ])("rejects unpinned images %s", (value) => {
    expect(() => quickStartFiles(source, version, value)).toThrow(/digest/);
  });
  it("rejects a symlinked packaging source", () => {
    const root = temporary();
    symlinkSync(
      join(source, "compose.image.yaml"),
      join(root, "compose.image.yaml"),
    );
    expect(() => quickStartFiles(root, version, image)).toThrow(/Non-regular/);
  });
  it.skipIf(process.platform === "win32")(
    "round-trips the ZIP, file hashes and executable bit with no private files",
    () => {
      const parent = temporary();
      const result = packageQuickStart(source, parent, version, image);
      const extracted = join(parent, "extracted with spaces");
      mkdirSync(extracted);
      expect(
        spawnSync("unzip", ["-q", result.archive, "-d", extracted]).status,
      ).toBe(0);
      const root = join(extracted, "Boopity Quick Start");
      for (const file of quickStartFiles(source, version, image))
        expect(readFileSync(join(root, file.path), "utf8")).toBe(file.content);
      expect(statSync(join(root, "Start Boopity.command")).mode & 0o111).toBe(
        0o111,
      );
      expect(readFileSync(result.archive + ".sha256", "utf8")).toContain(
        result.sha256,
      );
      expect(
        createHash("sha256").update(readFileSync(result.archive)).digest("hex"),
      ).toBe(result.sha256);
      const entries = spawnSync("unzip", ["-Z1", result.archive], {
        encoding: "utf8",
      })
        .stdout.trim()
        .split("\n");
      expect(entries).toHaveLength(8);
      expect(entries.join("\n")).not.toMatch(
        /node_modules|\.env|\.sqlite|__MACOSX|\.DS_Store/,
      );
    },
  );
});

describe.skipIf(process.platform === "win32")(
  "Quick Start host safeguards",
  () => {
    function run(overrides: Record<string, string> = {}) {
      const directory = fixture();
      mkdirSync(join(directory, "bin"));
      writeFileSync(join(directory, "package.json"), '{"type":"module"}');
      writeFileSync(
        join(directory, "bin/docker"),
        `#!${process.execPath}
      import { appendFileSync, readFileSync } from 'node:fs';
      const args = process.argv.slice(2);
      const env = process.env;
      appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
      const output = (value) => { console.log(value); process.exit(0); };
      if (args[0] === 'context') output(env.ENDPOINT ?? 'unix:///synthetic/docker.sock');
      if (args[0] === 'info') { if (env.NOT_READY) process.exit(1); output('linux'); }
      if (args[0] === 'ps') {
        if (args.includes('label=com.docker.compose.service=boopity')) output(env.OTHER_INSTALLATIONS ?? '');
        output(args.includes('--all') ? (env.PROJECT_CONTAINERS ?? env.EXISTING ?? '') : (env.LISTENERS ?? ''));
      }
      if (args[0] === 'volume' && args[1] === 'ls') output(env.VOLUME ?? (env.EXISTING ? '${volume}' : ''));
      if (args[0] === 'volume' && args[1] === 'inspect') output(env.VOLUME_LABEL ?? '1');
      if (args[0] === 'inspect') {
        if (args.some(value => value.includes('println .HostPort'))) output(env.OTHER_PORT ?? '3000');
        output(args.includes('{{.State.Running}}') ? (env.RUNNING ?? 'true') : (env.IDENTITY ?? '1|volume:${volume}|127.0.0.1:3000'));
      }
      if (args[0] === 'compose') {
        if (args.includes('version')) process.exit(env.NO_COMPOSE ? 1 : 0);
        if (args.includes('ps')) output(env.EXISTING ?? '');
        if (args.includes('up')) {
          if (env.COMPOSE_PROJECT_NAME || env.COMPOSE_FILE || env.COMPOSE_ENV_FILES || env.COMPOSE_PROFILES) process.exit(5);
          process.exit(env.FAIL_START ? 1 : 0);
        }
        if (args.includes('port')) output(env.BINDING ?? '127.0.0.1:3000');
        if (args.includes('exec')) {
          if (!readFileSync(0, 'utf8').includes('dist/server/manage.mjs')) process.exit(6);
          console.log(env.ENTRY);
          process.exit(env.FAIL_HANDOFF ? 1 : 0);
        }
      }
      process.exit(9);
    `,
      );
      writeFileSync(
        join(directory, "bin/lsof"),
        '#!/bin/sh\n[ "${PORT_BUSY:-}" = true ]\n',
      );
      for (const command of ["docker", "lsof"])
        chmodSync(join(directory, "bin", command), 0o700);
      const result = spawnSync("sh", ["Start Boopity.command"], {
        cwd: directory,
        env: {
          PATH: `${join(directory, "bin")}:${process.env.PATH}`,
          ENTRY: entry,
          ...overrides,
        },
        encoding: "utf8",
        timeout: 15000,
      });
      const calls: string[][] = existsSync(join(directory, "calls.jsonl"))
        ? readFileSync(join(directory, "calls.jsonl"), "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        : [];
      return { ...result, calls, directory };
    }
    it("starts a fresh pinned image without a host Node install, build or environment configuration", () => {
      const result = run({
        COMPOSE_PROJECT_NAME: "wrong",
        COMPOSE_FILE: "wrong.yaml",
        COMPOSE_ENV_FILES: "private.env",
        COMPOSE_PROFILES: "wrong",
      });
      expect(result.status, result.stderr).toBe(0);
      const up = result.calls.find((args) => args.includes("up"))!;
      expect(up).toEqual(
        expect.arrayContaining([
          "--env-file",
          "/dev/null",
          "--project-name",
          project,
          "--no-build",
          "--pull",
          "missing",
        ]),
      );
      expect(up).not.toContain("--build");
      expect(result.stdout).toContain(entry);
      expect(result.stdout).not.toContain("Press Return");
    });
    it("reopens an existing container without replacing or pulling it", () => {
      const result = run({
        EXISTING: "existing-container",
        LISTENERS: "existing-container",
        ENTRY: "http://localhost:3000/app",
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.calls.find((args) => args.includes("up"))).toEqual(
        expect.arrayContaining([
          "--no-recreate",
          "--pull",
          "never",
          "--no-build",
        ]),
      );
      expect(result.stdout).toContain("http://localhost:3000/app");
    });
    it("can restart its own stopped container", () => {
      expect(
        run({ EXISTING: "existing-container", RUNNING: "false" }).status,
      ).toBe(0);
    });
    it("does not block an unrelated installation on a different port", () => {
      expect(
        run({ OTHER_INSTALLATIONS: "another-container", OTHER_PORT: "3333" })
          .status,
      ).toBe(0);
    });
    it.each([
      [{ NOT_READY: "true" }, "Docker is not ready"],
      [{ ENDPOINT: "ssh://remote-host" }, "another computer"],
      [
        {
          DOCKER_CONTEXT: "remote",
          DOCKER_HOST: "unix:///local",
          ENDPOINT: "tcp://remote:2376",
        },
        "another computer",
      ],
      [{ DOCKER_HOST: "tcp://remote:2376" }, "another computer"],
      [{ SSH_CONNECTION: "synthetic ssh" }, "for this computer"],
      [{ NO_COMPOSE: "true" }, "Start Docker"],
      [{ LISTENERS: "other-container" }, "Port 3000 is already"],
      [{ PORT_BUSY: "true" }, "Port 3000 is already"],
      [{ PROJECT_CONTAINERS: "unrelated" }, "name is already used"],
      [
        { OTHER_INSTALLATIONS: "stopped-original-container" },
        "even if it is stopped",
      ],
      [{ VOLUME: volume, VOLUME_LABEL: "unknown" }, "does not belong"],
      [{ VOLUME: volume }, "container is missing"],
      [
        { EXISTING: "existing-container", VOLUME: "" },
        "missing its expected data volume",
      ],
      [
        { EXISTING: "existing-container", IDENTITY: "unknown" },
        "different settings",
      ],
      [
        {
          EXISTING: "existing-container",
          LISTENERS: "existing-container\nother-container",
        },
        "Port 3000 is already",
      ],
      [
        { EXISTING: "existing-container", RUNNING: "false", PORT_BUSY: "true" },
        "Port 3000 is already",
      ],
    ] as [Record<string, string>, string][])(
      "stops safely for %j",
      (env, message) => {
        const result = run(env);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(message);
        expect(
          result.calls.some(
            (args) => args.includes("up") || args.includes("exec"),
          ),
        ).toBe(false);
        expect(result.stdout + result.stderr).not.toContain("#setup=");
      },
    );
    it("does not request setup access after a start failure", () => {
      const result = run({ FAIL_START: "true" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Do not delete any data volumes");
      expect(result.calls.some((args) => args.includes("exec"))).toBe(false);
    });
    it("checks the actual port binding before requesting setup access", () => {
      const result = run({ BINDING: "0.0.0.0:3000" });
      expect(result.status).toBe(1);
      expect(result.calls.some((args) => args.includes("exec"))).toBe(false);
    });
    it.each([
      "https://other.example.test/app",
      "http://localhost:3001/app",
      "http://localhost:3000/app?other=1",
      entry + "&other=1",
    ])("never displays an unexpected address %s", (url) => {
      const result = run({ ENTRY: url });
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain(url);
    });
    it("never displays a failed handoff's output", () => {
      const result = run({ FAIL_HANDOFF: "true" });
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain("#setup=");
    });
  },
);
