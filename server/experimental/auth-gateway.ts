import type { Handler } from "hono";
import { HTTPException } from "hono/http-exception";
import { handleAuth } from "../auth/routes";
import { readAuthIdentity } from "./auth-service";
import type { AppEnv, Bindings } from "../core/env";

const unavailable = () =>
  new HTTPException(503, {
    message: "Sign-in is unavailable right now. Please try again later.",
  });

function authServiceStub(env: Bindings) {
  if (env.AUTH_RUNTIME === undefined || env.AUTH_RUNTIME === "worker")
    return null;
  if (env.AUTH_RUNTIME !== "durable-object" || !env.AUTH_SERVICE)
    throw unavailable();
  // One stable object per deployment namespace, not one per email, IP or session.
  // Resolve a fresh stub for each call; never retry a possibly consumed code/mail request.
  return env.AUTH_SERVICE.getByName("boopity-auth-v1");
}

export const routeAuth: Handler<AppEnv> = async (c, next) => {
  try {
    const stub = authServiceStub(c.env);
    return stub ? await stub.fetch(c.req.raw) : await handleAuth(c, next);
  } catch {
    // No automatic fallback: it would hide a broken binding and restore the CPU spike.
    throw unavailable();
  }
};

export async function getAuthIdentity(env: Bindings, headers: Headers) {
  const input = {
    cookie: headers.get("cookie") ?? undefined,
    ip: headers.get("cf-connecting-ip") ?? undefined,
    userAgent: headers.get("user-agent") ?? undefined,
  };
  try {
    const stub = authServiceStub(env);
    return stub
      ? await stub.readSession(input)
      : await readAuthIdentity(env, input);
  } catch {
    throw unavailable();
  }
}
