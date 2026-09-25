import type { Handler } from "hono";
import { z } from "zod";
import { authDelivery, createAuth } from "./auth";
import { emailCodeConfigured, emailCodeLimit } from "./policy";
import { appOrigin } from "./config";
import type { AppEnv } from "../core/env";

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const sendCode = z.object({ email, type: z.literal("sign-in") }).strict();
const verifyCode = z
  .object({
    email,
    otp: z.string().regex(/^\d{6}$/),
    name: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
const routes = new Set([
  "GET /api/auth/get-session",
  "POST /api/auth/get-session",
  "POST /api/auth/sign-out",
  "POST /api/auth/email-otp/send-verification-otp",
  "POST /api/auth/sign-in/email-otp",
  "POST /api/auth/sign-in/social",
  "GET /api/auth/callback/google",
]);

export const handleAuth: Handler<AppEnv> = async (c) => {
  // Explicitly exclude password/reset, email-change, raw OTP lookup, and unused plugin APIs.
  // Merely hiding password inputs or setting emailAndPassword.enabled=false is insufficient.
  if (!routes.has(`${c.req.method} ${c.req.path}`))
    return c.json(
      {
        code: "AUTH_ROUTE_UNAVAILABLE",
        message: "Use an email code or Google to sign in.",
      },
      404,
    );
  const sending = c.req.path === "/api/auth/email-otp/send-verification-otp";
  const verifying = c.req.path === "/api/auth/sign-in/email-otp";
  if (sending || verifying) {
    if (!emailCodeConfigured(c.env))
      return c.json(
        {
          code: "EMAIL_UNAVAILABLE",
          message: "Email sign-in is unavailable. Please try again later.",
        },
        503,
      );
    const parsed = (sending ? sendCode : verifyCode).safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success)
      return c.json(
        {
          code: "INVALID_CODE_REQUEST",
          message: "Check your email address and six-digit code.",
        },
        400,
      );
    const data = parsed.data;
    if (
      c.env.EMAIL_DELIVERY_MODE === "restricted" &&
      data.email !== c.env.EMAIL_TEST_RECIPIENT?.trim().toLowerCase()
    ) {
      return c.json(
        {
          code: "PREVIEW_EMAIL_RESTRICTED",
          message: "This preview is limited to the approved test inbox.",
        },
        403,
      );
    }
    if (sending && c.env.AUTH_MODE === "production" && !c.env.SELF_HOSTED) {
      const token = c.req.header("x-boopity-turnstile-token");
      if (!token || token.length > 2048)
        return c.json(
          {
            code: "SECURITY_CHECK_REQUIRED",
            message: "Please complete the security check.",
          },
          400,
        );
      try {
        const validation = await fetch(
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
          {
            method: "POST",
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              secret: c.env.TURNSTILE_SECRET_KEY,
              response: token,
              ...(c.req.header("cf-connecting-ip")
                ? { remoteip: c.req.header("cf-connecting-ip") }
                : {}),
            }),
          },
        );
        if (!validation.ok)
          return c.json(
            {
              code: "SECURITY_CHECK_UNAVAILABLE",
              message:
                "Security verification is unavailable. Please try again.",
            },
            503,
          );
        const checked = (await validation.json()) as {
          success?: boolean;
          action?: string;
          hostname?: string;
        };
        if (
          checked.success !== true ||
          checked.action !== "sign-in" ||
          checked.hostname !== new URL(appOrigin(c.env)).hostname
        ) {
          return c.json(
            {
              code: "SECURITY_CHECK_FAILED",
              message: "Please complete a new security check.",
            },
            400,
          );
        }
      } catch {
        return c.json(
          {
            code: "SECURITY_CHECK_UNAVAILABLE",
            message: "Security verification is unavailable. Please try again.",
          },
          503,
        );
      }
    }
    const limit = await emailCodeLimit(
      c.env,
      data.email,
      sending ? "send" : "verify",
    );
    if (!limit.success) {
      c.header("Retry-After", String(limit.retryAfter));
      return c.json(
        {
          code: "TOO_MANY_REQUESTS",
          message:
            "Too many code requests or attempts for this email. Please try again later.",
        },
        429,
      );
    }
    c.req.raw = new Request(c.req.raw, {
      method: c.req.method,
      body: JSON.stringify({
        ...data,
        ...(!sending && !("name" in data) ? { name: "Pet sitter" } : {}),
      }),
    });
  }
  if (c.req.path === "/api/auth/sign-in/social") {
    // Only the redirect-based Google flow is supported; no caller-supplied ID tokens or scopes.
    const parsed = z
      .object({
        provider: z.literal("google"),
        callbackURL: z.string().max(2048),
        errorCallbackURL: z.literal("/login").optional(),
        newUserCallbackURL: z.string().max(2048).optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        {
          code: "INVALID_SOCIAL_REQUEST",
          message: "Unable to start Google sign-in.",
        },
        400,
      );
    c.req.raw = new Request(c.req.raw, {
      method: c.req.method,
      body: JSON.stringify(parsed.data),
    });
  }
  // Better Auth catches delivery callback errors even when it awaits them. Track this
  // request's provider acceptance explicitly so a swallowed send failure is never success.
  const delivery = { attempted: false, accepted: false };
  const response = await authDelivery.run(delivery, () =>
    createAuth(c.env).handler(c.req.raw),
  );
  if (sending && response.ok && !delivery.accepted)
    return c.json(
      {
        code: "EMAIL_UNAVAILABLE",
        message:
          "We couldn’t confirm sending your code. Please try again later.",
      },
      503,
    );
  if (response.status >= 500)
    return c.json(
      {
        code: "AUTH_UNAVAILABLE",
        message: "Sign-in is unavailable right now. Please try again later.",
      },
      503,
    );
  return response;
};
