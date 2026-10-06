import { randomInt } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv, Bindings } from "../core/env";
import { parseInput, readJson } from "../core/http-input";
import { businessIdentity } from "../business/access";
import { authDigest, emailCodeLimit, OTP_EXPIRES_SECONDS } from "./policy";
import { sendEmail } from "./email";
import {
  changeEmailRequest,
  changeEmailConfirmation,
  type PendingEmailChange,
} from "../../src/shared/account";

// Recheck live ownership, email and session inside each committing statement.
// A stale request must not survive sign-out, recovery or a concurrent email change.
const liveIdentity = `EXISTS (
  SELECT 1 FROM user u JOIN session s ON s.user_id=u.id
  JOIN business_memberships m ON m.user_id=u.id
  WHERE u.id=owner_email_changes.user_id AND u.email=owner_email_changes.old_email
  AND u.email_verified=1 AND s.id=owner_email_changes.session_id AND s.expires_at>?1
  AND m.role='owner' AND m.revoked_at IS NULL
) AND EXISTS(SELECT 1 FROM installation WHERE id=1 AND setup_state='ready')`;
const unusedEmail = `NOT EXISTS(SELECT 1 FROM user WHERE lower(email)=owner_email_changes.new_email)
  AND NOT EXISTS(SELECT 1 FROM clients WHERE lower(email)=owner_email_changes.new_email)`;
const invalidCodes = () =>
  new HTTPException(400, {
    message: "Check both codes. If they expired, request new ones.",
  });
const hashCode = (env: Bindings, id: string, kind: string, code: string) =>
  authDigest(
    env.BETTER_AUTH_SECRET,
    `owner-email-change:${id}:${kind}:${code}`,
  );

