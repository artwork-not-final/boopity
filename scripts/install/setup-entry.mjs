// Trusted installer handoff, never an HTTP endpoint. Also runs over stdin inside
// an existing Docker image using only Node and the shipped management commands.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== "--open"))
    throw new Error("Unsupported installer argument");
  const origin = new URL(process.env.APP_URL ?? "http://localhost:3000");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/" ||
    (origin.protocol !== "https:" && !(local && origin.protocol === "http:"))
  )
    throw new Error("Invalid installation origin");
  // Do not accidentally create a second database when run from the wrong place.
  if (
    !existsSync(resolve(process.env.DATA_DIR ?? ".boopity", "boopity.sqlite"))
  )
    throw new Error("Start the installation first");
  const manage = (command) =>
    execFileSync(process.execPath, ["dist/server/manage.mjs", command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      maxBuffer: 64 * 1024,
    });
  const status = JSON.parse(manage("status"));
  if (typeof status.ownerClaimed !== "boolean")
    throw new Error("Invalid status");
  const url = status.ownerClaimed
    ? new URL("/app", origin)
    : new URL(manage("setup-link").trim().split(/\r?\n/).at(-1));
  if (
    url.origin !== origin.origin ||
    url.username ||
    url.password ||
    url.search ||
    (status.ownerClaimed
      ? url.pathname !== "/app" || Boolean(url.hash)
      : url.pathname !== "/setup" ||
        !/^#setup=[A-Za-z0-9_-]{43}$/.test(url.hash))
  )
    throw new Error("Unexpected installer link");
  if (!args.length) {
    // The host launcher captures this pipe, not the container's startup logs.
    process.stdout.write(url.href + "\n");
  } else {
    let opened = false;
    const env = process.env;
    const port = Number(env.PORT ?? 3000);
    if (
      local &&
      origin.protocol === "http:" &&
      Number(origin.port || 80) === port &&
      ["127.0.0.1", "::1"].includes(env.HOST ?? "127.0.0.1") &&
      process.stdin.isTTY &&
      process.stdout.isTTY &&
      !env.CI &&
      !env.SSH_CONNECTION &&
      !env.SSH_CLIENT &&
      !env.SSH_TTY &&
      env.BOOPITY_OPEN_BROWSER !== "false"
    ) {
      const command =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "explorer.exe"
            : process.platform === "linux"
              ? "xdg-open"
              : null;
      if (command) {
        const result = spawnSync(command, [url.href], {
          shell: false,
          stdio: "ignore",
          timeout: 5_000,
          windowsHide: true,
        });
        opened = result.status === 0 && !result.error;
      }
    }
    console.log(
      opened ? "Boopity opened in your browser." : "Open Boopity:\n" + url.href,
    );
    if (!status.ownerClaimed)
      console.log(
        "Keep the setup link private. It replaces earlier setup access; your saved details stay.",
      );
  }
} catch {
  // Child-process failures may carry a private link. Never print their output.
  console.error(
    "Could not open Boopity. Start the app first and use its original data directory and settings. Your saved data has not been reset.",
  );
  process.exitCode = 1;
}
