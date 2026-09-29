import { spawn } from "node:child_process";
import type { NodeConfig } from "./runtime/config";
import type { NodeControl } from "./runtime/control";
import { setupLink } from "../src/shared/setup-link";

type StartupAccess = ReturnType<NodeControl["startupAccess"]>;

/** Never launch a browser on a remote server, in a container, or in automation. */
export function canOpenSetupBrowser(
  config: NodeConfig,
  environment: NodeJS.ProcessEnv,
  interactive: boolean,
) {
  const url = new URL(config.appUrl);
  return (
    interactive &&
    environment.BOOPITY_OPEN_BROWSER !== "false" &&
    !environment.CI &&
    !environment.SSH_CONNECTION &&
    !environment.SSH_CLIENT &&
    !environment.SSH_TTY &&
    ["127.0.0.1", "::1"].includes(config.host) &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    Number(url.port || 80) === config.port
  );
}

export function openSetupBrowser(url: string): Promise<boolean> {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer.exe"
        : process.platform === "linux"
          ? "xdg-open"
          : null;
  if (!command) return Promise.resolve(false);
  return new Promise((resolve) => {
    // No shell: the private URL must never be interpreted as a command.
    const child = spawn(command, [url], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 5_000);
    const finish = (opened: boolean) => {
      clearTimeout(timer);
      resolve(opened);
    };
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));
  });
}

export async function announceStartup(
  config: NodeConfig,
  access: StartupAccess,
  options: {
    environment: NodeJS.ProcessEnv;
    interactive: boolean;
    log: (message: string) => void;
    open: (url: string) => Promise<boolean>;
  },
) {
  const { log } = options;
  log(`Boopity is ready at ${config.appUrl}`);
  if (access.mode === "owner") return;
  if (access.mode === "password") {
    log("Open your website and enter your setup password to continue.");
    if (canOpenSetupBrowser(config, options.environment, options.interactive)) {
      try {
        await options.open(`${config.appUrl}/setup`);
      } catch {
        /* No credentials or launcher errors in output. */
      }
    }
    return;
  }
  if (access.mode === "resume") {
    log(
      "Setup is in progress. Continue in the browser where you started.\nNeed a new link? Run: npm run manage -- setup-link",
    );
    return;
  }
  if (access.mode === "guided") {
    log(
      "Open your website to verify the owner email chosen in hosting settings.",
    );
    return;
  }
  if (access.mode === "manual") {
    log(
      `Installer access: ${config.appUrl}/setup/code\nFor private setup links and recovery, see docs/development/installer-access.md.`,
    );
    return;
  }
  if (access.mode !== "link") return;
  const url = setupLink(config.appUrl, access.token);
  log(
    `Finish setup (private — expires in 30 minutes):\n${url}\nKeep this link and your startup logs private. Only the latest link works.\nExpired? Restart Boopity or run: npm run manage -- setup-link`,
  );
  if (canOpenSetupBrowser(config, options.environment, options.interactive)) {
    try {
      if (await options.open(url)) return;
    } catch {
      /* Never print browser errors: they may contain the credential. */
    }
    log("Your browser could not be opened. Open the Finish setup link above.");
  }
}