export function accountRoutes() {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    const { session, member } = await businessIdentity(c);
    if (member?.role !== "owner")
      throw new HTTPException(403, { message: "Owner access required." });
    const ready = await c.env.DB.prepare(
      "SELECT 1 FROM installation WHERE id=1 AND setup_state='ready'",
    ).first();
    if (!ready)
      throw new HTTPException(403, { message: "Finish setup first." });
    c.set("userId", session.user.id);
    c.set("userEmail", session.user.email);
    // A private sub-router variable, never accepted from the browser.
    c.set("accountSessionId", session.session.id);
    await next();
  });

  app.get("/email", async (c) => {
    const pending = await c.env.DB.prepare(
      `SELECT id,new_email AS newEmail,expires_at AS expiresAt FROM owner_email_changes
       WHERE user_id=?2 AND session_id=?3 AND expires_at>?1 AND delivered=1
       AND consumed_at IS NULL AND attempts<5 AND ${liveIdentity}`,
    )
      .bind(Date.now(), c.get("userId"), c.get("accountSessionId"))
      .first<PendingEmailChange>();
    return c.json({ pending });
  });

  app.post("/email", async (c) => {
    const { email } = parseInput(changeEmailRequest, await readJson(c.req));
    const current = c.get("userEmail").toLowerCase();
    if (email === current)
      throw new HTTPException(400, {
        message: "Enter a different email address.",
      });
    const conflict = await c.env.DB.prepare(
      `SELECT 1 FROM user WHERE lower(email)=?1
       UNION ALL SELECT 1 FROM clients WHERE lower(email)=?1 LIMIT 1`,
    )
      .bind(email)
      .first();
    if (conflict)
      throw new HTTPException(409, {
        message: "That email is already in use. Choose another address.",
      });
    for (const address of [current, email]) {
      const limit = await emailCodeLimit(c.env, address, "send");
      if (!limit.success) {
        c.header("Retry-After", String(limit.retryAfter));
        throw new HTTPException(429, {
          message: "Please wait before requesting more codes.",
        });
      }
    }
    const id = crypto.randomUUID();
    const currentCode = String(randomInt(0, 1_000_000)).padStart(6, "0");
    let newCode: string;
    do {
      newCode = String(randomInt(0, 1_000_000)).padStart(6, "0");
    } while (newCode === currentCode);
    const expiresAt = Date.now() + OTP_EXPIRES_SECONDS * 1000;
    await c.env.DB.prepare(
      `INSERT INTO owner_email_changes(id,user_id,session_id,old_email,new_email,current_digest,new_digest,expires_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
       ON CONFLICT(user_id) DO UPDATE SET id=excluded.id,session_id=excluded.session_id,
       old_email=excluded.old_email,new_email=excluded.new_email,current_digest=excluded.current_digest,
       new_digest=excluded.new_digest,expires_at=excluded.expires_at,attempts=0,delivered=0,consumed_at=NULL`,
    )
      .bind(
        id,
        c.get("userId"),
        c.get("accountSessionId"),
        current,
        email,
        await hashCode(c.env, id, "current", currentCode),
        await hashCode(c.env, id, "new", newCode),
        expiresAt,
      )
      .run();
    try {
      for (const [to, code, description] of [
        [current, currentCode, "confirm access to your current email"],
        [email, newCode, "verify your new email"],
      ]) {
        await sendEmail(c.env, {
          to,
          subject: "Confirm your Boopity account email change",
          html: `<p>Use this code to ${description} in your account settings:</p><p><strong>${code}</strong></p><p>It expires in 5 minutes. Your email will not change until both codes are confirmed.</p><p>If you did not request this change, do not share the code. Sign in to your website and cancel the pending change.</p>`,
        });
      }
    } catch {
      await c.env.DB.prepare("DELETE FROM owner_email_changes WHERE id=?1")
        .bind(id)
        .run();
      return c.json(
        {
          error:
            "We couldn’t send both codes. Your email hasn’t changed. Please try again later.",
        },
        503,
      );
    }
    const ready = await c.env.DB.prepare(
      `UPDATE owner_email_changes SET delivered=1 WHERE id=?2 AND expires_at>?1 AND ${liveIdentity}`,
    )
      .bind(Date.now(), id)
      .run();
    if (!ready.meta.changes)
      throw new HTTPException(409, {
        message:
          "This request was replaced or your session ended. Start again.",
      });
    return c.json({
      id,
      newEmail: email,
      expiresAt,
    } satisfies PendingEmailChange);
  });

  app.delete("/email", async (c) => {
    // Any authenticated owner session may cancel a pending request.
    await c.env.DB.prepare("DELETE FROM owner_email_changes WHERE user_id=?1")
      .bind(c.get("userId"))
      .run();
    return c.json({ ok: true });
  });

  app.post("/email/confirm", async (c) => {
    const input = parseInput(changeEmailConfirmation, await readJson(c.req));
    const limit = await emailCodeLimit(c.env, c.get("userEmail"), "verify");
    if (!limit.success) {
      c.header("Retry-After", String(limit.retryAfter));
      throw new HTTPException(429, {
        message: "Please wait before trying these codes again.",
      });
    }
    const attempt = await c.env.DB.prepare(
      `UPDATE owner_email_changes SET attempts=attempts+1 WHERE id=?2 AND user_id=?3 AND session_id=?4
       AND delivered=1 AND consumed_at IS NULL AND expires_at>?1 AND attempts<5 AND ${liveIdentity}`,
    )
      .bind(Date.now(), input.id, c.get("userId"), c.get("accountSessionId"))
      .run();
    if (!attempt.meta.changes) throw invalidCodes();
    const currentDigest = await hashCode(
      c.env,
      input.id,
      "current",
      input.currentCode,
    );
    const newDigest = await hashCode(c.env, input.id, "new", input.newCode);
    const now = Date.now(),
      auditId = crypto.randomUUID();
    const gate = "EXISTS(SELECT 1 FROM installation_audit WHERE id=?1)";
    const result = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO installation_audit(id,event,actor,created_at)
         SELECT ?2,'owner-email-changed',user_id,?1 FROM owner_email_changes
         WHERE id=?3 AND user_id=?4 AND session_id=?5 AND delivered=1 AND consumed_at IS NULL
         AND expires_at>?1 AND attempts<=5 AND current_digest=?6 AND new_digest=?7
         AND ${liveIdentity} AND ${unusedEmail}`,
      ).bind(
        now,
        auditId,
        input.id,
        c.get("userId"),
        c.get("accountSessionId"),
        currentDigest,
        newDigest,
      ),
      c.env.DB.prepare(
        `UPDATE user SET email=(SELECT new_email FROM owner_email_changes WHERE id=?2),
         email_verified=1,updated_at=?3 WHERE id=?4 AND ${gate}`,
      ).bind(auditId, input.id, now, c.get("userId")),
      c.env.DB.prepare(
        `UPDATE setup_progress SET owner_email=(SELECT new_email FROM owner_email_changes WHERE id=?2)
         WHERE id=1 AND ${gate}`,
      ).bind(auditId, input.id),
      c.env.DB.prepare(`DELETE FROM account WHERE user_id=?2 AND ${gate}`).bind(
        auditId,
        c.get("userId"),
      ),
      c.env.DB.prepare(`DELETE FROM operator_sessions WHERE ${gate}`).bind(
        auditId,
      ),
      c.env.DB.prepare(`DELETE FROM operator_tokens WHERE ${gate}`).bind(
        auditId,
      ),
      // Deleting sessions also deletes their pending email changes via the FK.
      c.env.DB.prepare(`DELETE FROM session WHERE user_id=?2 AND ${gate}`).bind(
        auditId,
        c.get("userId"),
      ),
    ]);
    if (!result[0].meta.changes) throw invalidCodes();
    return c.json({ ok: true });
  });
  return app;
}
