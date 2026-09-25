import { serve } from "@hono/node-server";
import { createNodeApp, maintenanceTick } from "../platform/node/app";
import {
  createRuntime,
  ingressRequest,
  loadConfig,
} from "../platform/node/runtime";
import { announceStartup, openSetupBrowser } from "./startup";

const config = loadConfig();
const runtime = createRuntime(config);
const app = createNodeApp(runtime.env, config, runtime.control);
const server = serve(
  {
    port: config.port,
    hostname: config.host,
    fetch(request, connection) {
      const normalized = ingressRequest(
        request,
        config,
        connection.incoming.socket.remoteAddress ?? "unknown",
      );
      return normalized
        ? app.fetch(normalized)
        : new Response("Use the configured application address", {
            status: 421,
          });
    },
  },
  () => {
    try {
      const access = runtime.control.startupAccess(runtime.db.connection);
      void announceStartup(config, access, {
        environment: process.env,
        interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
        log: (message) => console.log(message),
        open: openSetupBrowser,
      }).catch(() =>
        console.warn(
          "Setup instructions could not be displayed. Run: npm run manage -- setup-link",
        ),
      );
    } catch {
      // Never echo database errors or private startup credentials.
      console.warn(
        "Boopity is listening, but a setup link could not be prepared. Run: npm run manage -- setup-link",
      );
    }
  },
);
let running: Promise<unknown> | undefined;
const timer = setInterval(() => {
  if (running) return;
  running = maintenanceTick(runtime.env, runtime.payments)
    .catch(() =>
      console.warn("Scheduled maintenance failed; it will retry later."),
    )
    .finally(() => {
      running = undefined;
    });
}, 60_000);
timer.unref();
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  server.close(() => {
    void Promise.resolve(running).finally(() => runtime.close());
  });
  if ("closeIdleConnections" in server) server.closeIdleConnections();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
