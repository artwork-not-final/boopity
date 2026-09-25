// Disposable, loopback-only browser/SMTP harness. Never use this as an application server.
import { createServer as createSmtp } from "node:net";
import { createServer as createHttp } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import sharp from "sharp";
import { createNodeApp } from "../../server/runtime/app";
import {
  createRuntime,
  ingressRequest,
  loadConfig,
} from "../../server/runtime/runtime";

const data = mkdtempSync(join(tmpdir(), "boopity-setup-browser-"));
const messages: { code: string; recipient: string }[] = [];
const smtp = createSmtp((socket) => {
  socket.setTimeout(15_000, () => socket.destroy());
  socket.setEncoding("utf8");
  socket.write("220 localhost synthetic mail sink\r\n");
  let buffer = "",
    recipient = "",
    collecting = false,
    content = "";
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    if (buffer.length + content.length > 100_000) {
      socket.destroy();
      return;
    }
    let newline;
    while ((newline = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 2);
      if (collecting) {
        if (line !== ".") {
          content += line + "\r\n";
          continue;
        }
        collecting = false;
        const decoded = content
          .replace(/=\r\n/g, "")
          .replace(/=([0-9A-F]{2})/gi, (_, hex: string) =>
            String.fromCharCode(parseInt(hex, 16)),
          );
        const code = decoded.match(/<strong>(\d{6})<\/strong>/)?.[1];
        if (code) messages.push({ code, recipient });
        content = "";
        socket.write("250 accepted locally only\r\n");
        continue;
      }
      if (/^(EHLO|HELO)/i.test(line))
        socket.write("250-localhost\r\n250 8BITMIME\r\n");
      else if (/^MAIL FROM:/i.test(line)) socket.write("250 OK\r\n");
      else if (/^RCPT TO:/i.test(line)) {
        recipient = line.slice(8).trim();
        socket.write(
          recipient === "<owner@example.test>"
            ? "250 OK\r\n"
            : "550 Only the synthetic test inbox is allowed\r\n",
        );
      } else if (/^DATA$/i.test(line)) {
        collecting = true;
        socket.write("354 End with dot\r\n");
      } else if (/^QUIT$/i.test(line)) socket.end("221 Goodbye\r\n");
      else if (/^(RSET|NOOP)/i.test(line)) socket.write("250 OK\r\n");
      else socket.write("500 Unsupported command\r\n");
    }
  });
  socket.on("error", () => {});
});
await new Promise<void>((resolve) => smtp.listen(3325, "127.0.0.1", resolve));
const config = loadConfig({
  APP_URL: "http://localhost:3310",
  PORT: "3310",
  HOST: "127.0.0.1",
  DATA_DIR: data,
});
const runtime = createRuntime(
  config,
  process.argv.includes("--guided")
    ? {
        BOOPITY_OWNER_EMAIL: "owner@example.test",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "3325",
        SMTP_INSECURE_LOCAL: "true",
        EMAIL_FROM: "hello@example.test",
        EMAIL_DELIVERY_MODE: "restricted",
        EMAIL_TEST_RECIPIENT: "owner@example.test",
      }
    : {
        SMTP_INSECURE_LOCAL: "true",
        BOOPITY_SETUP_TOKEN: "local-browser-only-token-00000000000000000000",
      },
);
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
    return normalized
      ? app.fetch(normalized)
      : new Response("Wrong host", { status: 421 });
  },
});
const inbox = createHttp((request, response) => {
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "text/plain; charset=utf-8");
  if (
    request.method !== "GET" ||
    request.url !== "/" ||
    request.headers.host !== "localhost:3311"
  ) {
    response.writeHead(404).end();
    return;
  }
  response.end(
    `Local synthetic SMTP inbox. No mail leaves this computer.\nAccepted: ${messages.length}\n${messages.at(-1) ? `Recipient: owner@example.test\nCode: ${messages.at(-1)!.code}` : "No messages yet."}\n`,
  );
});
await new Promise<void>((resolve) => inbox.listen(3311, "127.0.0.1", resolve));
await sharp({
  create: { width: 64, height: 64, channels: 4, background: "#285943" },
})
  .png()
  .toFile(join(data, "test-logo.png"));
console.log(
  JSON.stringify({
    app: process.argv.includes("--guided")
      ? config.appUrl
      : `${config.appUrl}/setup/code`,
    inbox: "http://localhost:3311",
    smtp: "127.0.0.1:3325",
    data,
    logo: join(data, "test-logo.png"),
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
  inbox.close();
  inbox.closeIdleConnections();
  smtp.close();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
