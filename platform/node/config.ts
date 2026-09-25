import { isIP } from "node:net";
import { resolve } from "node:path";

export interface NodeConfig {
  dataDirectory: string;
  assetDirectory: string;
  appUrl: string;
  port: number;
  host: string;
  trustedProxyIps: string[];
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): NodeConfig {
  if (
    environment.BOOPITY_SETUP_LINK !== undefined &&
    !["auto", "manual"].includes(environment.BOOPITY_SETUP_LINK)
  ) {
    throw new Error("BOOPITY_SETUP_LINK must be auto or manual");
  }
  if (
    environment.BOOPITY_OPEN_BROWSER !== undefined &&
    !["true", "false"].includes(environment.BOOPITY_OPEN_BROWSER)
  ) {
    throw new Error("BOOPITY_OPEN_BROWSER must be true or false");
  }
  if (environment.BOOPITY_HOSTING && environment.BOOPITY_HOSTING !== "render") {
    throw new Error("Unknown BOOPITY_HOSTING adapter");
  }
  let address = environment.APP_URL;
  if (environment.BOOPITY_HOSTING === "render") {
    if (environment.RENDER !== "true")
      throw new Error("The Render adapter requires the Render runtime");
    if (address === undefined) {
      const supplied = environment.RENDER_EXTERNAL_URL;
      if (!supplied)
        throw new Error("Render has not supplied a public service address");
      const external = new URL(supplied);
      if (
        external.protocol !== "https:" ||
        external.port ||
        external.username ||
        external.password ||
        external.pathname !== "/" ||
        external.search ||
        external.hash ||
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.onrender\.com$/.test(
          external.hostname,
        ) ||
        external.hostname !== environment.RENDER_EXTERNAL_HOSTNAME
      ) {
        throw new Error("Render's public service address is invalid");
      }
      address = external.origin;
    }
  }
  // Never derive the canonical URL from an incoming Host or forwarding header.
  const app = new URL(address ?? "http://localhost:3000");
  if (
    app.username ||
    app.password ||
    app.pathname !== "/" ||
    app.search ||
    app.hash ||
    (app.protocol !== "https:" &&
      !(
        app.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(app.hostname)
      ))
  ) {
    throw new Error(
      "APP_URL must be the public HTTPS origin (HTTP is allowed only on localhost)",
    );
  }
  const port = Number(environment.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535");
  const trustedProxyIps = (environment.TRUSTED_PROXY_IPS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (trustedProxyIps.some((ip) => !isIP(ip)))
    throw new Error("Trusted proxies must be exact IP addresses");
  return {
    dataDirectory: resolve(environment.DATA_DIR ?? ".boopity"),
    assetDirectory: resolve(environment.ASSET_DIR ?? "dist/self-hosted"),
    appUrl: app.origin,
    port,
    host: environment.HOST ?? "127.0.0.1",
    trustedProxyIps,
  };
}
