import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./env";
import { appOrigin, productionIssues } from "./config";

export async function readBoundedBody(request: Request, max: number) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new HTTPException(413, { message: "Request body is too large" });
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

const writeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export function uploadRequest(path: string, method: string) {
  return (
    (method === "POST" && path === "/api/documents") ||
    (method === "PUT" && /^\/api\/pets\/[^/]+\/photo$/.test(path))
  );
}

// Only the private auth service disables this binding-based ingress budget. Origin,
// configuration and body checks still run there; no request header can opt out.
export const createRequestSecurity =
  (ingressRateLimit = true): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const id = crypto.randomUUID();
    c.set("requestId", id);
    const securityHeaders = () => {
      c.header("X-Request-Id", id);
      c.header("Cache-Control", "private, no-store");
      c.header("Referrer-Policy", "no-referrer");
      c.header(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
      c.header("X-Robots-Tag", "noindex, nofollow");
    };
    securityHeaders();
    let origin: string;
    try {
      origin = appOrigin(c.env);
    } catch {
      return c.json(
        { error: "Application configuration is unavailable", requestId: id },
        503,
      );
    }
    if (new URL(c.req.url).origin !== origin)
      return c.json({ error: "Use the configured application address" }, 421);
    if (c.env.AUTH_MODE === "production" && productionIssues(c.env).length)
      return c.json(
        { error: "Production setup is incomplete", requestId: id },
        503,
      );

    const webhook =
      c.req.path === "/api/stripe/webhook" && c.req.method === "POST";
    if (writeMethods.has(c.req.method) && !webhook) {
      // Cookies are the only application authentication mechanism. CLI callers must also supply
      // the canonical Origin; cross-site and same-site sibling origins are never trusted.
      if (
        c.req.header("origin") !== origin ||
        ["cross-site", "same-site"].includes(
          c.req.header("sec-fetch-site") ?? "",
        )
      ) {
        return c.json(
          { error: "This request must come from your Boopity workspace" },
          403,
        );
      }
    }
    if (!webhook && ingressRateLimit) {
      const limiter =
        c.req.path.startsWith("/api/auth/") && writeMethods.has(c.req.method)
          ? c.env.AUTH_RATE_LIMITER
          : c.env.API_RATE_LIMITER;
      // Cloudflare supplies this header on public ingress. Never use a client-provided X-Forwarded-For.
      const ip = c.req.header("cf-connecting-ip") ?? "local";
      if (
        limiter &&
        !(await limiter.limit({ key: `boopity:${origin}:ip:${ip}` })).success
      ) {
        c.header("Retry-After", "60");
        return c.json(
          { error: "Too many requests. Try again in a minute." },
          429,
        );
      }
    }
    // Binary uploads have their own stricter byte checks after ownership validation.
    if (c.req.raw.body && !uploadRequest(c.req.path, c.req.method)) {
      const max = webhook ? 1024 * 1024 : 64 * 1024;
      const bytes = await readBoundedBody(c.req.raw, max);
      c.req.raw = new Request(c.req.raw, { method: c.req.method, body: bytes });
    }
    await next();
    // Raw Response objects (including OAuth redirects and DO fetch responses) do not
    // inherit Hono's prepared headers. Apply these to the finalized response as well.
    securityHeaders();
  };

export const requestSecurity = createRequestSecurity();

export const tenantWriteLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (writeMethods.has(c.req.method)) {
    const limiter = uploadRequest(c.req.path, c.req.method)
      ? c.env.UPLOAD_RATE_LIMITER
      : c.env.WRITE_RATE_LIMITER;
    if (
      limiter &&
      !(
        await limiter.limit({
          key: `boopity:${appOrigin(c.env)}:sitter:${c.get("sitterId")}`,
        })
      ).success
    ) {
      c.header("Retry-After", "60");
      return c.json({ error: "Too many changes. Try again in a minute." }, 429);
    }
  }
  await next();
};

export const safeRequestLog: MiddlewareHandler<AppEnv> = async (c, next) => {
  const start = Date.now();
  await next();
  // Do not log query strings, tokens, email addresses, bodies, or record identifiers.
  const area = c.req.path.split("/")[2];
  if (c.res.status >= 400)
    console.warn(
      JSON.stringify({
        event: "http.request",
        method: c.req.method,
        area: [
          "auth",
          "stripe",
          "me",
          "config",
          "health",
          "clients",
          "pets",
          "services",
          "schedule",
          "bookings",
          "payments",
          "billing",
          "documents",
          "notifications",
          "contact",
          "support",
        ].includes(area)
          ? area
          : "unknown",
        status: c.res.status,
        durationMs: Date.now() - start,
        requestId: c.get("requestId"),
      }),
    );
};
