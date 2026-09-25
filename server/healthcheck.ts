import { get } from "node:http";
import { loadConfig } from "../platform/node/config";

// Share origin validation with the server; probing must not initialize the database.
// Native fetch replaces Host; http.get preserves the canonical host on loopback.
const config = loadConfig();
const request = get(
  {
    hostname: "127.0.0.1",
    port: config.port,
    path: "/api/ready",
    headers: { host: new URL(config.appUrl).host },
    timeout: 4000,
  },
  (response) => {
    response.resume();
    response.on("end", () => {
      process.exitCode = response.statusCode === 200 ? 0 : 1;
    });
  },
);
request.on("timeout", () =>
  request.destroy(new Error("Health check timed out")),
);
request.on("error", () => {
  process.exitCode = 1;
});
