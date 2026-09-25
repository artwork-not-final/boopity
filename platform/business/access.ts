import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { createAuth } from "../../worker/auth";
import type { AppEnv } from "../../worker/env";
import { portalOpenSql } from "./admission";
export async function businessIdentity(c: Context<AppEnv>) {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session)
    throw new HTTPException(401, { message: "Sign in to continue." });
  if (!session.user.emailVerified)
    throw new HTTPException(403, { message: "Verify your email first." });
  const member = await c.env.DB.prepare(
    `SELECT m.role,m.client_id AS clientId,sp.id AS sitterId FROM business_memberships m
    JOIN sitter_profiles sp ON sp.user_id=(SELECT user_id FROM business_memberships WHERE role='owner' AND revoked_at IS NULL)
    WHERE m.user_id=?1 AND m.revoked_at IS NULL AND (m.role='owner' OR (${portalOpenSql} AND EXISTS(
      SELECT 1 FROM clients c WHERE c.id=m.client_id AND c.sitter_id=sp.id AND c.status='active' AND lower(c.email)=?2)))`,
  )
    .bind(session.user.id, session.user.email.toLowerCase())
    .first<{
      role: "owner" | "client";
      clientId: string | null;
      sitterId: string;
    }>();
  return { session, member };
}
export const requireBusiness: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { session, member } = await businessIdentity(c);
  if (!member)
    throw new HTTPException(403, {
      message:
        "An active invitation-linked account is required. Contact your sitter.",
    });
  const ready = await c.env.DB.prepare(
    "SELECT 1 FROM installation WHERE id=1 AND setup_state='ready'",
  ).first();
  if (!ready)
    throw new HTTPException(403, {
      message: "The owner must finish installation setup first.",
    });
  c.set("userId", session.user.id);
  c.set("userName", session.user.name);
  c.set("userEmail", session.user.email);
  c.set("sitterId", member.sitterId);
  c.set("businessRole", member.role);
  c.set("clientId", member.clientId);
  await next();
};
export const ownerOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("businessRole") !== "owner")
    throw new HTTPException(403, { message: "Owner access required." });
  await next();
};
