import type { AuthIdentity, SessionHeaders } from "../auth/identity";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createAuth } from "../auth/auth";
import { handleAuth } from "../auth/routes";
import { productionIssues } from "../auth/config";
import type { AppEnv, Bindings } from "../core/env";
import { createRequestSecurity } from "./security";

export async function readAuthIdentity(
  env: Bindings,
  input: SessionHeaders,
): Promise<AuthIdentity | null> {
  if (env.AUTH_MODE === "production" && productionIssues(env).length)
    throw new Error("Auth configuration unavailable");
  const headers = new Headers();
  if (input.cookie) headers.set("cookie", input.cookie);
  if (input.ip) headers.set("cf-connecting-ip", input.ip);
  if (input.userAgent) headers.set("user-agent", input.userAgent);
  // Always consult D1. No identity/session cache or cookie-only authorization.
  const current = await createAuth(env).api.getSession({ headers });
  if (!current?.user) return null;
  const { id, name, email, emailVerified } = current.user;
  // Session, OAuth access/refresh tokens and database adapter objects never cross RPC.
  return { id, name, email, emailVerified };
}

export const authService = new Hono<AppEnv>();
authService.use("*", createRequestSecurity(false));
authService.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status);
  // RPC/provider errors can contain credentials. Never log or return their messages.
  return c.json(
    {
      code: "AUTH_UNAVAILABLE",
      message: "Sign-in is unavailable right now. Please try again later.",
    },
    503,
  );
});
authService.on(["GET", "POST"], "/api/auth/*", handleAuth);
