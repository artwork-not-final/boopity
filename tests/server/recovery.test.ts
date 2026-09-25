import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRuntime, loadConfig } from "../../server/runtime/runtime";
import { LocalDatabase } from "../../server/runtime/sqlite";
import { defaultBranding } from "../../src/shared/branding";
import { emptyProviders } from "../../src/shared/setup";
import { readInstallation, saveBranding } from "../../server/core/installation";

const directories: string[] = [];
const closers: (() => void)[] = [];
function directory() {
  const path = mkdtempSync(join(tmpdir(), "boopity-recovery-test-"));
  directories.push(path);
  return path;
}
function runtime(data: string, environment: NodeJS.ProcessEnv = {}) {
  const instance = createRuntime(loadConfig({ DATA_DIR: data }), environment);
  let closed = false;
  const close = () => {
    if (!closed) {
      instance.close();
      closed = true;
    }
  };
  closers.push(close);
  return { ...instance, close };
}
function seedBusiness(db: LocalDatabase) {
  db.connection
    .exec(`INSERT INTO user(id,name,email,email_verified,created_at,updated_at)
    VALUES('owner','Synthetic owner','owner@example.test',1,0,0);
    INSERT INTO business_memberships(user_id,role) VALUES('owner','owner');
    INSERT INTO sitter_profiles(id,user_id,business_name,created_at,updated_at) VALUES('business','owner','Maple care',0,0);
    INSERT INTO clients(id,sitter_id,first_name,last_name,email,created_at,updated_at)
    VALUES('household','business','Synthetic','Household','client@example.test',0,0);
    INSERT INTO bookings(id,sitter_id,client_id,service_name,start_at,end_at,start_date,end_date,total_amount_cents,created_at,updated_at,price_snapshot,policy_snapshot)
    VALUES('booking','business','household','Visit',0,1000,'2026-09-01','2026-09-01',2500,0,0,'{"currency":"USD"}','{"cancelHours":24,"timeZone":"America/New_York"}');
    UPDATE installation SET setup_state='ready';`);
}
afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("offline recovery and upgrades", () => {
  it("restores a complete stopped copy with keys, encrypted settings, branding, uploads, owner and ledger intact", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Recovery must be offline"));
    const original = directory(),
      first = runtime(original);
    seedBusiness(first.db);
    await saveBranding(
      first.db,
      {
        ...defaultBranding,
        businessName: "Maple & Paws",
        primaryColor: "#285c49",
      },
      1,
    );
    await first.env.UPLOADS.put("business/logo", "synthetic-logo-bytes");
    await first.env.UPLOADS.put("private/record", "private synthetic upload");
    first.db.connection.exec(
      "UPDATE installation SET logo_key='business/logo',logo_type='image/png'",
    );
    await first.control.saveProviders(
      {
        ...structuredClone(emptyProviders),
        email: {
          ...emptyProviders.email,
          provider: "resend",
          from: "owner@example.test",
          apiKey: "synthetic-only-not-a-provider-key",
        },
      },
      0,
      { kind: "owner", id: "owner" },
    );
    first.db.connection
      .exec(`INSERT INTO payment_allocations(id,booking_id,mode,kind,cents,currency,source_key,created_at)
      VALUES('receipt','booking','live','receipt',1000,'USD','synthetic-receipt',0);
      INSERT INTO payment_audit VALUES('audit','booking',NULL,'synthetic-receipt','owner',0);`);
    const settings = await first.control.stored();
    const branding = (await readInstallation(first.db)).branding;
    const secret = first.env.BETTER_AUTH_SECRET;
    const keys = ["auth-secret", "settings-key"].map((name) =>
      readFileSync(join(original, name)),
    );
    first.close(); // A live SQLite-file copy is intentionally NOT supported by this test.
    const backup = join(directory(), "backup");
    cpSync(original, backup, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const restored = join(directory(), "restored");
    cpSync(backup, restored, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const second = runtime(restored);
    expect(second.env.BETTER_AUTH_SECRET).toBe(secret);
    expect((await second.control.owner())?.id).toBe("owner");
    expect((await readInstallation(second.db)).branding).toEqual(branding);
    expect(await second.control.stored()).toEqual(settings);
    for (const [index, name] of ["auth-secret", "settings-key"].entries()) {
      expect(readFileSync(join(restored, name))).toEqual(keys[index]);
      expect(statSync(join(restored, name)).mode & 0o777).toBe(0o600);
    }
    for (const [key, content] of [
      ["business/logo", "synthetic-logo-bytes"],
      ["private/record", "private synthetic upload"],
    ]) {
      expect(
        await new Response((await second.env.UPLOADS.get(key))!.body).text(),
      ).toBe(content);
    }
    expect(await second.db.prepare("PRAGMA quick_check").raw()).toEqual([
      ["ok"],
    ]);
    expect(await second.db.prepare("PRAGMA foreign_key_check").raw()).toEqual(
      [],
    );
    expect(
      await second.db
        .prepare("SELECT SUM(cents) AS cents FROM payment_allocations")
        .first(),
    ).toEqual({ cents: 1000 });
    expect(() =>
      second.db.connection.exec("UPDATE payment_allocations SET cents=2000"),
    ).toThrow("immutable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("applies the payment migration to a pre-payment installation without losing prior records or keys", async () => {
    const data = directory(),
      migrations = directory();
    mkdirSync(join(data, "uploads"), { mode: 0o700 });
    for (const key of ["auth-secret", "settings-key"])
      writeFileSync(join(data, key), randomBytes(48).toString("base64url"), {
        mode: 0o600,
      });
    const oldDb = new LocalDatabase(join(data, "boopity.sqlite"));
    try {
      oldDb.migrate(resolve("drizzle"));
      for (const file of readdirSync("db/self-hosted").filter((file) =>
        /^000[1-4]_.*\.sql$/.test(file),
      )) {
        cpSync(join("db/self-hosted", file), join(migrations, file));
      }
      oldDb.migrate(migrations);
      seedBusiness(oldDb);
      oldDb.connection.exec(
        "UPDATE installation SET business_name='Preserved care',primary_color='#285c49'",
      );
      expect(
        await oldDb
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='payment_settings'",
          )
          .first(),
      ).toBeNull();
    } finally {
      oldDb.close();
    }
    const originalKey = readFileSync(join(data, "auth-secret"), "utf8");
    const upgraded = runtime(data);
    expect((await upgraded.control.owner())?.id).toBe("owner");
    expect((await readInstallation(upgraded.db)).branding.businessName).toBe(
      "Preserved care",
    );
    expect(upgraded.env.BETTER_AUTH_SECRET).toBe(originalKey);
    expect(
      await upgraded.db
        .prepare(
          "SELECT total_amount_cents AS cents FROM bookings WHERE id='booking'",
        )
        .first(),
    ).toEqual({ cents: 2500 });
    expect(
      await upgraded.db.prepare("SELECT mode FROM payment_settings").first(),
    ).toEqual({ mode: "test" });
    expect(await upgraded.db.prepare("PRAGMA foreign_key_check").raw()).toEqual(
      [],
    );
    const count = await upgraded.db
      .prepare("SELECT COUNT(*) AS n FROM boopity_migrations")
      .first();
    upgraded.close();
    expect(
      await runtime(data)
        .db.prepare("SELECT COUNT(*) AS n FROM boopity_migrations")
        .first(),
    ).toEqual(count);
  });

  it.each(["auth-secret", "settings-key"])(
    "refuses an incomplete restore missing %s without replacing keys or changing the database",
    (key) => {
      const data = directory(),
        first = runtime(data);
      first.close();
      unlinkSync(join(data, key));
      const before = readFileSync(join(data, "boopity.sqlite"));
      expect(() => runtime(data)).toThrow("missing private keys");
      expect(existsSync(join(data, key))).toBe(false);
      expect(readFileSync(join(data, "boopity.sqlite"))).toEqual(before);
    },
  );

  it("supports a restored installation whose original authentication secret is host-managed", () => {
    const data = directory(),
      environment = {
        BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
      };
    runtime(data, environment).close();
    expect(existsSync(join(data, "auth-secret"))).toBe(false);
    expect(() => runtime(data)).toThrow("missing private keys");
    expect(runtime(data, environment).env.BETTER_AUTH_SECRET).toBe(
      environment.BETTER_AUTH_SECRET,
    );
  });
});
