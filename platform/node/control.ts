import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { Buffer } from "node:buffer";
import { HTTPException } from "hono/http-exception";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import type { DatabaseSync } from "node:sqlite";
import { createAuth } from "../../worker/auth";
import type { Bindings } from "../../worker/env";
import {
  emptyProviders,
  providerSchema,
  type ProviderConfig,
} from "../../src/shared/setup";
import { smtpTransport } from "./mail";
import { NodePaymentSettings } from "./payment-settings";
import { GuidedInstallation } from "./guided-installation";
import { emailCodeConfigured } from "../../worker/auth-policy";
import { SetupPassword } from "./setup-password";

export const operatorSessionSeconds = (kind: "setup" | "recovery") =>
  kind === "setup" ? 7 * 24 * 3600 : 8 * 3600;

export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const token = () => Buffer.from(randomBytes(32)).toString("base64url");
export type Owner = {
  id: string;
  name: string;
  email: string;
  emailVerified: number;
};
export type Actor = { kind: "owner" | "setup" | "recovery"; id: string };
export class NodeControl {
  readonly guided: GuidedInstallation;
  readonly payments: NodePaymentSettings;
  readonly setupPassword: SetupPassword;
  readonly cookie: string;
  readonly managed: { email: boolean; google: boolean };
  private readonly key: Uint8Array;
  private cached?: {
    ciphertext: string;
    config: ProviderConfig;
    bindings: Partial<Bindings>;
  };
  constructor(
    readonly base: Bindings,
    key: string,
    readonly environment: NodeJS.ProcessEnv,
  ) {
    this.guided = new GuidedInstallation(base, environment);
    this.setupPassword = new SetupPassword(base.DB, key);
    this.key = createHash("sha256").update(key).digest();
    this.payments = new NodePaymentSettings(
      base.DB,
      key,
      base.APP_URL,
      environment,
    );
    this.cookie = base.APP_URL.startsWith("https:")
      ? "__Host-boopity.setup"
      : "boopity.setup";
    this.managed = {
      email: Boolean(
        environment.SMTP_HOST ||
        environment.RESEND_API_KEY ||
        environment.EMAIL_FROM,
      ),
      google: Boolean(
        environment.GOOGLE_CLIENT_ID || environment.GOOGLE_CLIENT_SECRET,
      ),
    };
  }
  owner() {
    return this.base.DB.prepare(
      `SELECT u.id,u.name,u.email,u.email_verified AS emailVerified FROM user u
    JOIN business_memberships m ON m.user_id=u.id WHERE m.role='owner' AND m.revoked_at IS NULL`,
    ).first<Owner>();
  }
  /** Presentation only: hosting credentials alone are not saved setup progress. */
  async setupStarted() {
    return Boolean(
      await this.base.DB.prepare(
        `SELECT 1 FROM installation_audit
        WHERE event IN ('owner-identity-selected','owner-created') LIMIT 1`,
      ).first(),
    );
  }
  /** Only identity saved behind setup access can enable email resumption. */
  async setupEntry(env: Bindings) {
    if (await this.owner()) return "owner" as const;
    const guided = await this.guided.state();
    if (guided === "email") return guided;
    const pending = await this.base.DB.prepare(
      "SELECT owner_email,owner_name FROM setup_progress WHERE id=1",
    ).first<{ owner_email: string | null; owner_name: string | null }>();
    const allowed =
      env.EMAIL_DELIVERY_MODE !== "restricted" ||
      env.EMAIL_TEST_RECIPIENT?.trim().toLowerCase() === pending?.owner_email;
    const canEmail = Boolean(
      pending?.owner_email &&
      pending.owner_name &&
      allowed &&
      emailCodeConfigured(env),
    );
    if (await this.setupPassword.enabled())
      return canEmail ? ("password-email" as const) : ("password" as const);
    if (guided === "waiting") return guided;
    if (!pending?.owner_email || !pending.owner_name) return "token" as const;
    return canEmail ? ("resume" as const) : ("paused" as const);
  }
  /** Called only immediately after successful OTP verification, never from a
   * public resume button or an existing Better Auth session alone. */
  async resumeSetup(email: string, fingerprint: string, verifiedAt: number) {
    const raw = token(),
      hashed = digest(raw);
    const result = await this.base.DB.batch([
      this.base.DB.prepare(
        `INSERT INTO operator_sessions(digest,kind,expires_at)
        SELECT ?1,'setup',?2 FROM setup_progress WHERE id=1 AND owner_email=?3
        AND owner_name IS NOT NULL AND mail_verified_at=?4
        AND mail_config_digest=?5 AND mail_challenge_digest=?5
        AND NOT EXISTS(SELECT 1 FROM business_memberships WHERE role='owner' AND revoked_at IS NULL)`,
      ).bind(
        hashed,
        verifiedAt + operatorSessionSeconds("setup") * 1000,
        email,
        verifiedAt,
        fingerprint,
      ),
      this.base.DB.prepare(
        `INSERT INTO installation_audit SELECT ?1,'setup-resumed-by-email','setup',?2
        WHERE EXISTS(SELECT 1 FROM operator_sessions WHERE digest=?3)`,
      ).bind(crypto.randomUUID(), verifiedAt, hashed),
    ]);
    if (!result[0].meta.changes)
      throw new HTTPException(409, {
        message: "Setup changed. Request a new email code to continue.",
      });
    return raw;
  }
  async storageReady() {
    const key = `readiness/${crypto.randomUUID()}`;
    try {
      await this.base.UPLOADS.put(key, new Uint8Array([0]));
      await this.base.UPLOADS.delete(key);
      return true;
    } catch {
      return false;
    }
  }
  audit(event: string, actor: string) {
    return this.base.DB.prepare(
      "INSERT INTO installation_audit VALUES (?1,?2,?3,?4)",
    ).bind(crypto.randomUUID(), event, actor, Date.now());
  }
  bootstrap(connection: DatabaseSync) {
    this.guided.bootstrap(connection);
    this.setupPassword.bootstrap(
      connection,
      this.environment.BOOPITY_SETUP_PASSWORD,
    );
    for (const [kind, supplied] of [
      ["setup", this.environment.BOOPITY_SETUP_TOKEN],
      ["recovery", this.environment.BOOPITY_RECOVERY_TOKEN],
    ] as const) {
      if (!supplied) continue;
      if (supplied.length < 32 || supplied.length > 256)
        throw new Error(
          "Operator tokens must contain at least 32 random characters",
        );
      connection.exec("BEGIN IMMEDIATE");
      try {
        const owner = connection
          .prepare(
            "SELECT 1 FROM business_memberships WHERE role='owner' AND revoked_at IS NULL",
          )
          .get();
        const seen = connection
          .prepare("SELECT 1 FROM operator_token_history WHERE digest=?")
          .get(digest(supplied));
        if (!seen && (kind === "setup") !== Boolean(owner)) {
          connection
            .prepare("INSERT INTO operator_token_history VALUES (?,?)")
            .run(digest(supplied), Date.now());
          connection
            .prepare(
              `INSERT INTO operator_tokens(kind,digest,expires_at) VALUES (?,?,?) ON CONFLICT(kind)
            DO UPDATE SET digest=excluded.digest,expires_at=excluded.expires_at,consumed_at=NULL,session_digest=NULL`,
            )
            .run(kind, digest(supplied), Date.now() + 30 * 60_000);
          connection.exec("DELETE FROM operator_sessions");
        }
        connection.exec("COMMIT");
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }
    }
  }
  async issueToken(kind: "setup" | "recovery") {
    const owner = await this.owner();
    if ((kind === "setup") === Boolean(owner))
      throw new Error(
        kind === "setup"
          ? "Installation already has an owner"
          : "No owner exists; use setup-token",
      );
    const raw = token();
    await this.base.DB.batch([
      this.base.DB.prepare(
        "INSERT INTO operator_token_history VALUES (?1,?2)",
      ).bind(digest(raw), Date.now()),
      this.base.DB.prepare("DELETE FROM operator_sessions"),
      this.base.DB.prepare(
        `INSERT INTO operator_tokens(kind,digest,expires_at) VALUES (?1,?2,?3)
        ON CONFLICT(kind) DO UPDATE SET digest=excluded.digest,expires_at=excluded.expires_at,consumed_at=NULL,session_digest=NULL`,
      ).bind(kind, digest(raw), Date.now() + 30 * 60_000),
      this.audit(`${kind}-token-issued`, "console"),
    ]);
    return raw;
  }
  /** Called only by the listening server, never by HTTP or management reads. */
  startupAccess(
    connection: DatabaseSync,
  ):
    | { mode: "link"; token: string }
    | { mode: "owner" | "guided" | "resume" | "manual" | "password" } {
    connection.exec("BEGIN IMMEDIATE");
    try {
      let result: ReturnType<NodeControl["startupAccess"]>;
      const owner = connection
        .prepare(
          "SELECT 1 FROM business_memberships WHERE role='owner' AND revoked_at IS NULL",
        )
        .get();
      const active = connection
        .prepare(
          "SELECT 1 FROM operator_sessions WHERE kind='setup' AND expires_at>?",
        )
        .get(Date.now());
      if (owner) result = { mode: "owner" };
      else if (
        connection
          .prepare(
            "SELECT 1 FROM setup_password WHERE id=1 AND password_hash IS NOT NULL AND closed_at IS NULL",
          )
          .get()
      )
        result = { mode: "password" };
      else if (active) result = { mode: "resume" };
      else if (this.environment.BOOPITY_OWNER_EMAIL)
        result = { mode: "guided" };
      else if (
        this.environment.BOOPITY_SETUP_LINK === "manual" ||
        this.environment.BOOPITY_SETUP_TOKEN
      )
        result = { mode: "manual" };
      else {
        const raw = token(),
          now = Date.now();
        connection
          .prepare("INSERT INTO operator_token_history VALUES (?,?)")
          .run(digest(raw), now);
        connection
          .prepare(
            `INSERT INTO operator_tokens(kind,digest,expires_at) VALUES ('setup',?,?)
          ON CONFLICT(kind) DO UPDATE SET digest=excluded.digest,expires_at=excluded.expires_at,consumed_at=NULL,session_digest=NULL`,
          )
          .run(digest(raw), now + 30 * 60_000);
        connection
          .prepare("INSERT INTO installation_audit VALUES (?,?,?,?)")
          .run(crypto.randomUUID(), "setup-link-issued", "startup", now);
        result = { mode: "link", token: raw };
      }
      connection.exec("COMMIT");
      return result;
    } catch (error) {
      connection.exec("ROLLBACK");
      throw error;
    }
  }
  async consume(raw: string, kind: "setup" | "recovery") {
    const session = token(),
      hashed = digest(session),
      now = Date.now();
    const results = await this.base.DB.batch([
      this.base.DB.prepare(
        `UPDATE operator_tokens SET consumed_at=?3,session_digest=?4 WHERE kind=?1 AND digest=?2
        AND consumed_at IS NULL AND expires_at>?3 AND
        (?1='setup' AND NOT EXISTS(SELECT 1 FROM business_memberships WHERE role='owner' AND revoked_at IS NULL)
        OR ?1='recovery' AND EXISTS(SELECT 1 FROM business_memberships WHERE role='owner' AND revoked_at IS NULL))`,
      ).bind(kind, digest(raw), now, hashed),
      this.base.DB.prepare(
        `INSERT INTO operator_sessions SELECT ?1,kind,?2 FROM operator_tokens WHERE session_digest=?1`,
      ).bind(hashed, now + operatorSessionSeconds(kind) * 1000),
    ]);
    if (!results[1].meta.changes)
      throw new HTTPException(401, {
        message:
          "This link or code no longer works. Return to sign-in or ask your installer for help.",
      });
    await this.audit(`${kind}-token-used`, kind).run();
    return session;
  }
  async saveIdentity(
    actor: Actor,
    name: string,
    email: string,
    password?: string,
  ) {
    const prepared =
      password === undefined
        ? null
        : await this.setupPassword.prepare(password);
    const now = Date.now(),
      auditId = crypto.randomUUID();
    const result = await this.base.DB.batch([
      this.base.DB.prepare(
        `UPDATE setup_progress SET owner_email=?1,owner_name=?2,mail_verified_at=NULL,mail_config_digest=NULL,mail_challenge_digest=NULL
        WHERE id=1 AND NOT EXISTS(SELECT 1 FROM business_memberships WHERE role='owner' AND revoked_at IS NULL)
        AND EXISTS(SELECT 1 FROM operator_sessions WHERE digest=?3 AND kind='setup' AND expires_at>?4)
        AND NOT EXISTS(SELECT 1 FROM guided_installation WHERE closed_at IS NULL AND owner_email<>?1)
        AND (?5=0 OR EXISTS(SELECT 1 FROM setup_password WHERE id=1 AND version=?6 AND closed_at IS NULL))`,
      ).bind(
        email,
        name,
        actor.id,
        now,
        Number(Boolean(prepared)),
        prepared?.version ?? 0,
      ),
      this.base.DB.prepare(
        "INSERT INTO installation_audit SELECT ?1,'owner-identity-selected','setup',?2 WHERE changes()>0",
      ).bind(auditId, now),
      this.base.DB.prepare(
        `UPDATE setup_password SET password_hash=?1,version=version+1 WHERE id=1 AND ?1 IS NOT NULL
        AND EXISTS(SELECT 1 FROM installation_audit WHERE id=?2)`,
      ).bind(prepared?.hash ?? null, auditId),
      this.base.DB.prepare(
        `DELETE FROM operator_sessions WHERE kind='setup' AND digest<>?1 AND ?2=1
        AND EXISTS(SELECT 1 FROM installation_audit WHERE id=?3)`,
      ).bind(actor.id, Number(Boolean(prepared)), auditId),
      this.base.DB.prepare(
        `DELETE FROM operator_tokens WHERE kind='setup' AND ?1=1
        AND EXISTS(SELECT 1 FROM installation_audit WHERE id=?2)`,
      ).bind(Number(Boolean(prepared)), auditId),
    ]);
    if (!result[0].meta.changes)
      throw new HTTPException(409, {
        message:
          "Setup access or details changed. Sign in again before saving.",
      });
  }
  async operator(c: Context): Promise<Actor | null> {
    const raw = getCookie(c, this.cookie);
    if (!raw || raw.length > 256) return null;
    const row = await this.base.DB.prepare(
      "SELECT kind FROM operator_sessions WHERE digest=?1 AND expires_at>?2",
    )
      .bind(digest(raw), Date.now())
      .first<{ kind: "setup" | "recovery" }>();
    if (!row || (row.kind === "setup" && (await this.owner()))) return null;
    return { kind: row.kind, id: digest(raw) };
  }
  async actor(c: Context, env: Bindings): Promise<Actor> {
    const session = await createAuth(env).api.getSession({
      headers: c.req.raw.headers,
    });
    const owner = await this.owner();
    if (session?.user.emailVerified && session.user.id === owner?.id)
      return { kind: "owner", id: owner.id };
    const operator = await this.operator(c);
    if (operator) return operator;
    throw new HTTPException(401, {
      message: "Sign in to continue setup.",
    });
  }
  private encrypt(config: ProviderConfig) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from("boopity:installation-settings:v1"));
    const bytes = Buffer.concat([
      cipher.update(JSON.stringify(config), "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      Buffer.from(iv).toString("base64"),
      bytes.toString("base64"),
      Buffer.from(cipher.getAuthTag()).toString("base64"),
    ].join(":");
  }
  private decrypt(ciphertext: string) {
    const [version, iv, bytes, tag] = ciphertext.split(":");
    if (version !== "v1")
      throw new Error("Unsupported encrypted settings version");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(iv, "base64"),
    );
    cipher.setAAD(Buffer.from("boopity:installation-settings:v1"));
    cipher.setAuthTag(Buffer.from(tag, "base64"));
    return providerSchema.parse(
      JSON.parse(
        Buffer.concat([
          cipher.update(Buffer.from(bytes, "base64")),
          cipher.final(),
        ]).toString("utf8"),
      ),
    );
  }
  async stored() {
    const row = await this.base.DB.prepare(
      "SELECT ciphertext,version FROM installation_secrets WHERE id=1",
    ).first<{ ciphertext: string; version: number }>();
    return {
      config: row
        ? this.decrypt(row.ciphertext)
        : structuredClone(emptyProviders),
      version: row?.version ?? 0,
      ciphertext: row?.ciphertext ?? "",
    };
  }
  async publicSettings() {
    const { config, version } = await this.stored();
    const effective = structuredClone(config);
    if (this.managed.email)
      effective.email = {
        ...emptyProviders.email,
        from: this.base.EMAIL_FROM,
        provider: this.base.MAIL_TRANSPORT
          ? "smtp"
          : this.base.RESEND_API_KEY
            ? "resend"
            : "none",
        host: this.environment.SMTP_HOST ?? "",
        port: Number(this.environment.SMTP_PORT ?? 587),
        secure: this.environment.SMTP_SECURE === "true",
        username: this.environment.SMTP_USERNAME ?? "",
        password: this.environment.SMTP_PASSWORD ?? "",
        apiKey: this.base.RESEND_API_KEY ?? "",
      };
    if (this.managed.google)
      effective.google = {
        enabled: Boolean(
          this.base.GOOGLE_CLIENT_ID && this.base.GOOGLE_CLIENT_SECRET,
        ),
        clientId: this.base.GOOGLE_CLIENT_ID ?? "",
        clientSecret: this.base.GOOGLE_CLIENT_SECRET ?? "",
      };
    return {
      ...effective,
      email: {
        ...effective.email,
        password: "",
        apiKey: "",
        hasPassword: Boolean(effective.email.password),
        hasApiKey: Boolean(effective.email.apiKey),
      },
      google: {
        ...effective.google,
        clientSecret: "",
        hasSecret: Boolean(effective.google.clientSecret),
      },
      version,
      managed: this.managed,
    };
  }
  async saveProviders(input: ProviderConfig, version: number, actor: Actor) {
    const previous = await this.stored();
    if (version !== previous.version)
      throw new HTTPException(409, {
        message: "Settings changed. Reload before saving.",
      });
    const config = providerSchema.parse(input);
    if (this.managed.email) config.email = previous.config.email;
    else {
      config.email.password ||= previous.config.email.password;
      config.email.apiKey ||= previous.config.email.apiKey;
      if (
        config.email.provider !== "none" &&
        !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(config.email.from)
      )
        throw new HTTPException(400, {
          message: "Enter a valid sender email address.",
        });
      if (config.email.provider === "smtp") {
        try {
          smtpTransport({
            ...config.email,
            allowInsecureLocal: this.environment.SMTP_INSECURE_LOCAL === "true",
          });
        } catch {
          throw new HTTPException(400, {
            message:
              "Check the SMTP host, port, TLS and username/password settings.",
          });
        }
      }
      if (config.email.provider === "resend" && !config.email.apiKey)
        throw new HTTPException(400, {
          message: "A Resend API key is required.",
        });
    }
    if (this.managed.google) config.google = previous.config.google;
    else {
      config.google.clientSecret ||= previous.config.google.clientSecret;
      if (
        config.google.enabled &&
        (!config.google.clientId.endsWith(".apps.googleusercontent.com") ||
          !config.google.clientSecret)
      )
        throw new HTTPException(400, {
          message:
            "Complete the Google client ID and secret, or leave Google disabled.",
        });
    }
    const ciphertext = this.encrypt(config);
    const emailChanged =
      JSON.stringify(previous.config.email) !== JSON.stringify(config.email);
    const result = await this.base.DB.batch([
      this.base.DB.prepare(
        `INSERT INTO installation_secrets(id,ciphertext,version) SELECT 1,?1,1 WHERE ?2=0 OR EXISTS(SELECT 1 FROM installation_secrets WHERE id=1 AND version=?2)
        ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext,version=installation_secrets.version+1 WHERE installation_secrets.version=?2`,
      ).bind(ciphertext, version),
      this.base.DB.prepare(
        `UPDATE setup_progress SET mail_verified_at=NULL,mail_config_digest=NULL,mail_challenge_digest=NULL
        WHERE id=1 AND ?1=1 AND EXISTS(SELECT 1 FROM installation_secrets WHERE id=1 AND ciphertext=?2)`,
      ).bind(Number(emailChanged), ciphertext),
    ]);
    if (!result[0].meta.changes)
      throw new HTTPException(409, {
        message: "Settings changed. Reload before saving.",
      });
    await this.audit("provider-settings-saved", actor.kind).run();
  }
  async bindings() {
    const { config, ciphertext } = await this.stored();
    if (!this.cached || this.cached.ciphertext !== ciphertext) {
      const bindings: Partial<Bindings> = {};
      if (!this.managed.email && config.email.provider !== "none") {
        bindings.EMAIL_FROM = config.email.from;
        bindings.EMAIL_DELIVERY_MODE = this.base.EMAIL_DELIVERY_MODE ?? "live";
        if (config.email.provider === "smtp") {
          bindings.RESEND_API_KEY = undefined;
          bindings.MAIL_TRANSPORT = smtpTransport({
            ...config.email,
            allowInsecureLocal: this.environment.SMTP_INSECURE_LOCAL === "true",
          });
        } else {
          bindings.MAIL_TRANSPORT = undefined;
          bindings.RESEND_API_KEY = config.email.apiKey;
        }
      }
      if (!this.managed.google) {
        bindings.GOOGLE_CLIENT_ID = config.google.enabled
          ? config.google.clientId
          : undefined;
        bindings.GOOGLE_CLIENT_SECRET = config.google.enabled
          ? config.google.clientSecret
          : undefined;
      }
      this.cached = { ciphertext, config, bindings };
    }
    const owner = await this.owner();
    const pending = await this.base.DB.prepare(
      "SELECT owner_email FROM setup_progress WHERE id=1",
    ).first<{ owner_email: string | null }>();
    const brand = await this.base.DB.prepare(
      "SELECT business_name FROM installation WHERE id=1",
    ).first<{ business_name: string }>();
    const fingerprint = createHmac("sha256", this.key)
      .update(
        JSON.stringify([
          this.managed.email
            ? [
                this.environment.SMTP_HOST,
                this.environment.SMTP_PORT,
                this.environment.SMTP_SECURE,
                this.environment.SMTP_USERNAME,
                this.environment.SMTP_PASSWORD,
                this.base.EMAIL_FROM,
                this.base.RESEND_API_KEY,
              ]
            : config.email,
          this.base.EMAIL_DELIVERY_MODE,
          this.base.EMAIL_TEST_RECIPIENT,
          this.environment.SMTP_INSECURE_LOCAL,
        ]),
      )
      .digest("hex");
    return {
      ...this.base,
      ...this.cached.bindings,
      SELF_HOSTED_AUTH_EMAIL: owner?.email ?? pending?.owner_email ?? "",
      SELF_HOSTED_CLIENT_ACCESS: true,
      BRAND_NAME: brand?.business_name,
      SETUP_MAIL_FINGERPRINT: fingerprint,
    };
  }
}
