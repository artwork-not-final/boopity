import { parseInput, readJson } from "../http-input";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { setCookie, deleteCookie } from "hono/cookie";
import { serialize } from "hono/utils/cookie";
import { z } from "zod";
import sharp from "sharp";
import { Buffer } from "node:buffer";
import { createAuth } from "../../worker/auth";
import { handleAuth } from "../../worker/auth-routes";
import { emailConfigured } from "../../worker/config";
import {
  appearanceSchema,
  ownerSchema,
  providerSchema,
  setupPasswordSchema,
} from "../../src/shared/setup";
import { readInstallation } from "../installation";
import type { AppEnv } from "../../worker/env";
import { NodeControl, operatorSessionSeconds } from "./control";
import { canAuthenticate } from "../business/admission";

export function setupRoutes(control: NodeControl) {
  const api = new Hono<AppEnv>();
  api.get("/setup/entry", async (c) =>
    c.json({
      mode: await control.setupEntry(c.env),
      started: await control.setupStarted(),
    }),
  );
  api.post("/setup/unlock", async (c) => {
    const { token, kind } = parseInput(
      z
        .object({
          token: z.string().min(32).max(256),
          kind: z.enum(["setup", "recovery"]),
        })
        .strict(),
      await readJson(c.req),
    );
    const value = await control.consume(token, kind);
    setCookie(c, control.cookie, value, {
      path: "/",
      httpOnly: true,
      secure: c.env.APP_URL.startsWith("https:"),
      sameSite: "Strict",
      maxAge: operatorSessionSeconds(kind),
    });
    return c.json({ ok: true });
  });
  api.post("/setup/password/unlock", async (c) => {
    const { password } = parseInput(
      z.object({ password: z.string().min(1).max(128) }).strict(),
      await readJson(c.req),
    );
    const value = await control.setupPassword.unlock(
      password,
      operatorSessionSeconds("setup"),
    );
    setCookie(c, control.cookie, value, {
      path: "/",
      httpOnly: true,
      secure: c.env.APP_URL.startsWith("https:"),
      sameSite: "Strict",
      maxAge: operatorSessionSeconds("setup"),
    });
    return c.json({ ok: true });
  });
  api.post("/setup/lock", async (c) => {
    const actor = await control.operator(c);
    if (actor)
      await c.env.DB.prepare("DELETE FROM operator_sessions WHERE digest=?1")
        .bind(actor.id)
        .run();
    deleteCookie(c, control.cookie, {
      path: "/",
      secure: c.env.APP_URL.startsWith("https:"),
    });
    return c.json({ ok: true });
  });
  api.get("/setup/status", async (c) => {
    const actor = await control.actor(c, c.env),
      owner = await control.owner();
    const pending = await c.env.DB.prepare(
      "SELECT owner_email AS email, owner_name AS name, CASE WHEN mail_config_digest=?1 THEN mail_verified_at ELSE NULL END AS mailVerifiedAt FROM setup_progress WHERE id=1",
    )
      .bind(c.env.SETUP_MAIL_FINGERPRINT)
      .first<{
        email: string | null;
        name: string | null;
        mailVerifiedAt: number | null;
      }>();
    const session =
      !owner && actor.kind === "setup"
        ? await createAuth(c.env).api.getSession({ headers: c.req.raw.headers })
        : null;
    const regional = await c.env.DB.prepare(
      "SELECT time_zone AS timeZone,currency FROM installation WHERE id=1",
    ).first();
    return c.json({
      actor: actor.kind,
      owner: owner
        ? {
            name: owner.name,
            email: owner.email,
            verified: Boolean(owner.emailVerified),
          }
        : null,
      pending,
      setupPasswordSet: await control.setupPassword.enabled(),
      canClaimOwner: Boolean(
        pending?.mailVerifiedAt &&
        session?.user.emailVerified &&
        session.user.email === pending.email,
      ),
      ...(await readInstallation(c.env.DB)),
      ...regional,
      providers: await control.publicSettings(),
      readiness: {
        database: true,
        privateStorage: await control.storageReady(),
        email: emailConfigured(c.env),
        google: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
        https: c.env.APP_URL.startsWith("https:"),
        origin: c.env.APP_URL,
        googleCallback: `${c.env.APP_URL}/api/auth/callback/google`,
      },
    });
  });
  api.post("/setup/identity", async (c) => {
    const actor = await control.actor(c, c.env);
    if (actor.kind !== "setup" || (await control.owner()))
      throw new HTTPException(403, {
        message: "Owner identity is already established.",
      });
    const { email, name, setupPassword } = parseInput(
      ownerSchema.extend({ setupPassword: setupPasswordSchema.optional() }),
      await readJson(c.req),
    );
    const pinned = await c.env.DB.prepare(
      "SELECT owner_email FROM guided_installation WHERE id=1 AND closed_at IS NULL",
    ).first<{ owner_email: string }>();
    if (pinned && pinned.owner_email !== email)
      throw new HTTPException(409, {
        message: "Use the owner email selected during hosting setup.",
      });
    await control.saveIdentity(actor, name, email, setupPassword);
    return c.json({ ok: true });
  });
  api.post("/setup/owner", async (c) => {
    const operator = await control.operator(c);
    const guided = !operator && (await control.guided.available());
    const actor = operator ?? (guided ? null : await control.actor(c, c.env));
    if (!guided && actor?.kind !== "setup")
      throw new HTTPException(403, { message: "A setup claim is required." });
    const session = await createAuth(c.env).api.getSession({
      headers: c.req.raw.headers,
    });
    const pending = await c.env.DB.prepare(
      "SELECT owner_email,owner_name FROM setup_progress WHERE id=1",
    ).first<{ owner_email: string; owner_name: string }>();
    if (
      !session?.user.emailVerified ||
      session.user.email !== pending?.owner_email
    )
      throw new HTTPException(403, {
        message: "Verify the chosen owner email using its sign-in code first.",
      });
    const name = guided
      ? parseInput(
          z.object({ name: ownerSchema.shape.name }).strict(),
          await readJson(c.req),
        ).name
      : pending!.owner_name;
    const id = session.user.id,
      now = Date.now(),
      auditId = crypto.randomUUID();
    // The unique owner index is the final race barrier. All owner/profile/progress writes roll back together.
    const result = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO business_memberships(user_id,role) SELECT ?1,'owner' WHERE
        EXISTS(SELECT 1 FROM setup_progress WHERE owner_email=?2 AND mail_verified_at IS NOT NULL AND mail_config_digest=?5) AND
        (EXISTS(SELECT 1 FROM operator_sessions WHERE digest=?3 AND kind='setup' AND expires_at>?4)
          OR (?6=1 AND EXISTS(SELECT 1 FROM guided_installation WHERE id=1 AND owner_email=?2 AND closed_at IS NULL))) AND
        NOT EXISTS(SELECT 1 FROM business_memberships WHERE role='owner' AND revoked_at IS NULL)`,
      ).bind(
        id,
        session.user.email,
        actor?.id ?? "",
        now,
        c.env.SETUP_MAIL_FINGERPRINT,
        Number(guided),
      ),
      c.env.DB.prepare(
        "INSERT INTO installation_audit SELECT ?1,'owner-created',?2,?3 WHERE changes()>0",
      ).bind(auditId, id, now),
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO sitter_profiles(id,user_id,business_name,time_zone,created_at,updated_at)
        SELECT ?1,?2,business_name,time_zone,?3,?3 FROM installation WHERE id=1 AND
        EXISTS(SELECT 1 FROM installation_audit WHERE id=?4)`,
      ).bind(crypto.randomUUID(), id, now, auditId),
      c.env.DB.prepare(
        `UPDATE user SET name=?1 WHERE id=?2 AND
        EXISTS(SELECT 1 FROM installation_audit WHERE id=?3)`,
      ).bind(name, id, auditId),
      c.env.DB.prepare(
        `UPDATE guided_installation SET closed_at=?1 WHERE id=1 AND closed_at IS NULL AND
        EXISTS(SELECT 1 FROM installation_audit WHERE id=?2)`,
      ).bind(now, auditId),
      c.env.DB.prepare(
        "DELETE FROM operator_sessions WHERE kind='setup' AND EXISTS(SELECT 1 FROM installation_audit WHERE id=?1)",
      ).bind(auditId),
    ]);
    if (!result[0].meta.changes)
      throw new HTTPException(409, {
        message: "This installation was already claimed. Sign in as its owner.",
      });
    deleteCookie(c, control.cookie, {
      path: "/",
      secure: c.env.APP_URL.startsWith("https:"),
    });
    return c.json({ ok: true });
  });
  api.put("/setup/providers", async (c) => {
    const actor = await control.actor(c, c.env);
    const data = parseInput(
      providerSchema.extend({ version: z.number().int().min(0) }),
      await readJson(c.req),
    );
    const { version, ...input } = data;
    await control.saveProviders(input, version, actor);
    return c.json({ ok: true });
  });
  api.put("/setup/appearance", async (c) => {
    const actor = await control.actor(c, c.env);
    const data = parseInput(appearanceSchema, await readJson(c.req));
    const result = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE installation SET business_name=?1,primary_color=?2,accent_color=?3,time_zone=?4,currency=?5,version=version+1,updated_at=?6
        WHERE id=1 AND version=?7`,
      ).bind(
        data.businessName,
        data.primaryColor,
        data.accentColor,
        data.timeZone,
        data.currency,
        Date.now(),
        data.version,
      ),
      c.env.DB
        .prepare(`UPDATE sitter_profiles SET business_name=(SELECT business_name FROM installation WHERE id=1),time_zone=(SELECT time_zone FROM installation WHERE id=1)
        WHERE user_id IN (SELECT user_id FROM business_memberships WHERE role='owner' AND revoked_at IS NULL)`),
    ]);
    if (!result[0].meta.changes)
      throw new HTTPException(409, {
        message: "Appearance changed. Reload before saving.",
      });
    await control.audit("appearance-saved", actor.kind).run();
    return c.json({ ok: true });
  });
  api.post("/setup/logo", async (c) => {
    const actor = await control.actor(c, c.env);
    const version = parseInput(
      z.coerce.number().int().positive(),
      c.req.header("x-installation-version"),
    );
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(
        c.req.header("content-type") ?? "",
      )
    )
      throw new HTTPException(415, {
        message: "Choose a PNG, JPEG or WebP image. SVG is not supported.",
      });
    const bytes = Buffer.from(await c.req.arrayBuffer());
    if (!bytes.length || bytes.length > 2 * 1024 * 1024)
      throw new HTTPException(413, { message: "Logo must be at most 2 MB." });
    let encoded: Buffer;
    try {
      const input = sharp(bytes, {
        limitInputPixels: 4_194_304,
        failOn: "warning",
        animated: false,
      });
      const metadata = await input.metadata();
      if (
        !["png", "jpeg", "webp"].includes(metadata.format ?? "") ||
        (metadata.pages ?? 1) !== 1
      )
        throw new Error("Invalid image");
      encoded = await input
        .rotate()
        .resize(512, 512, { fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
    } catch {
      throw new HTTPException(400, {
        message:
          "This image cannot be decoded safely. Use a still image under 4 megapixels.",
      });
    }
    const old = await c.env.DB.prepare(
      "SELECT logo_key FROM installation WHERE id=1",
    ).first<{ logo_key: string | null }>();
    const key = `branding/${crypto.randomUUID()}.png`;
    await c.env.UPLOADS.put(key, encoded);
    const result = await c.env.DB.prepare(
      "UPDATE installation SET logo_key=?1,logo_type='image/png',version=version+1,updated_at=?2 WHERE id=1 AND version=?3",
    )
      .bind(key, Date.now(), version)
      .run();
    if (!result.meta.changes) {
      await c.env.UPLOADS.delete(key);
      throw new HTTPException(409, {
        message: "Appearance changed. Reload before uploading.",
      });
    }
    if (old?.logo_key) await c.env.UPLOADS.delete(old.logo_key);
    await control.audit("logo-updated", actor.kind).run();
    return c.json({ ok: true });
  });
  api.delete("/setup/logo", async (c) => {
    const actor = await control.actor(c, c.env);
    const { version } = parseInput(
      z.object({ version: z.number().int().positive() }).strict(),
      await readJson(c.req),
    );
    const old = await c.env.DB.prepare(
      "SELECT logo_key FROM installation WHERE id=1",
    ).first<{ logo_key: string | null }>();
    const result = await c.env.DB.prepare(
      "UPDATE installation SET logo_key=NULL,logo_type=NULL,version=version+1 WHERE id=1 AND version=?1",
    )
      .bind(version)
      .run();
    if (!result.meta.changes)
      throw new HTTPException(409, {
        message: "Appearance changed. Reload before removing the logo.",
      });
    if (old?.logo_key) await c.env.UPLOADS.delete(old.logo_key);
    await control.audit("logo-removed", actor.kind).run();
    return c.json({ ok: true });
  });
  api.get("/branding/logo", async (c) => {
    const row = await c.env.DB.prepare(
      "SELECT logo_key FROM installation WHERE id=1",
    ).first<{ logo_key: string | null }>();
    const object = row?.logo_key ? await c.env.UPLOADS.get(row.logo_key) : null;
    if (!object) return c.notFound();
    return new Response(object.body, {
      headers: {
        "content-type": "image/png",
        "content-length": String(object.size),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
  api.post("/setup/complete", async (c) => {
    const actor = await control.actor(c, c.env);
    if (actor.kind !== "owner")
      throw new HTTPException(403, {
        message: "The verified owner must finish setup.",
      });
    if (!(await control.storageReady()))
      throw new HTTPException(409, {
        message:
          "Private upload storage is not writable. Fix its directory permissions before finishing setup.",
      });
    if (!emailConfigured(c.env))
      throw new HTTPException(409, {
        message: "Configure email delivery before finishing setup.",
      });
    const progress = await c.env.DB.prepare(
      "SELECT mail_verified_at FROM setup_progress WHERE id=1 AND mail_config_digest=?1",
    )
      .bind(c.env.SETUP_MAIL_FINGERPRINT)
      .first<{ mail_verified_at: number | null }>();
    if (!progress?.mail_verified_at)
      throw new HTTPException(409, {
        message:
          "Verify a new email code after changing email settings, then finish setup.",
      });
    const auditId = crypto.randomUUID();
    const completed = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE installation SET setup_state='ready',version=version+1,updated_at=?1 WHERE id=1
        AND EXISTS(SELECT 1 FROM setup_progress WHERE id=1 AND mail_verified_at IS NOT NULL AND mail_config_digest=?2)
        AND EXISTS(SELECT 1 FROM business_memberships WHERE role='owner' AND revoked_at IS NULL AND user_id=?3)`,
      ).bind(Date.now(), c.env.SETUP_MAIL_FINGERPRINT, actor.id),
      c.env.DB.prepare(
        "INSERT INTO installation_audit SELECT ?1,'setup-completed',?2,?3 WHERE changes()>0",
      ).bind(auditId, actor.id, Date.now()),
      c.env.DB.prepare(
        "DELETE FROM operator_sessions WHERE EXISTS(SELECT 1 FROM installation_audit WHERE id=?1)",
      ).bind(auditId),
    ]);
    if (!completed[0].meta.changes)
      throw new HTTPException(409, {
        message:
          "Setup changed while finishing. Review it and verify email again.",
      });
    return c.json({ ok: true });
  });
  api.get("/owner/session", async (c) => {
    const actor = await control.actor(c, c.env);
    if (actor.kind !== "owner")
      throw new HTTPException(403, {
        message: "Sign in as the verified owner.",
      });
    const owner = (await control.owner())!;
    return c.json({
      user: { name: owner.name, email: owner.email },
      role: "owner",
    });
  });
  api.on(["GET", "POST"], "/auth/*", async (c, next) => {
    const owner = await control.owner();
    const guided = !owner && (await control.guided.available());
    const operator = !owner && (await control.operator(c));
    const path = c.req.path;
    const emailRequest =
      c.req.method === "POST" &&
      (path === "/api/auth/email-otp/send-verification-otp" ||
        path === "/api/auth/sign-in/email-otp");
    const resuming =
      !owner &&
      !guided &&
      !operator &&
      emailRequest &&
      ["resume", "password-email"].includes(await control.setupEntry(c.env));
    if (!owner && !guided && !operator && !resuming)
      return c.json(
        { code: "SETUP_REQUIRED", message: "Unlock installation setup first." },
        503,
      );
    if (path.endsWith("/sign-in/social") || path.endsWith("/callback/google")) {
      if (!owner)
        throw new HTTPException(403, {
          message: "Verify the owner by email before enabling Google.",
        });
    }
    let candidate = "";
    if (
      path.endsWith("/send-verification-otp") ||
      path.endsWith("/sign-in/email-otp")
    ) {
      const body = parseInput(
        z.object({ email: z.string() }),
        await readJson(c.req),
      );
      candidate = body.email.trim().toLowerCase();
      if (!candidate || !(await canAuthenticate(c.env, candidate)))
        throw new HTTPException(403, {
          message: resuming
            ? "Use the email address you saved during setup."
            : "Use the owner's email or an active invited client email. Contact your sitter if you need access.",
        });
    }
    // An old code for previous provider settings must not create resume access.
    if (resuming && path.endsWith("/sign-in/email-otp")) {
      const challenge = await c.env.DB.prepare(
        "SELECT 1 FROM setup_progress WHERE id=1 AND owner_email=?1 AND mail_challenge_digest=?2",
      )
        .bind(c.env.SELF_HOSTED_AUTH_EMAIL, c.env.SETUP_MAIL_FINGERPRINT)
        .first();
      if (!challenge)
        throw new HTTPException(409, {
          message: "Request a new email code to continue setup.",
        });
    }
    const response = await handleAuth(c, next);
    if (
      response instanceof Response &&
      response.ok &&
      path.endsWith("/send-verification-otp") &&
      candidate === c.env.SELF_HOSTED_AUTH_EMAIL
    ) {
      await c.env.DB.prepare(
        "UPDATE setup_progress SET mail_challenge_digest=?1 WHERE id=1 AND owner_email=?2",
      )
        .bind(c.env.SETUP_MAIL_FINGERPRINT, c.env.SELF_HOSTED_AUTH_EMAIL)
        .run();
    }
    if (
      response instanceof Response &&
      response.ok &&
      path.endsWith("/sign-in/email-otp") &&
      candidate === c.env.SELF_HOSTED_AUTH_EMAIL
    ) {
      const verifiedAt = Date.now();
      await c.env.DB.prepare(
        "UPDATE setup_progress SET mail_verified_at=?1,mail_config_digest=?2 WHERE id=1 AND mail_challenge_digest=?2 AND owner_email=?3",
      )
        .bind(
          verifiedAt,
          c.env.SETUP_MAIL_FINGERPRINT,
          c.env.SELF_HOSTED_AUTH_EMAIL,
        )
        .run();
      if (resuming) {
        const current = await control.bindings();
        if (
          current.SETUP_MAIL_FINGERPRINT !== c.env.SETUP_MAIL_FINGERPRINT ||
          !["resume", "password-email"].includes(
            await control.setupEntry(current),
          )
        )
          throw new HTTPException(409, {
            message: "Setup changed. Request a new email code to continue.",
          });
        const value = await control.resumeSetup(
          c.env.SELF_HOSTED_AUTH_EMAIL!,
          c.env.SETUP_MAIL_FINGERPRINT!,
          verifiedAt,
        );
        // Preserve Better Auth's session cookies alongside the setup cookie.
        const headers = new Headers(response.headers);
        headers.append(
          "Set-Cookie",
          serialize(control.cookie, value, {
            path: "/",
            httpOnly: true,
            sameSite: "Strict",
            secure: c.env.APP_URL.startsWith("https:"),
            maxAge: operatorSessionSeconds("setup"),
          }),
        );
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      }
    }
    return response;
  });
  return api;
}
