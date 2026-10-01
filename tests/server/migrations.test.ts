import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalDatabase } from "../../server/runtime/sqlite";

// Frozen pre-consolidation identities and checksums, independent of the runtime
// mapping. Changing SQL or dropping an alias must fail the upgrade checks.
const history = [
  {
    file: "0000_scheduled_jobs.sql",
    id: "0000_goofy_annihilus.sql",
    digest: "335ac9cf908c775793530691bd185be472eeef720502790d7b248a98e6d2c0b6",
  },
  {
    file: "0001_authentication_profiles_and_uploads.sql",
    id: "0001_lush_silverclaw.sql",
    digest: "81acec9d05d8297cfdd3e25d7219a6d740d8b52567b7453e583592b8d6e6f577",
  },
  {
    file: "0002_rate_limit_keys.sql",
    id: "0002_hard_ben_urich.sql",
    digest: "ac3c3685de8fa3bbbb2f50428f41538efd9724e568c9e38cb14be67ef41c026c",
  },
  {
    file: "0003_clients_and_pets.sql",
    id: "0003_robust_doctor_spectrum.sql",
    digest: "54a12f35c05a36b024c274260ff0fba5efec40484f1861a671d5096c71e7dcea",
  },
  {
    file: "0004_bookings_and_services.sql",
    id: "0004_amused_chimera.sql",
    digest: "2eee097dc218dfd77d9f0282a0ef0b02f119ad4ea9bc8e36c1aba53fd3d1c5f2",
  },
  {
    file: "0005_legacy_billing_and_payments.sql",
    id: "0005_boring_hitman.sql",
    digest: "e7e12d896fce249ddfed9993652799523f99977d58e33bc88de169a1e0afb9e8",
  },
  {
    file: "0006_notifications_and_documents.sql",
    id: "0006_medical_arclight.sql",
    digest: "17fe396e554bef467013c2f83ca1bb3076b2d3bf6be9f0fc395d3df9ff468c96",
  },
  {
    file: "0007_session_and_job_cleanup_indexes.sql",
    id: "0007_condemned_maggott.sql",
    digest: "6dd44bd4f77c77599a5018544e6cc888afece86aa80456d30219fed6407e069a",
  },
  {
    file: "0008_installation_and_memberships.sql",
    id: "0001_installation.sql",
    digest: "352f51e1c10946dc937a1fa0d28af2d09b3e5eeb3f422e2885e1cb57bd94d263",
  },
  {
    file: "0009_setup_and_recovery.sql",
    id: "0002_setup.sql",
    digest: "02df426c10f301c91821cc962b031d7830bb924d396b9c844abd52b39f9985bf",
  },
  {
    file: "0010_operator_token_history.sql",
    id: "0003_operator_token_history.sql",
    digest: "f57e2d037ddc3414ea3631802da403b5b699e6d738d6d3b7f69cd6572eb9e38e",
  },
  {
    file: "0011_client_portal_and_booking_rules.sql",
    id: "0004_client_portal.sql",
    digest: "be48646bf0e7d02fce8de89a6eccc0c940d80ac8bdbb9b2235d9d35950823d07",
  },
  {
    file: "0012_payment_integrations_and_ledger.sql",
    id: "0005_payments.sql",
    digest: "167675f2a5de1a3c173a8c5b30dbbdbb6e4d70db13b181edcafa799ecb21ac79",
  },
  {
    file: "0013_list_indexes.sql",
    id: "0006_list_indexes.sql",
    digest: "504983ad7643612098757b036fd098291cb79bf33714ccfc1a7995466d716df8",
  },
  {
    file: "0014_guided_installation.sql",
    id: "0007_guided_installation.sql",
    digest: "aa979f00f5d25445c2cce0c5a7949508ec9f7c753663a0997c097272fc18406f",
  },
  {
    file: "0015_setup_password.sql",
    id: "0008_setup_password.sql",
    digest: "07bd1233d3c6970d197471d63bd10ca1959351af27f0d937ab26aebde3f42b4e",
  },
];

