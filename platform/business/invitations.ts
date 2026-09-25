import { parseInput, readJson } from "../http-input";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { AppEnv } from "../../worker/env";
import { authDigest } from "../../worker/auth-policy";
import { businessIdentity } from "./access";
import { portalOpenSql } from "./admission";

export function randomInvite() {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
const cookieName = (url: string) =>
  url.startsWith("https:") ? "__Host-boopity.invite" : "boopity.invite";
export const invitationDigest = (secret: string, raw: string) =>
  authDigest(secret, `invitation:${raw}`);
export function invitationRoutes() {
  const api = new Hono<AppEnv>();
  async function invitation(
    c: Parameters<typeof businessIdentity>[0],
    raw = getCookie(c, cookieName(c.env.APP_URL)) ?? "",
  ) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
    const digest = await invitationDigest(c.env.BETTER_AUTH_SECRET, raw);
    return c.env.DB.prepare(
      `SELECT v.id,v.email,v.client_id AS clientId FROM client_invitations v JOIN clients c ON c.id=v.client_id
      WHERE v.digest=?1 AND v.revoked_at IS NULL AND v.consumed_at IS NULL AND v.expires_at>?2 AND c.status='active'
      AND lower(c.email)=v.email AND ${portalOpenSql}`,
    )
      .bind(digest, Date.now())
      .first<{ id: string; email: string; clientId: string }>();
  }
  api.post("/invitation/open", async (c) => {
    const { token } = parseInput(
      z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict(),
      await readJson(c.req),
    );
    if (!(await invitation(c, token)))
      throw new HTTPException(400, {
        message:
          "This invitation is unavailable, expired or already used. Ask your sitter for a new invitation.",
      });
    setCookie(c, cookieName(c.env.APP_URL), token, {
      httpOnly: true,
      secure: c.env.APP_URL.startsWith("https:"),
      sameSite: "Lax",
      path: "/",
      maxAge: 8 * 3600,
    });
    return c.json({ ok: true });
  });
  api.get("/invitation", async (c) => {
    const invite = await invitation(c);
    return c.json({ invitation: invite ? { email: invite.email } : null });
  });
  api.post("/invitation/accept", async (c) => {
    const { session } = await businessIdentity(c),
      invite = await invitation(c);
    if (!invite || invite.email !== session.user.email.toLowerCase())
      throw new HTTPException(403, {
        message: "Sign in with the invited inbox, then accept its invitation.",
      });
    const now = Date.now();
    const result = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO business_memberships(user_id,role,client_id) SELECT ?1,'client',?2
        WHERE ${portalOpenSql} AND EXISTS(SELECT 1 FROM client_invitations v JOIN clients c ON c.id=v.client_id
          WHERE v.id=?3 AND v.email=?4 AND lower(c.email)=?4 AND c.status='active' AND v.consumed_at IS NULL AND v.revoked_at IS NULL AND v.expires_at>?5)
        AND NOT EXISTS(SELECT 1 FROM business_memberships WHERE user_id=?1 AND (role='owner' OR revoked_at IS NULL))
        ON CONFLICT(user_id) DO UPDATE SET client_id=excluded.client_id,revoked_at=NULL WHERE business_memberships.role='client' AND business_memberships.revoked_at IS NOT NULL`,
      ).bind(session.user.id, invite.clientId, invite.id, invite.email, now),
      c.env.DB.prepare(
        "UPDATE client_invitations SET consumed_at=?1,consumed_by=?2 WHERE id=?3 AND changes()>0",
      ).bind(now, session.user.id, invite.id),
      c.env.DB.prepare(
        "INSERT INTO installation_audit SELECT ?1,'client-invitation-accepted',?2,?3 WHERE changes()>0",
      ).bind(crypto.randomUUID(), session.user.id, now),
    ]);
    if (!result[0].meta.changes)
      throw new HTTPException(409, {
        message:
          "Invitation or membership changed. Ask your sitter for help; accounts are never merged automatically.",
      });
    deleteCookie(c, cookieName(c.env.APP_URL), {
      path: "/",
      secure: c.env.APP_URL.startsWith("https:"),
    });
    return c.json({ ok: true });
  });
  api.get("/session", async (c) => {
    const { session, member } = await businessIdentity(c);
    return c.json({
      user: { name: session.user.name, email: session.user.email },
      role: member?.role ?? "pending",
      ...(member?.clientId ? { clientId: member.clientId } : {}),
    });
  });
  return api;
}
