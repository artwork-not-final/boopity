import type { Bindings } from "../core/env";
import { emailConfigured } from "./config";

export const OTP_LENGTH = 6;
export const OTP_EXPIRES_SECONDS = 300;

export function emailCodeConfigured(env: Bindings) {
  return (
    emailConfigured(env) &&
    (env.SELF_HOSTED ||
      env.AUTH_MODE !== "production" ||
      Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY))
  );
}

// A keyed digest protects short codes and email-derived limiter keys if D1 is exposed.
// This is not password hashing: codes are random, short-lived, single-use, and attempt-limited.
export async function authDigest(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`boopity:email-otp:${value}`),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

// Atomic, shared across Worker instances/IPs. Resending never resets the verification budget.
export async function emailCodeLimit(
  env: Bindings,
  email: string,
  operation: "send" | "verify",
) {
  const key = `email-code:${operation}:${await authDigest(env.BETTER_AUTH_SECRET, `recipient:${email}`)}`;
  const now = Date.now(),
    window = 600_000,
    max = operation === "send" ? 3 : 10;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limit (id, key, count, last_request)
    VALUES (?1, ?2, 1, ?3)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN last_request <= ?4 THEN 1 ELSE count + 1 END,
      last_request = CASE WHEN last_request <= ?4 THEN excluded.last_request ELSE last_request END
    RETURNING count, last_request AS windowStart`,
  )
    .bind(crypto.randomUUID(), key, now, now - window)
    .first<{ count: number; windowStart: number }>();
  return {
    success: Boolean(row && row.count <= max),
    retryAfter: Math.max(
      1,
      Math.ceil(((row?.windowStart ?? now) + window - now) / 1000),
    ),
  };
}
