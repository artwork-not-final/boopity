import type { Bindings } from "./env";

export function appOrigin(env: Pick<Bindings, "APP_URL" | "AUTH_MODE">) {
  const url = new URL(env.APP_URL);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(env.AUTH_MODE === "spike" && local && url.protocol === "http:")) ||
    (env.AUTH_MODE !== "spike" && local)
  )
    throw new Error("Invalid application origin configuration");
  return url.origin;
}

export function emailConfigured(env: Bindings) {
  const modeReady =
    env.EMAIL_DELIVERY_MODE === "live" ||
    (env.EMAIL_DELIVERY_MODE === "restricted" &&
      /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(
        env.EMAIL_TEST_RECIPIENT ?? "",
      ));
  return Boolean(
    modeReady && (env.MAIL_TRANSPORT || env.RESEND_API_KEY) && env.EMAIL_FROM,
  );
}

// Runtime readiness checks. No secret values are returned or logged.
export function productionIssues(env: Bindings) {
  const issues: string[] = [];
  try {
    appOrigin(env);
  } catch {
    issues.push("APP_URL must be one canonical HTTPS origin");
  }
  if (env.AUTH_MODE !== "production")
    issues.push("Production email verification is not enabled");
  if (
    !env.BETTER_AUTH_SECRET ||
    env.BETTER_AUTH_SECRET.length < 32 ||
    /replace|example/i.test(env.BETTER_AUTH_SECRET)
  )
    issues.push("A strong authentication secret is required");
  if (!emailConfigured(env) || /@resend\.dev[>\s]*$/.test(env.EMAIL_FROM ?? ""))
    issues.push("A verified sender and email transport are required");
  if (
    !env.API_RATE_LIMITER ||
    !env.AUTH_RATE_LIMITER ||
    !env.WRITE_RATE_LIMITER ||
    !env.UPLOAD_RATE_LIMITER
  )
    issues.push("Abuse-limit bindings are required");
  if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET))
    issues.push("Google OAuth configuration is incomplete");
  if (
    env.AUTH_RUNTIME !== undefined &&
    !["worker", "durable-object"].includes(env.AUTH_RUNTIME)
  )
    issues.push("Authentication runtime is invalid");
  if (env.AUTH_RUNTIME === "durable-object" && !env.AUTH_SERVICE)
    issues.push("Authentication service binding is required");
  return issues;
}
