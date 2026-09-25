import {
  createHash,
  randomBytes,
  scrypt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { Buffer } from "node:buffer";
import type { DatabaseSync } from "node:sqlite";
import { HTTPException } from "hono/http-exception";
import type { SqlDatabase } from "../contracts";
import { databaseLimiter } from "../limiter";
import { setupPasswordSchema } from "../../src/shared/setup";

// OWASP's lower-memory scrypt option fits small hosts. Only one asynchronous
// password calculation per runtime may be in flight; requests are also limited
// per installation in SQLite, not only by caller-supplied IP addresses.
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const noOwner =
  "NOT EXISTS(SELECT 1 FROM business_memberships WHERE role='owner' AND revoked_at IS NULL)";
const encode = (salt: string, hash: Buffer) =>
  `scrypt-v1:${salt}:${Buffer.from(hash).toString("hex")}`;
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
const hashParts = (hash?: string | null) =>
  hash?.match(/^scrypt-v1:([a-f0-9]{32}):([a-f0-9]{64})$/);
type PasswordRecord = {
  password_hash: string | null;
  host_hash: string | null;
  version: number;
  closed_at: number | null;
};

export class SetupPassword {
  private working = false;
  private readonly limiter;
  constructor(
    private readonly db: SqlDatabase,
    key: string,
  ) {
    this.limiter = databaseLimiter(db, key, "setup-password", 5, 5 * 60_000);
  }
  async enabled() {
    return Boolean(
      await this.db
        .prepare(
          `SELECT 1 FROM setup_password WHERE id=1 AND password_hash IS NOT NULL AND closed_at IS NULL AND ${noOwner}`,
        )
        .first(),
    );
  }
  /** Trusted host configuration only. Reapplying an unchanged host setting must
   * not undo a newer password chosen in the wizard or reopen a claimed install. */
  bootstrap(connection: DatabaseSync, supplied?: string) {
    if (!supplied) return;
    const previous = connection
      .prepare("SELECT * FROM setup_password WHERE id=1")
      .get() as PasswordRecord;
    if (
      previous.closed_at !== null ||
      connection.prepare(`SELECT 1 WHERE NOT (${noOwner})`).get()
    )
      return;
    if (!setupPasswordSchema.safeParse(supplied).success)
      throw new Error("The setup password must contain 15 to 128 characters.");
    const oldHost = hashParts(previous.host_hash);
    if (
      oldHost &&
      timingSafeEqual(
        scryptSync(supplied, oldHost[1], 32, options),
        Buffer.from(oldHost[2], "hex"),
      )
    )
      return;
    const salt = Buffer.from(randomBytes(16)).toString("hex");
    const hash = encode(salt, scryptSync(supplied, salt, 32, options));
    connection.exec("BEGIN IMMEDIATE");
    try {
      const changed = connection
        .prepare(
          `UPDATE setup_password SET password_hash=?,host_hash=?,version=version+1
        WHERE id=1 AND version=? AND closed_at IS NULL AND ${noOwner}`,
        )
        .run(hash, hash, previous.version);
      if (changed.changes) {
        connection.exec("DELETE FROM operator_sessions WHERE kind='setup'");
        connection.exec("DELETE FROM operator_tokens WHERE kind='setup'");
        connection
          .prepare("INSERT INTO installation_audit VALUES (?,?,?,?)")
          .run(
            crypto.randomUUID(),
            "setup-password-configured",
            "host",
            Date.now(),
          );
      }
      connection.exec("COMMIT");
    } catch (error) {
      connection.exec("ROLLBACK");
      throw error;
    }
  }
  private async work<T>(run: () => Promise<T>): Promise<T> {
    if (this.working)
      throw new HTTPException(429, {
        message: "Please wait a moment and try again.",
      });
    this.working = true;
    try {
      return await run();
    } finally {
      this.working = false;
    }
  }
  async prepare(password: string) {
    const value = setupPasswordSchema.parse(password);
    return this.work(async () => {
      const record = await this.db
        .prepare("SELECT * FROM setup_password WHERE id=1")
        .first<PasswordRecord>();
      if (!record || record.closed_at !== null)
        throw new HTTPException(403, {
          message:
            "Setup passwords are no longer available. Sign in as the owner.",
        });
      const salt = Buffer.from(randomBytes(16)).toString("hex");
      return {
        hash: encode(salt, await derive(value, salt)),
        version: record.version,
      };
    });
  }
  async unlock(password: string, lifetimeSeconds: number) {
    if (!(await this.limiter.limit({ key: "installation" })).success)
      throw new HTTPException(429, {
        message: "Too many attempts. Try again in five minutes.",
      });
    return this.work(async () => {
      const record = await this.db
        .prepare(
          `SELECT * FROM setup_password WHERE id=1 AND closed_at IS NULL AND ${noOwner}`,
        )
        .first<PasswordRecord>();
      const parts = hashParts(record?.password_hash);
      if (
        !parts ||
        !timingSafeEqual(
          await derive(password, parts[1]),
          Buffer.from(parts[2], "hex"),
        )
      )
        throw new HTTPException(401, {
          message: "That setup password didn’t work. Try again.",
        });
      const raw = Buffer.from(randomBytes(32)).toString("base64url"),
        digest = createHash("sha256").update(raw).digest("hex"),
        now = Date.now();
      const result = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO operator_sessions(digest,kind,expires_at)
          SELECT ?1,'setup',?2 FROM setup_password WHERE id=1 AND version=?3 AND password_hash=?4 AND closed_at IS NULL AND ${noOwner}`,
          )
          .bind(
            digest,
            now + lifetimeSeconds * 1000,
            record!.version,
            record!.password_hash,
          ),
        this.db
          .prepare(
            `INSERT INTO installation_audit SELECT ?1,'setup-password-used','setup',?2
          WHERE EXISTS(SELECT 1 FROM operator_sessions WHERE digest=?3)`,
          )
          .bind(crypto.randomUUID(), now, digest),
      ]);
      if (!result[0].meta.changes)
        throw new HTTPException(409, {
          message: "Setup changed. Please sign in again.",
        });
      return raw;
    });
  }
}
