// Disposable browser-only fixture. No outbound provider calls; never expose this server remotely.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import {
  createRuntime,
  ingressRequest,
  loadConfig,
} from "../../server/runtime/runtime";
import { createNodeApp } from "../../server/runtime/app";

const data = mkdtempSync(join(tmpdir(), "boopity-portal-browser-"));
const config = loadConfig({
  APP_URL: "http://localhost:3330",
  HOST: "127.0.0.1",
  PORT: "3330",
  DATA_DIR: data,
});
const runtime = createRuntime(config, {
  EMAIL_FROM: "hello@example.test",
  EMAIL_DELIVERY_MODE: "live",
});
const messages: { to: string; code: string }[] = [];
runtime.env.MAIL_TRANSPORT = {
  idempotent: false,
  async send(message) {
    if (
      ![
        "owner@example.test",
        "alice@example.test",
        "bob@example.test",
      ].includes(message.to)
    )
      throw new Error("Synthetic inboxes only");
    const code = message.html.match(/<strong>(\d{6})<\/strong>/)?.[1];
    if (!code) throw new Error("Only synthetic sign-in codes are supported");
    messages.push({ to: message.to, code });
    return "synthetic-local-only";
  },
};
runtime.db.connection
  .exec(`INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('qa-owner','Maple Owner','owner@example.test',1,0,0);
  INSERT INTO business_memberships(user_id,role) VALUES ('qa-owner','owner');
  INSERT INTO sitter_profiles(id,user_id,business_name,time_zone,created_at,updated_at) VALUES ('qa-business','qa-owner','Maple & Paws','America/New_York',0,0);
  UPDATE installation SET setup_state='ready',business_name='Maple & Paws',primary_color='#285943',accent_color='#c5dec8';`);
if (!process.argv.includes("--first-booking"))
  runtime.db.connection.exec(`
  INSERT INTO clients(id,sitter_id,first_name,last_name,email,notes,status,created_at,updated_at) VALUES ('qa-bob','qa-business','Bob','Baker','bob@example.test','PRIVATE BOB NOTE','active',0,0);
  INSERT INTO pets(id,client_id,name,species,created_at,updated_at) VALUES ('qa-nori','qa-bob','Nori','cat',0,0);`);
const app = createNodeApp(runtime.env, config, runtime.control);
const server = serve({
  hostname: config.host,
  port: config.port,
  fetch(request, connection) {
    const normalized = ingressRequest(
      request,
      config,
      connection.incoming.socket.remoteAddress ?? "unknown",
    );
    if (!normalized) return new Response("Wrong host", { status: 421 });
    if (
      new URL(normalized.url).pathname === "/__qa_inbox" &&
      request.method === "GET"
    ) {
      return new Response(
        `<!doctype html><title>Synthetic inbox — local QA only</title><h1>Local synthetic inbox</h1><p>No emails leave this computer.</p><ul>${messages
          .slice(-10)
          .map((m) => `<li>${m.to}: <strong>${m.code}</strong></li>`)
          .join("")}</ul>`,
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "content-security-policy":
              "default-src 'none'; frame-ancestors 'none'",
            "referrer-policy": "no-referrer",
          },
        },
      );
    }
    return app.fetch(normalized);
  },
});
console.log(
  JSON.stringify({
    app: config.appUrl + "/app",
    inbox: config.appUrl + "/__qa_inbox",
    owner: "owner@example.test",
    client: "alice@example.test",
    otherClient: "bob@example.test",
    data,
    realEmailsSent: 0,
  }),
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    runtime.close();
    rmSync(data, { recursive: true, force: true });
  });
  if ("closeIdleConnections" in server) server.closeIdleConnections();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
