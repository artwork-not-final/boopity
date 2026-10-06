import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../core/env";

/** A browser navigation must not strand the user on an API error response. */
export const googleCallbackErrors: MiddlewareHandler<AppEnv> = async (
  c,
  next,
) => {
  await next();
  if (c.req.method !== "GET") return;
  let code: unknown;
  const location = c.res.headers.get("Location");
  if (c.res.status >= 300 && c.res.status < 400 && location) {
    code = new URL(location, c.req.url).searchParams.get("error");
    if (!code) return; // Successful callback, including its session cookie.
  } else if (c.res.status >= 400) {
    const failure = await c.res
      .clone()
      .json()
      .catch(() => null);
    if (failure !== null && typeof failure === "object" && "code" in failure)
      code = failure.code;
  } else return;
  const error =
    code === "ACCOUNT_ACCESS_DENIED" || code === "account_access_denied"
      ? "account_access_denied"
      : code === "account_not_linked"
        ? "account_not_linked"
        : "google_sign_in_failed";
  // Preserve expired OAuth cookies and security headers, but never include the
  // provider message, email, OAuth code or caller-supplied URL in the redirect.
  // Hono merges existing response headers when replacing c.res, so update those
  // headers first rather than letting the old Location overwrite the safe one.
  c.header("Content-Type", undefined);
  c.header("Content-Length", undefined);
  c.header("Cache-Control", "no-store");
  c.header("Location", `/login?error=${error}`);
  c.res = new Response(null, { status: 303, headers: c.res.headers });
};
