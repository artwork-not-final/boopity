// Test-only loopback TLS proxy and SMTP sink. Never included in the app image.
import assert from "node:assert/strict";
import { createServer as httpServer, request } from "node:http";
import { createServer as httpsServer } from "node:https";
import { createServer as tlsServer } from "node:tls";
import { readFileSync, writeFileSync } from "node:fs";

assert.equal(process.env.BOOPITY_CONTAINER_QA, "https-disposable");
const origin = "https://pets.example.test:3443";
const credentials = {
  key: readFileSync("/qa/key.pem"),
  cert: readFileSync("/qa/cert.pem"),
};
httpsServer(credentials, (incoming, response) => {
  if (incoming.headers.host !== new URL(origin).host) {
    response.writeHead(421).end();
    return;
  }
  const upstream = request(
    {
      hostname: "127.0.0.1",
      port: 3000,
      path: incoming.url,
      method: incoming.method,
      headers: {
        ...incoming.headers,
        host: new URL(origin).host,
        "x-forwarded-for": incoming.socket.remoteAddress,
        "x-forwarded-proto": "https",
        forwarded: "",
      },
    },
    (result) => {
      response.writeHead(result.statusCode, result.headers);
      result.pipe(response);
    },
  );
  upstream.on("error", () => response.writeHead(502).end());
  incoming.pipe(upstream);
}).listen(3443, "127.0.0.1");
httpServer((_request, response) => {
  response.writeHead(308, { location: origin + "/setup" }).end();
}).listen(3080, "127.0.0.1");

// A minimal SMTP-over-TLS recipient captures only synthetic email in private tmpfs.
tlsServer(credentials, (socket) => {
  socket.setEncoding("utf8");
  socket.write("220 localhost synthetic SMTP\r\n");
  let buffer = "",
    message = "",
    inData = false;
  socket.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\r\n")) {
      const end = buffer.indexOf("\r\n"),
        line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (inData) {
        if (line !== ".") {
          message += line + "\r\n";
          continue;
        }
        writeFileSync("/tmp/https-qa-email.txt", message, { mode: 0o600 });
        inData = false;
        socket.write("250 synthetic message accepted\r\n");
      } else if (/^(EHLO|HELO) /i.test(line)) {
        socket.write("250 localhost\r\n");
      } else if (/^(MAIL FROM|RCPT TO|RSET|NOOP)/i.test(line)) {
        socket.write("250 OK\r\n");
      } else if (line === "DATA") {
        inData = true;
        message = "";
        socket.write("354 Send message\r\n");
      } else if (line === "QUIT") {
        socket.end("221 Bye\r\n");
      } else socket.write("500 Unsupported test command\r\n");
    }
  });
  socket.on("error", () => {});
}).listen(2465, "127.0.0.1");
