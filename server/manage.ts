import { createRuntime, loadConfig } from "../platform/node/runtime";
import { ownerSchema } from "../src/shared/setup";
import { setupLink } from "../src/shared/setup-link";

const command = process.argv[2];
if (
  ![
    "setup-link",
    "setup-token",
    "recovery-token",
    "set-owner-email",
    "status",
  ].includes(command)
) {
  console.error(
    "Usage: npm run manage -- setup-link | setup-token | recovery-token | set-owner-email ADDRESS | status",
  );
  process.exit(1);
}
const config = loadConfig();
const runtime = createRuntime(config);
try {
  if (
    command === "setup-link" ||
    command === "setup-token" ||
    command === "recovery-token"
  ) {
    const token = await runtime.control.issueToken(
      command === "recovery-token" ? "recovery" : "setup",
    );
    // Explicit replacement revokes earlier setup sessions; startup preserves them.
    console.log(
      command === "setup-link"
        ? "Private setup link (expires in 30 minutes). Open it, then choose Start setup. Treat it like a password; do not share it in chat, screenshots or logs:\n" +
            setupLink(config.appUrl, token)
        : "One-time token (expires in 30 minutes). Paste it only into your installation's setup page; do not share it in chat or logs:\n" +
            token,
    );
  } else if (command === "status") {
    console.log(
      JSON.stringify({
        ownerClaimed: Boolean(await runtime.control.owner()),
        setup: await runtime.db
          .prepare("SELECT setup_state FROM installation WHERE id=1")
          .first(),
      }),
    );
  } else {
    const owner = await runtime.control.owner();
    if (!owner) throw new Error("No owner exists. Use setup-link instead.");
    const { email } = ownerSchema.parse({
      name: owner.name,
      email: process.argv[3],
    });
    const conflict = await runtime.db
      .prepare("SELECT id FROM user WHERE email=?1 AND id<>?2")
      .bind(email, owner.id)
      .first();
    if (conflict)
      throw new Error(
        "That address belongs to another account; automatic merging is not supported.",
      );
    await runtime.db.batch([
      runtime.db
        .prepare(
          "UPDATE user SET email=?1,email_verified=0,updated_at=?2 WHERE id=?3",
        )
        .bind(email, Date.now(), owner.id),
      runtime.db.prepare("DELETE FROM session WHERE user_id=?1").bind(owner.id),
      runtime.db.prepare("DELETE FROM account WHERE user_id=?1").bind(owner.id),
      runtime.db.prepare("DELETE FROM verification"),
      runtime.db.prepare("DELETE FROM operator_sessions"),
      runtime.db.prepare("DELETE FROM operator_tokens"),
      runtime.db
        .prepare(
          "UPDATE setup_progress SET owner_email=?1,mail_verified_at=NULL WHERE id=1",
        )
        .bind(email),
      runtime.db.prepare(
        "UPDATE installation SET setup_state='unconfigured' WHERE id=1",
      ),
      runtime.control.audit(
        "owner-email-recovered-sessions-revoked",
        "console",
      ),
    ]);
    console.log(
      "Owner email updated without changing business ownership. Sessions and Google links were revoked. Verify the new inbox by email code, then finish setup again.",
    );
  }
} catch (error) {
  // Configuration/database errors may include secrets. Do not echo arbitrary exceptions.
  console.error(
    error instanceof Error &&
      /No owner exists|already has an owner|belongs to another account/.test(
        error.message,
      )
      ? error.message
      : "Management command failed. Check the command, database and private-key configuration.",
  );
  process.exitCode = 1;
} finally {
  runtime.close();
}
