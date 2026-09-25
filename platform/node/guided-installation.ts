import type { DatabaseSync } from "node:sqlite";
import { ownerSchema } from "../../src/shared/setup";
import { emailCodeConfigured } from "../../worker/auth-policy";
import type { Bindings } from "../../worker/env";

/** Optional deployment adapter. Never derives owner authority from a public form. */
export class GuidedInstallation {
  private readonly email: string | undefined;
  constructor(
    private readonly base: Bindings,
    environment: NodeJS.ProcessEnv,
  ) {
    const supplied = environment.BOOPITY_OWNER_EMAIL;
    if (supplied !== undefined) {
      const parsed = ownerSchema.shape.email.safeParse(supplied.trim());
      if (!parsed.success)
        throw new Error("The installation owner email is invalid.");
      this.email = parsed.data;
    }
  }
  bootstrap(connection: DatabaseSync) {
    if (!this.email) return;
    connection.exec("BEGIN IMMEDIATE");
    try {
      const existing = connection
        .prepare(
          "SELECT owner_email,closed_at FROM guided_installation WHERE id=1",
        )
        .get() as { owner_email: string; closed_at: number | null } | undefined;
      const owner = connection
        .prepare(
          "SELECT 1 FROM business_memberships WHERE role='owner' AND revoked_at IS NULL",
        )
        .get();
      // Keeping/changing the environment after claim can never transfer ownership.
      if (owner || existing?.closed_at != null) {
        if (owner)
          connection
            .prepare(
              "UPDATE guided_installation SET closed_at=COALESCE(closed_at,?) WHERE id=1",
            )
            .run(Date.now());
      } else if (existing) {
        if (existing.owner_email !== this.email)
          throw new Error(
            "The installation owner email is already pinned. Restore the original hosting setting.",
          );
      } else {
        const started = connection
          .prepare(
            `SELECT 1 WHERE
          EXISTS(SELECT 1 FROM setup_progress WHERE owner_email IS NOT NULL)
          OR EXISTS(SELECT 1 FROM user)
          OR EXISTS(SELECT 1 FROM operator_token_history)`,
          )
          .get();
        if (started)
          throw new Error(
            "Browser-based claiming must be enabled before beginning installation setup.",
          );
        connection
          .prepare("INSERT INTO guided_installation VALUES (1,?,?,NULL)")
          .run(this.email, Date.now());
        connection
          .prepare(
            "UPDATE setup_progress SET owner_email=?,owner_name='Business owner' WHERE id=1",
          )
          .run(this.email);
      }
      connection.exec("COMMIT");
    } catch (error) {
      connection.exec("ROLLBACK");
      throw error;
    }
  }
  async state(): Promise<"email" | "waiting" | "token"> {
    const row = await this.base.DB.prepare(
      `SELECT g.owner_email FROM guided_installation g
      JOIN setup_progress p ON p.id=g.id AND p.owner_email=g.owner_email
      WHERE g.id=1 AND g.closed_at IS NULL AND
      NOT EXISTS(SELECT 1 FROM business_memberships WHERE role='owner' AND revoked_at IS NULL)`,
    ).first<{ owner_email: string }>();
    if (!row) return "token";
    // Mail must be configured by the deployment, not by an unauthenticated visitor.
    const allowedRecipient =
      this.base.EMAIL_DELIVERY_MODE !== "restricted" ||
      this.base.EMAIL_TEST_RECIPIENT?.trim().toLowerCase() === row.owner_email;
    return row.owner_email === this.email &&
      allowedRecipient &&
      emailCodeConfigured(this.base)
      ? "email"
      : "waiting";
  }
  async available() {
    return (await this.state()) === "email";
  }
}
