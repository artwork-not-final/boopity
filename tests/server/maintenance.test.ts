import { expect, it } from "vitest";
import { cleanupExpiredRecords } from "../../server/core/maintenance";
import { testDatabase } from "../support/database";
import type { Bindings } from "../../server/core/env";

it("removes only bounded expired auth state and old diagnostics", async () => {
  const database = testDatabase(),
    now = Date.now();
  try {
    for (let i = 0; i < 105; i++)
      database.sqlite
        .prepare(
          "INSERT INTO verification (id, identifier, value, expires_at) VALUES (?, 'expired', 'test-token', 0)",
        )
        .run(`expired-${i}`);
    database.sqlite
      .prepare(
        "INSERT INTO verification (id, identifier, value, expires_at) VALUES ('valid', 'valid', 'test-token', ?)",
      )
      .run(now + 3600000);
    database.sqlite.exec(
      "INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at) VALUES ('old', 'old', 'user-a', 0, 0, 0)",
    );
    database.sqlite
      .prepare(
        "INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at) VALUES ('current', 'current', 'user-a', ?, 0, 0)",
      )
      .run(now + 3600000);
    database.sqlite.exec(
      "INSERT INTO rate_limit (id, key, count, last_request) VALUES ('old', 'old', 10, 0)",
    );
    database.sqlite
      .prepare(
        "INSERT INTO rate_limit (id, key, count, last_request) VALUES ('current', 'current', 10, ?)",
      )
      .run(now);
    database.sqlite.exec(
      "INSERT INTO cron_runs (id, job, scheduled_at, created_at) VALUES ('old', 'booking-reminders', 0, 0)",
    );
    await cleanupExpiredRecords({ DB: database.db } as Bindings, now);
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM verification")
        .get()?.count,
    ).toBe(6);
    expect(database.sqlite.prepare("SELECT id FROM session").get()?.id).toBe(
      "current",
    );
    expect(database.sqlite.prepare("SELECT id FROM rate_limit").get()?.id).toBe(
      "current",
    );
    expect(
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM cron_runs").get()
        ?.count,
    ).toBe(0);
    expect(
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM user").get()
        ?.count,
    ).toBe(2);
    expect(
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM clients").get()
        ?.count,
    ).toBe(2);
  } finally {
    database.sqlite.close();
  }
});