const migrations = resolve("db/migrations");
const databases: LocalDatabase[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function database() {
  const db = new LocalDatabase(":memory:");
  databases.push(db);
  return db;
}

function ledger(db: LocalDatabase) {
  return db.connection
    .prepare("SELECT name, digest FROM boopity_migrations ORDER BY rowid")
    .all();
}

function seedOldHistory(db: LocalDatabase, count: number) {
  db.connection.exec(
    "CREATE TABLE boopity_migrations (name TEXT PRIMARY KEY, digest TEXT NOT NULL)",
  );
  for (const { file, id, digest } of history.slice(0, count)) {
    db.connection.exec(readFileSync(join(migrations, file), "utf8"));
    db.connection
      .prepare("INSERT INTO boopity_migrations VALUES (?, ?)")
      .run(id, digest);
  }
  db.connection.exec(
    "CREATE TABLE preserved_fixture (value TEXT); INSERT INTO preserved_fixture VALUES ('existing data')",
  );
}

function copyMigrations() {
  const directory = mkdtempSync(join(tmpdir(), "boopity-migrations-test-"));
  directories.push(directory);
  cpSync(migrations, directory, { recursive: true });
  return directory;
}

describe("consolidated migration history", () => {
  it("keeps the original SQL bytes in a single descriptive, ordered sequence", () => {
    const files = readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(files.slice(0, history.length)).toEqual(
      history.map((entry) => entry.file),
    );
    expect(new Set(history.map((entry) => entry.id)).size).toBe(history.length);
    for (const [index, { file, digest }] of history.entries()) {
      expect(file).toMatch(
        new RegExp("^" + String(index).padStart(4, "0") + "_"),
      );
      expect(
        createHash("sha256")
          .update(readFileSync(join(migrations, file)))
          .digest("hex"),
      ).toBe(digest);
    }
  });

  it.each(Array.from({ length: history.length + 1 }, (_, count) => count))(
    "upgrades %i already-applied historical migrations without replaying or rewriting them",
    (count) => {
      const db = database();
      seedOldHistory(db, count);
      const previous = ledger(db);
      db.migrate(migrations);
      const applied = ledger(db);
      expect(applied.slice(0, count)).toEqual(previous);
      expect(applied.slice(0, history.length)).toEqual(
        history.map(({ id, digest }) => ({ name: id, digest })),
      );
      expect(
        db.connection.prepare("SELECT value FROM preserved_fixture").get()
          ?.value,
      ).toBe("existing data");
      expect(db.connection.prepare("PRAGMA foreign_key_check").all()).toEqual(
        [],
      );
      db.migrate(migrations);
      expect(ledger(db)).toEqual(applied);
    },
  );

  it("records the same historical IDs on a fresh installation", () => {
    const db = database();
    db.migrate(migrations);
    expect(ledger(db).slice(0, history.length)).toEqual(
      history.map(({ id, digest }) => ({ name: id, digest })),
    );
    expect(
      db.connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('user','clients','bookings','installation','payment_allocations','setup_password')",
        )
        .all(),
    ).toHaveLength(6);
  });

  it("still rejects edited SQL recorded under an old name", () => {
    const db = database();
    seedOldHistory(db, history.length);
    const before = ledger(db);
    const directory = copyMigrations();
    const file = history[0].file;
    writeFileSync(
      join(directory, file),
      readFileSync(join(directory, file), "utf8") + "\n-- changed\n",
    );
    expect(() => db.migrate(directory)).toThrow(
      "Applied migration changed: " + file,
    );
    expect(ledger(db)).toEqual(before);
  });

  it("uses the filename for future migrations and rolls back an unsuccessful batch", () => {
    const db = database();
    seedOldHistory(db, history.length);
    const before = ledger(db);
    const directory = copyMigrations();
    const good = "9998_test_future.sql";
    const bad = "9999_test_failure.sql";
    writeFileSync(
      join(directory, good),
      "CREATE TABLE future_fixture (id TEXT);",
    );
    writeFileSync(join(directory, bad), "NOT VALID SQL");
    expect(() => db.migrate(directory)).toThrow();
    expect(ledger(db)).toEqual(before);
    expect(
      db.connection
        .prepare("SELECT name FROM sqlite_master WHERE name='future_fixture'")
        .get(),
    ).toBeUndefined();
    writeFileSync(
      join(directory, bad),
      "INSERT INTO future_fixture VALUES ('applied once');",
    );
    db.migrate(directory);
    db.migrate(directory);
    expect(
      ledger(db)
        .slice(-2)
        .map((entry) => entry.name),
    ).toEqual([good, bad]);
    expect(db.connection.prepare("SELECT * FROM future_fixture").all()).toEqual(
      [{ id: "applied once" }],
    );
  });
});
