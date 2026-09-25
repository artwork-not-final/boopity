import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { handleRequestError } from "../core/http-errors";
import { parseInput } from "../core/http-input";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readInstallation } from "../core/installation";
import { cleanupExpiredRecords } from "../core/maintenance";
import { runLeasedJob } from "../core/jobs";
import type { AppEnv, Bindings } from "../core/env";
import type { NodeConfig } from "./runtime";
import type { NodeControl } from "./control";
import { setupRoutes } from "./setup-routes";
import { emailConfigured } from "../auth/config";
import { businessRoutes } from "../business/routes";
import { invitationRoutes } from "../business/invitations";
import { expireRequests } from "../business/bookings";
import { PaymentService } from "../payments/service";
import { paymentMode } from "../../src/shared/payments";

const assetTypes: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
};

export function createNodeApp(
  env: Bindings,
  config: NodeConfig,
  control?: NodeControl,
  paymentOverride?: PaymentService,
) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    await next();
  });
  const payments =
    paymentOverride ??
    (control
      ? new PaymentService(
          env.DB,
          env.BETTER_AUTH_SECRET,
          control.payments,
          config.appUrl,
        )
      : undefined);
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: "no-referrer",
    }),
  );
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.env = env;
    if (new URL(c.req.url).origin !== config.appUrl)
      return c.json({ error: "Use the configured application address" }, 421);
    // A host probe must not spend a customer's request budget or depend on mail
    // settings. Only this bounded, read-only endpoint bypasses the app limiter.
    if (["GET", "HEAD"].includes(c.req.method) && c.req.path === "/api/ready") {
      await next();
      return;
    }
    c.env = control ? await control.bindings() : env;
    const ip = c.req.header("cf-connecting-ip") ?? "local";
    if (!(await env.API_RATE_LIMITER!.limit({ key: `node:${ip}` })).success) {
      c.header("Retry-After", "60");
      return c.json({ error: "Too many requests" }, 429);
    }
    if (control && !["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const signedWebhook =
        c.req.method === "POST" &&
        /^\/api\/payments\/webhooks\/stripe\/(test|live)$/.test(c.req.path);
      if (
        !signedWebhook &&
        (c.req.header("origin") !== config.appUrl ||
          c.req.header("sec-fetch-site") === "cross-site")
      )
        return c.json({ error: "Use this site's form to make changes." }, 403);
      if (
        c.req.path !== "/api/setup/logo" &&
        !/^application\/json(?:;|$)/i.test(c.req.header("content-type") ?? "")
      )
        return c.json({ error: "JSON content is required." }, 415);
      if (
        !signedWebhook &&
        !(await env.WRITE_RATE_LIMITER!.limit({ key: ip })).success
      )
        return c.json({ error: "Too many changes. Wait a minute." }, 429);
    }
    if (
      control &&
      ((c.req.path.startsWith("/api/auth/") &&
        !c.req.path.endsWith("get-session")) ||
        ["/api/setup/unlock", "/api/setup/password/unlock"].includes(
          c.req.path,
        ))
    ) {
      if (!(await env.AUTH_RATE_LIMITER!.limit({ key: ip })).success)
        return c.json(
          { error: "Too many sign-in attempts. Wait a minute." },
          429,
        );
    }
    await next();
  });
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 2 * 1024 * 1024,
      onError: (c) =>
        c.json({ error: "Request is too large (2 MB maximum)." }, 413),
    }),
  );
  app.onError(handleRequestError);
  app.on(["GET", "HEAD"], "/api/ready", async (c) => {
    await env.DB.prepare("SELECT 1").first();
    return c.json({ ok: true });
  });
  app.get("/api/health", async (c) => {
    await env.DB.prepare("SELECT 1").first();
    return c.json({
      ok: true,
      runtime: "nodejs",
      setupRequired: (await readInstallation(env.DB)).state !== "ready",
      release: control ? "self-hosted-payments" : "self-hosted-foundation",
    });
  });
  app.get("/api/installation", async (c) => {
    const installation = await readInstallation(env.DB);
    return c.json({
      branding: installation.branding,
      version: installation.version,
      setupRequired: installation.state !== "ready",
      setupAvailable: Boolean(control),
      ownerClaimed: control ? Boolean(await control.owner()) : false,
      runtime: "nodejs",
      login: {
        email: emailConfigured(c.env),
        google: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
      },
    });
  });
  if (control) {
    app.route("/api", setupRoutes(control));
    app.route("/api/portal", invitationRoutes());
    app.route("/api/business", businessRoutes(payments, control.payments));
    app.post("/api/payments/webhooks/stripe/:mode", async (c) => {
      await payments!.webhook(
        parseInput(paymentMode, c.req.param("mode")),
        await c.req.text(),
        c.req.header("stripe-signature") ?? "",
      );
      return c.json({ received: true });
    });
  }
  // Unmounted/unknown endpoints are not setup failures. Never fall through to the SPA.
  app.all("/api/*", (c) =>
    c.json({ error: "API endpoint not found.", code: "NOT_FOUND" }, 404),
  );
  app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));
  app.on(["GET", "HEAD"], "*", async (c) => {
    const path = c.req.path;
    const hashedAsset = /^\/assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(path);
    const publicFile = [
      "/favicon.svg",
      "/favicon.png",
      "/third-party-licenses.txt",
    ].includes(path);
    const shell =
      path === "/" ||
      path === "/setup" ||
      path.startsWith("/setup/") ||
      path === "/login" ||
      path === "/register" ||
      path === "/app" ||
      path.startsWith("/app/");
    if (!hashedAsset && !publicFile && !shell) return c.text("Not found", 404);
    try {
      const file = await readFile(
        join(config.assetDirectory, shell ? "index.html" : path.slice(1)),
      );
      const extension = path.split(".").at(-1)!;
      return new Response(c.req.method === "HEAD" ? null : file, {
        headers: {
          "Content-Type": shell
            ? "text/html; charset=utf-8"
            : (assetTypes[extension] ?? "application/octet-stream"),
          "Cache-Control": hashedAsset
            ? "public, max-age=31536000, immutable"
            : "no-store",
          // Raw Response headers don't inherit headers previously set on Context.
          "X-Robots-Tag": "noindex, nofollow",
        },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return c.text(
        shell
          ? "Build the self-hosted client before starting the server."
          : "Not found",
        shell ? 503 : 404,
      );
    }
  });
  return app;
}

export async function maintenanceTick(
  env: Bindings,
  payments?: PaymentService,
) {
  await expireRequests(env.DB);
  await runLeasedJob(env.DB, "auth-cleanup", 6 * 3_600_000, () =>
    cleanupExpiredRecords(env),
  );
  if (payments)
    await runLeasedJob(env.DB, "payment-reconciliation", 60_000, () =>
      payments.reconcile(),
    );
  // Provider jobs stay off until a claimed installation explicitly enables delivery.
}
