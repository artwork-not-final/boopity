import { parseInput } from "../core/http-input";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { SqlDatabase } from "../core/contracts";
import type { Integration, PaymentIntegrations } from "../payments/provider";
import { StripePayments, stripeApiVersion } from "../payments/stripe";
import type { IntegrationView, PaymentMode } from "../../src/shared/payments";

type Secrets = { key: string; webhookSecret: string };
type Row = {
  id: string;
  provider: string;
  mode: PaymentMode;
  ciphertext: string;
  version: number;
  enabled: number;
  account_id: string | null;
  verified_fingerprint: string | null;
  webhook_fingerprint: string | null;
};
const modes = ["test", "live"] as const;
const validSecrets = (mode: PaymentMode, secrets: Secrets) =>
  new RegExp(`^rk_${mode}_[A-Za-z0-9]{16,}$`).test(secrets.key) &&
  /^whsec_[A-Za-z0-9]{16,}$/.test(secrets.webhookSecret);
export class NodePaymentSettings implements PaymentIntegrations {
  private readonly key: Buffer;
  constructor(
    private readonly db: SqlDatabase,
    secret: string,
    private readonly origin: string,
    private readonly environment: NodeJS.ProcessEnv,
  ) {
    this.key = createHash("sha256")
      .update(`boopity:payment-settings:${secret}`)
      .digest();
  }
  private seal(value: Secrets) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from("boopity:payments:v1"));
    const bytes = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      Buffer.from(iv).toString("base64"),
      bytes.toString("base64"),
      Buffer.from(cipher.getAuthTag()).toString("base64"),
    ].join(":");
  }
  private unseal(value: string): Secrets {
    const [version, iv, body, tag] = value.split(":");
    if (version !== "v1") throw new Error("Unknown payment settings version");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(iv, "base64"),
    );
    cipher.setAAD(Buffer.from("boopity:payments:v1"));
    cipher.setAuthTag(Buffer.from(tag, "base64"));
    return z
      .object({ key: z.string(), webhookSecret: z.string() })
      .strict()
      .parse(
        JSON.parse(
          Buffer.concat([
            cipher.update(Buffer.from(body, "base64")),
            cipher.final(),
          ]).toString("utf8"),
        ),
      );
  }
  private async state(mode: PaymentMode) {
    const row = await this.db
      .prepare(
        "SELECT * FROM payment_integrations WHERE provider='stripe' AND mode=?1",
      )
      .bind(mode)
      .first<Row>();
    const key = this.environment[`BOOPITY_STRIPE_${mode.toUpperCase()}_KEY`],
      webhookSecret =
        this.environment[`BOOPITY_STRIPE_${mode.toUpperCase()}_WEBHOOK_SECRET`];
    const managed = key !== undefined || webhookSecret !== undefined;
    const secrets: Secrets = managed
      ? { key: key ?? "", webhookSecret: webhookSecret ?? "" }
      : row
        ? this.unseal(row.ciphertext)
        : { key: "", webhookSecret: "" };
    const fingerprint = createHmac("sha256", this.key)
        .update(JSON.stringify([mode, secrets.key]))
        .digest("hex"),
      hookFingerprint = createHmac("sha256", this.key)
        .update(JSON.stringify([mode, secrets.webhookSecret]))
        .digest("hex");
    return { row, managed, secrets, fingerprint, hookFingerprint };
  }
  async get(mode: PaymentMode): Promise<Integration | null> {
    const s = await this.state(mode);
    if (!s.row) return null;
    return {
      id: s.row.id,
      provider: "stripe",
      mode,
      version: s.row.version,
      enabled: Boolean(s.row.enabled),
      verified: Boolean(
        validSecrets(mode, s.secrets) &&
        s.row.verified_fingerprint === s.fingerprint,
      ),
      webhookVerified: Boolean(
        s.secrets.webhookSecret &&
        s.row.webhook_fingerprint === s.hookFingerprint,
      ),
      accountId: s.row.account_id,
      adapter: new StripePayments(s.secrets.key, s.secrets.webhookSecret),
    };
  }
  async views(): Promise<IntegrationView[]> {
    return Promise.all(
      modes.map(async (mode) => {
        const s = await this.state(mode),
          adapter = await this.get(mode);
        return {
          id: s.row?.id ?? "",
          provider: "stripe",
          mode,
          version: s.row?.version ?? 0,
          enabled: Boolean(s.row?.enabled),
          managed: s.managed,
          keyPresent: Boolean(s.secrets.key),
          webhookSecretPresent: Boolean(s.secrets.webhookSecret),
          verified: adapter?.verified ?? false,
          webhookVerified: adapter?.webhookVerified ?? false,
          accountId: s.row?.account_id ?? null,
          webhookUrl: `${this.origin}/api/payments/webhooks/stripe/${mode}`,
          apiVersion: stripeApiVersion,
          capabilities: { checkout: true, refunds: true, expire: true },
        };
      }),
    );
  }
  async save(mode: PaymentMode, body: unknown, actor: string) {
    const input = parseInput(
        z
          .object({
            version: z.number().int().min(0),
            key: z.string().max(1000).default(""),
            webhookSecret: z.string().max(1000).default(""),
          })
          .strict(),
        body,
      ),
      s = await this.state(mode);
    if (s.managed && (input.key || input.webhookSecret))
      throw new HTTPException(409, {
        message: "These credentials are host-managed.",
      });
    const secrets = {
      key: input.key || s.secrets.key,
      webhookSecret: input.webhookSecret || s.secrets.webhookSecret,
    };
    if (!validSecrets(mode, secrets))
      throw new HTTPException(400, {
        message: `Provide a ${mode}-mode restricted key and webhook signing secret. Secret keys and mixed modes are not accepted.`,
      });
    const id = s.row?.id ?? crypto.randomUUID(),
      ciphertext =
        s.managed && s.row
          ? s.row.ciphertext
          : this.seal(s.managed ? { key: "", webhookSecret: "" } : secrets);
    const result = await this.db.batch([
      s.row
        ? this.db
            .prepare(
              "UPDATE payment_integrations SET ciphertext=?1,version=version+1,enabled=0 WHERE id=?2 AND version=?3",
            )
            .bind(ciphertext, id, input.version)
        : this.db
            .prepare(
              "INSERT INTO payment_integrations(id,provider,mode,ciphertext) SELECT ?1,'stripe',?2,?3 WHERE ?4=0 AND NOT EXISTS(SELECT 1 FROM payment_integrations WHERE provider='stripe' AND mode=?2)",
            )
            .bind(id, mode, ciphertext, input.version),
      this.db
        .prepare(
          "INSERT INTO payment_audit SELECT ?1,NULL,NULL,'integration-settings-saved',?2,?3 WHERE changes()>0",
        )
        .bind(crypto.randomUUID(), actor, Date.now()),
    ]);
    if (!result[0].meta.changes)
      throw new HTTPException(409, {
        message: "Integration changed. Refresh before saving.",
      });
  }
  async verify(mode: PaymentMode, actor: string) {
    const s = await this.state(mode);
    if (!s.row)
      throw new HTTPException(409, { message: "Save credentials first." });
    if (!validSecrets(mode, s.secrets))
      throw new HTTPException(400, {
        message:
          "Supply a complete, mode-matched restricted key and signing secret before verification.",
      });
    const account = await new StripePayments(
      s.secrets.key,
      s.secrets.webhookSecret,
    ).verify();
    if (
      account.mode !== mode ||
      (s.row.account_id && s.row.account_id !== account.accountId)
    )
      throw new HTTPException(409, {
        message:
          "The mode or account differs. Existing payment history cannot be moved to another Stripe account.",
      });
    const result = await this.db.batch([
      this.db
        .prepare(
          "UPDATE payment_integrations SET account_id=?1,verified_fingerprint=?2 WHERE id=?3 AND version=?4",
        )
        .bind(account.accountId, s.fingerprint, s.row.id, s.row.version),
      this.db
        .prepare(
          "INSERT INTO payment_audit SELECT ?1,NULL,NULL,'integration-verified',?2,?3 WHERE changes()>0",
        )
        .bind(crypto.randomUUID(), actor, Date.now()),
    ]);
    if (!result[0].meta.changes)
      throw new HTTPException(409, {
        message: "Settings changed during verification.",
      });
  }
  async webhookSeen(mode: PaymentMode, version: number) {
    const s = await this.state(mode);
    if (s.row?.version === version)
      await this.db
        .prepare(
          "UPDATE payment_integrations SET webhook_fingerprint=?1,webhook_seen_at=?2 WHERE id=?3 AND version=?4",
        )
        .bind(s.hookFingerprint, Date.now(), s.row.id, version)
        .run();
  }
  async enable(
    mode: PaymentMode,
    enabled: boolean,
    version: number,
    actor: string,
  ) {
    const integration = await this.get(mode);
    if (
      !integration ||
      (enabled && (!integration.verified || !integration.webhookVerified))
    )
      throw new HTTPException(409, {
        message:
          "Verify this account and receive a signed webhook before enabling checkout.",
      });
    const result = await this.db.batch([
      this.db
        .prepare(
          "UPDATE payment_integrations SET enabled=?1,version=version+1 WHERE id=?2 AND version=?3",
        )
        .bind(enabled, integration.id, version),
      this.db
        .prepare(
          "INSERT INTO payment_audit SELECT ?1,NULL,NULL,?2,?3,?4 WHERE changes()>0",
        )
        .bind(
          crypto.randomUUID(),
          enabled ? "checkout-enabled" : "checkout-disabled",
          actor,
          Date.now(),
        ),
    ]);
    if (!result[0].meta.changes)
      throw new HTTPException(409, {
        message: "Integration changed. Refresh before enabling.",
      });
  }
}
