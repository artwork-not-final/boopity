import type { Bindings } from "../../worker/env";
import type { SqlDatabase } from "../contracts";

export const portalOpenSql = `EXISTS(SELECT 1 FROM installation i JOIN booking_policy p ON p.id=i.id WHERE i.id=1 AND i.setup_state='ready' AND json_extract(p.config,'$.portalEnabled')=1)`;
export async function clientEmailAllowed(db: SqlDatabase, email: string) {
  return Boolean(
    await db
      .prepare(
        `SELECT 1 WHERE ${portalOpenSql} AND (
    EXISTS(SELECT 1 FROM business_memberships m JOIN user u ON u.id=m.user_id JOIN clients c ON c.id=m.client_id
      WHERE m.role='client' AND m.revoked_at IS NULL AND c.status='active' AND lower(c.email)=?1 AND lower(u.email)=?1)
    OR EXISTS(SELECT 1 FROM client_invitations v JOIN clients c ON c.id=v.client_id WHERE v.email=?1 AND lower(c.email)=?1
      AND c.status='active' AND v.revoked_at IS NULL AND v.consumed_at IS NULL AND v.expires_at>?2))`,
      )
      .bind(email, Date.now())
      .first(),
  );
}
export async function canAuthenticate(env: Bindings, email: string) {
  if (email.toLowerCase() === env.SELF_HOSTED_AUTH_EMAIL) return true;
  return env.SELF_HOSTED_CLIENT_ACCESS
    ? clientEmailAllowed(env.DB, email.toLowerCase())
    : false;
}
