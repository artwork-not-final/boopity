import type { MiddlewareHandler } from "hono";
import { getAuthIdentity } from "./auth-gateway";
import type { AppEnv } from "./env";

export const requireSitter: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await getAuthIdentity(c.env, c.req.raw.headers);

  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }
  if (!user.emailVerified) {
    return c.json(
      {
        error: "Verify your email before opening your workspace",
        code: "EMAIL_NOT_VERIFIED",
      },
      403,
    );
  }

  let profile = await c.env.DB.prepare(
    "SELECT id FROM sitter_profiles WHERE user_id = ?1 LIMIT 1",
  )
    .bind(user.id)
    .first<{ id: string }>();

  if (c.env.SELF_HOSTED) {
    const owner = await c.env.DB.prepare(
      `SELECT user_id FROM business_memberships
      WHERE user_id = ?1 AND role = 'owner' AND revoked_at IS NULL`,
    )
      .bind(user.id)
      .first();
    if (!owner || !profile)
      return c.json({ error: "Sitter access required" }, 403);
  }

  if (!profile) {
    const id = crypto.randomUUID();
    const now = Date.now();
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO sitter_profiles
        (id, user_id, business_name, time_zone, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
      .bind(
        id,
        user.id,
        `${user.name}'s Pet Care`,
        "America/New_York",
        now,
        now,
      )
      .run();
    profile = await c.env.DB.prepare(
      "SELECT id FROM sitter_profiles WHERE user_id = ?1 LIMIT 1",
    )
      .bind(user.id)
      .first<{ id: string }>();
  }

  if (!profile) {
    return c.json({ error: "Unable to load sitter profile" }, 500);
  }

  c.set("userId", user.id);
  c.set("userName", user.name);
  c.set("userEmail", user.email);
  c.set("sitterId", profile.id);
  await next();
};
