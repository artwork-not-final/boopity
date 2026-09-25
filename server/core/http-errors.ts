import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import { ZodError } from "zod";
import type { AppEnv } from "./env";

export function handleRequestError(error: Error, c: Context<AppEnv>) {
  if (error instanceof HTTPException && error.status < 500)
    return c.json({ error: error.message }, error.status);

  const status = error instanceof HTTPException ? error.status : 500;
  const requestId = c.get("requestId") ?? crypto.randomUUID();
  c.header("X-Request-Id", requestId);
  // Deliberately exclude error messages/stacks, raw URLs, headers, and bodies:
  // they can contain setup links, provider keys, or client information.
  console.error(
    JSON.stringify({
      event: "http.error",
      requestId,
      method: [
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
      ].includes(c.req.method)
        ? c.req.method
        : "OTHER",
      route: routePath(c) || "unmatched",
      status,
      category:
        error instanceof ZodError || error instanceof SyntaxError
          ? "invalid_server_data"
          : error instanceof HTTPException
            ? "http_failure"
            : "unexpected_failure",
    }),
  );
  return c.json(
    {
      error: "The server couldn't complete that request. Please try again.",
      requestId,
    },
    status,
  );
}
