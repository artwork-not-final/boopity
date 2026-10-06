import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { APIError } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import { AsyncLocalStorage } from "node:async_hooks";
import { authDatabase } from "../db/auth-database";
import type { BackgroundContext } from "../core/contracts";
import { authSchema } from "../db/schema";
import { sendEmail } from "./email";
import type { Bindings } from "../core/env";
import { appOrigin } from "./config";
import { authDigest, OTP_EXPIRES_SECONDS, OTP_LENGTH } from "./policy";
import { canAuthenticate } from "../business/admission";

type DeliveryState = { attempted: boolean; accepted: boolean };
export const authDelivery = new AsyncLocalStorage<DeliveryState>();
const authCache = new WeakMap<
  object,
  { values: unknown[]; auth: ReturnType<typeof buildAuth> }
>();

// Reuse immutable framework configuration, never session/user data or request contexts.
// Binding/secret changes invalidate the entry, including in tests and local development.
export function createAuth(
  env: Bindings,
  _executionContext?: BackgroundContext,
) {
  const values = [
    env.DB,
    env.APP_URL,
    env.AUTH_MODE,
    env.BETTER_AUTH_SECRET,
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.EMAIL_FROM,
    env.RESEND_API_KEY,
    env.EMAIL_DELIVERY_MODE,
    env.EMAIL_TEST_RECIPIENT,
    env.MAIL_TRANSPORT,
    env.SELF_HOSTED,
    env.SELF_HOSTED_AUTH_EMAIL,
    env.SELF_HOSTED_CLIENT_ACCESS,
    env.BRAND_NAME,
  ];
  // Global imported env and request env may be different wrappers for the same bindings.
  const cacheKey = env.DB ?? env;
  const cached = authCache.get(cacheKey);
  if (cached && values.every((value, i) => value === cached.values[i]))
    return cached.auth;
  // Snapshot config so callbacks on in-flight requests cannot see a later secret rotation.
  const auth = buildAuth({ ...env });
  authCache.set(cacheKey, { values, auth });
  return auth;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character];
  });
}

function buildAuth(env: Bindings) {
  const origin = appOrigin(env);
  const socialProviders =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            prompt: "select_account" as const,
          },
        }
      : undefined;

  return betterAuth({
    appName: env.BRAND_NAME ?? "Boopity",
    logger: {
      level: "warn",
      log: (level) => {
        console.warn(JSON.stringify({ event: "auth.diagnostic", level }));
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: origin,
    trustedOrigins: [origin],
    database: drizzleAdapter(authDatabase(env.DB), {
      provider: "sqlite",
      schema: authSchema,
    }),
    emailAndPassword: { enabled: false },
    plugins: [
      emailOTP({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_EXPIRES_SECONDS,
        allowedAttempts: 3,
        storeOTP: {
          hash: (otp) => authDigest(env.BETTER_AUTH_SECRET, `code:${otp}`),
        },
        resendStrategy: "rotate",
        disableSignUp: false,
        sendVerificationOnSignUp: false,
        changeEmail: { enabled: false },
        rateLimit: { window: 60, max: 3 },
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "sign-in")
            throw new Error("Unsupported email code purpose");
          const delivery = authDelivery.getStore();
          if (delivery) delivery.attempted = true;
          const business = (env.BRAND_NAME ?? "Boopity").replace(
            /[\r\n]/g,
            " ",
          );
          await sendEmail(env, {
            to: email,
            subject: `Your ${business} sign-in code`,
            html: `<p>Your ${escapeHtml(business)} sign-in code is:</p><p style="font-size:28px;letter-spacing:6px"><strong>${escapeHtml(otp)}</strong></p><p>Enter this code in the page where you requested it. It expires in 5 minutes and works once.</p><p>If you did not request this code, you can ignore this email. Never share your code.</p><p>Powered by Boopity</p>`,
          });
          if (delivery) delivery.accepted = true;
        },
      }),
    ],
    socialProviders,
    account: {
      encryptOAuthTokens: Boolean(env.SELF_HOSTED),
      accountLinking: { enabled: true, allowDifferentEmails: false },
    },
    // Expiry is still enforced by Better Auth when a code/state is used. The existing
    // bounded maintenance cron removes expired rows; login must not sweep the table.
    verification: { disableCleanup: true },
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 300,
      max: 10,
      // Reading an existing session happens on navigation/focus and is not a login
      // attempt. Keep credential-writing limits intact without logging out normal readers.
      customRules: { "/get-session": { window: 60, max: 120 } },
    },
    advanced: {
      // Fetch session + current user together; no cookie/user cache or revocation lag.
      database: { joins: true },
      disableCSRFCheck: false,
      disableOriginCheck: false,
      useSecureCookies: origin.startsWith("https://"),
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
      // Await code delivery: new and existing accounts use the same path, and the UI
      // must not claim a code was sent when the provider rejects it.
    },
    databaseHooks: {
      // Google is identity-only here, not a delegated Google API integration. Keep
      // the provider/account binding, but never retain its bearer or ID tokens.
      // Better Auth's encryption flag does not cover idToken in every link path.
      account: {
        create: {
          before: async (account) =>
            env.SELF_HOSTED
              ? {
                  data: {
                    ...account,
                    accessToken: null,
                    refreshToken: null,
                    idToken: null,
                  },
                }
              : undefined,
        },
        update: {
          before: async (account) =>
            env.SELF_HOSTED
              ? {
                  data: {
                    ...account,
                    accessToken: null,
                    refreshToken: null,
                    idToken: null,
                  },
                }
              : undefined,
        },
      },
      session: {
        create: {
          before: async (newSession) => {
            if (env.SELF_HOSTED && env.SELF_HOSTED_AUTH_EMAIL !== undefined) {
              const user = await env.DB.prepare(
                "SELECT email FROM user WHERE id=?1",
              )
                .bind(newSession.userId)
                .first<{ email: string }>();
              if (!user || !(await canAuthenticate(env, user.email)))
                throw new APIError("FORBIDDEN", {
                  message: "This account cannot sign in to this installation.",
                  code: "ACCOUNT_ACCESS_DENIED",
                });
            }
          },
        },
      },
      user: {
        create: {
          before: async (newUser) => {
            if (
              env.SELF_HOSTED &&
              env.SELF_HOSTED_AUTH_EMAIL !== undefined &&
              !(await canAuthenticate(env, newUser.email))
            ) {
              throw new APIError("FORBIDDEN", {
                message: "This account cannot join this installation.",
                code: "ACCOUNT_ACCESS_DENIED",
              });
            }
          },
          after: async (newUser) => {
            // An authenticated client is not a business owner. Phase 2 explicitly grants membership.
            if (env.SELF_HOSTED) return;
            const now = Date.now();
            await env.DB.prepare(
              `INSERT OR IGNORE INTO sitter_profiles
                (id, user_id, business_name, time_zone, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
            )
              .bind(
                crypto.randomUUID(),
                newUser.id,
                `${newUser.name}'s Pet Care`,
                "America/New_York",
                now,
                now,
              )
              .run();
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
