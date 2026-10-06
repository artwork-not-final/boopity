import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../core/env";
import type { SqlDatabase } from "../core/contracts";

const locks = new WeakMap<
  SqlDatabase,
  { tail: Promise<void>; pending: number }
>();

/** The supported SQLite deployment has one application process. Serialize auth
 * writes with email changes so an in-flight provider callback cannot recreate
 * a Google binding or session after we revoke it. Acquire BEFORE loading bindings.
 * The transactional database checks still protect session expiry and recovery.
 */
export function accountMutationLock(
  db: SqlDatabase,
): MiddlewareHandler<AppEnv> {
  const lock = locks.get(db) ?? { tail: Promise.resolve(), pending: 0 };
  locks.set(db, lock);
  return async (c, next) => {
    const callback =
      c.req.method === "GET" && c.req.path === "/api/auth/callback/google";
    const mutation =
      c.req.method !== "GET" &&
      c.req.method !== "HEAD" &&
      (c.req.path.startsWith("/api/auth/") ||
        c.req.path.startsWith("/api/account/"));
    if (!callback && !mutation) return next();
    // The runtime's body limit runs first. Finish receiving that bounded body
    // before taking the lock so a slow upload cannot stall other sign-ins.
    if (mutation && c.req.raw.body) {
      const body = await c.req.arrayBuffer();
      c.req.raw = new Request(c.req.raw, { method: c.req.method, body });
    }
    if (lock.pending >= 10) {
      c.header("Retry-After", "10");
      return c.json(
        { error: "Sign-in is busy. Please try again shortly." },
        429,
      );
    }
    const previous = lock.tail;
    let release!: () => void;
    lock.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    lock.pending++;
    await previous;
    try {
      await next();
    } finally {
      lock.pending--;
      release();
    }
  };
}
