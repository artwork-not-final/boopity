import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const source = fileURLToPath(new URL("../../", import.meta.url));
const token = "a".repeat(43);
const entry = `http://localhost:3000/setup#setup=${token}`;
const directories: string[] = [];
function fixture() {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "boopity installer-test-")),
  );
  directories.push(directory);
  for (const path of ["scripts/install", "dist/server", ".boopity", "bin"])
    mkdirSync(join(directory, path), { recursive: true });
  for (const path of [
    "scripts/install/setup-entry.mjs",
    "scripts/start-docker.sh",
  ])
    copyFileSync(join(source, path), join(directory, path));
  return directory;
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("trusted installer handoff", () => {
  function run(
    overrides: Record<string, string> = {},
    args: string[] = [],
    database = true,
  ) {
    const directory = fixture();
    if (database)
      writeFileSync(join(directory, ".boopity/boopity.sqlite"), "synthetic");
    writeFileSync(
      join(directory, "dist/server/manage.mjs"),
      `
      import { appendFileSync } from 'node:fs';
      const command = process.argv[2];
      appendFileSync('calls.jsonl', JSON.stringify(command) + '\\n');
      if (process.env.FAIL === 'true') {
        console.log(process.env.ENTRY);
        console.error('private-child-error');
        process.exit(1);
      }
      if (command === 'status') console.log(process.env.STATUS);
      else if (command === 'setup-link') console.log('Finish setup:\\n' + process.env.ENTRY);
      else process.exit(1);
    `,
    );
    const result = spawnSync(
      process.execPath,
      ["scripts/install/setup-entry.mjs", ...args],
      {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          APP_URL: "http://localhost:3000",
          ENTRY: entry,
          STATUS: '{"ownerClaimed":false}',
          ...overrides,
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    const calls = existsSync(join(directory, "calls.jsonl"))
      ? readFileSync(join(directory, "calls.jsonl"), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
    return { ...result, calls, directory };
  }
  it("returns only a validated private link for the Docker pipe", () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(entry + "\n");
    expect(result.calls).toEqual(["status", "setup-link"]);
  });
  it("returns normal sign-in without creating a token after owner claim", () => {
    const result = run({ STATUS: '{"ownerClaimed":true}' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("http://localhost:3000/app\n");
    expect(result.calls).toEqual(["status"]);
  });
  it("prints a fallback link without trying to open a browser in a noninteractive terminal", () => {
    const result = run({}, ["--open"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Open Boopity:\n" + entry);
    expect(result.stdout).toContain("your saved details stay");
    expect(result.stdout).not.toContain("opened in your browser");
  });
  it("does not create a new installation from the wrong directory", () => {
    const result = run({}, [], false);
    expect(result.status).toBe(1);
    expect(result.calls).toEqual([]);
    expect(existsSync(join(result.directory, ".boopity/boopity.sqlite"))).toBe(
      false,
    );
  });
  it.each([
    "http://care.example.test",
    "https://user:secret@care.example.test",
    "https://care.example.test/path",
    "https://care.example.test?secret=value",
    "https://care.example.test#secret",
    "file:///tmp/boopity",
  ])("rejects invalid origin %s before invoking management", (origin) => {
    const result = run({ APP_URL: origin });
    expect(result.status).toBe(1);
    expect(result.calls).toEqual([]);
    expect(result.stderr).not.toContain(origin);
  });
  it.each([
    `https://other.example.test/setup#setup=${token}`,
    `http://username:secret@localhost:3000/setup#setup=${token}`,
    `http://localhost:3000/setup?setup=${token}`,
    `http://localhost:3000/wrong#setup=${token}`,
    "http://localhost:3000/setup#setup=short",
    `http://localhost:3000/setup#setup=${token}&next=elsewhere`,
  ])("does not leak or open an unexpected management URL: %s", (url) => {
    const result = run({ ENTRY: url });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain(url);
  });
  it.each(["{}", '{"ownerClaimed":"false"}', "not-json"])(
    "fails closed on invalid status %s",
    (status) => {
      const result = run({ STATUS: status });
      expect(result.status).toBe(1);
      expect(result.calls).toEqual(["status"]);
      expect(result.stdout).toBe("");
    },
  );
  it("redacts private command failure output", () => {
    const result = run({ FAIL: "true" });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toMatch(/private-child-error|#setup=/);
  });
  it("rejects unexpected arguments before touching data", () => {
    const result = run({}, ["--reset"]);
    expect(result.status).toBe(1);
    expect(result.calls).toEqual([]);
  });
});

describe.skipIf(process.platform === "win32")("Docker host launcher", () => {
  function run(overrides: Record<string, string> = {}, args: string[] = []) {
    const directory = fixture();
    const executable = join(directory, "bin/docker");
    writeFileSync(
      executable,
      `#!${process.execPath}
      import { appendFileSync, readFileSync } from 'node:fs';
      const args = process.argv.slice(2);
      appendFileSync('docker.jsonl', JSON.stringify(args) + '\\n');
      if (args[0] === 'context') console.log('unix:///synthetic/docker.sock');
      else if (args.includes('version')) process.exit(process.env.NO_DOCKER === 'true' ? 1 : 0);
      else if (args.includes('ps')) console.log(process.env.EXISTING ?? '');
      else if (args.includes('up')) process.exit(process.env.FAIL_START === 'true' ? 1 : 0);
      else if (args.includes('exec')) {
        if (!readFileSync(0, 'utf8').includes('dist/server/manage.mjs')) process.exit(1);
        console.log(process.env.ENTRY);
        process.exit(process.env.FAIL_HANDOFF === 'true' ? 1 : 0);
      } else process.exit(1);
    `,
    );
    // Give the stub an explicit ESM scope; no npm install is involved.
    writeFileSync(join(directory, "package.json"), '{"type":"module"}');
    chmodSync(executable, 0o700);
    const result = spawnSync("sh", ["scripts/start-docker.sh", ...args], {
      cwd: directory,
      env: {
        PATH: `${join(directory, "bin")}:${process.env.PATH}`,
        ENTRY: entry,
        ...overrides,
      },
      encoding: "utf8",
      timeout: 10_000,
    });
    const calls: string[][] = existsSync(join(directory, "docker.jsonl"))
      ? readFileSync(join(directory, "docker.jsonl"), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
    return { ...result, calls, directory };
  }
  it("builds a fresh source installation, waits for readiness, and passes handoff code through stdin", () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.calls.find((args) => args.includes("up"))).toEqual([
      "compose",
      "--project-directory",
      result.directory,
      "-f",
      "compose.yaml",
      "up",
      "--detach",
      "--build",
      "--wait",
      "--wait-timeout",
      "180",
      "boopity",
    ]);
    expect(
      result.calls.find((args) => args.includes("exec"))?.slice(-6),
    ).toEqual(["exec", "-T", "boopity", "node", "--input-type=module", "-"]);
    expect(result.stdout).toContain(entry);
    expect(result.stdout).not.toContain("opened in your browser");
  });
  it("preserves the existing container instead of implicitly upgrading it", () => {
    const result = run({ EXISTING: "synthetic-container" });
    expect(result.status).toBe(0);
    const up = result.calls.find((args) => args.includes("up"));
    expect(up).toEqual(
      expect.arrayContaining([
        "--no-recreate",
        "--no-build",
        "--pull",
        "never",
      ]),
    );
    expect(up).not.toContain("--build");
  });
  it("uses the prebuilt Compose file only when requested", () => {
    const result = run({}, ["--image"]);
    expect(result.status).toBe(0);
    const up = result.calls.find((args) => args.includes("up"));
    expect(up).toEqual(
      expect.arrayContaining([
        "compose.image.yaml",
        "--no-build",
        "--pull",
        "missing",
      ]),
    );
    expect(up).not.toContain("--build");
  });
  it("respects Docker context precedence over DOCKER_HOST for browser-opening checks", () => {
    const result = run({
      DOCKER_CONTEXT: "remote-test",
      DOCKER_HOST: "unix:///local-test.sock",
    });
    expect(result.status).toBe(0);
    expect(result.calls).toContainEqual([
      "context",
      "inspect",
      "remote-test",
      "--format",
      "{{.Endpoints.docker.Host}}",
    ]);
  });
  it.each(["NO_DOCKER", "FAIL_START"])(
    "does not request credentials when %s fails",
    (flag) => {
      const result = run({ [flag]: "true" });
      expect(result.status).toBe(1);
      expect(result.calls.some((args) => args.includes("exec"))).toBe(false);
      expect(result.stdout).not.toContain(token);
    },
  );
  it("does not print failed handoff output", () => {
    const result = run({ FAIL_HANDOFF: "true" });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(token);
    expect(result.stderr).toContain("Do not delete its data volume");
  });
  it.each([
    "file:///tmp/unknown",
    "javascript:alert(1)",
    entry + "\nextra",
    "invalid",
  ])("rejects unexpected container output %s", (output) => {
    const result = run({ ENTRY: output });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Nothing was opened");
    expect(result.stdout).not.toContain(output);
  });
  it.each(["--reset", "--quick-start"])(
    "rejects unsupported launcher argument %s without calling Docker",
    (argument) => {
      const result = run({}, [argument]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "Usage: sh scripts/start-docker.sh [--image]",
      );
      expect(result.calls).toEqual([]);
    },
  );
});
