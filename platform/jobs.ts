import type { SqlDatabase } from "./contracts";

export async function runLeasedJob(
  db: SqlDatabase,
  name: string,
  minimumInterval: number,
  run: () => Promise<void>,
  now = Date.now(),
) {
  const token = crypto.randomUUID();
  const lease = await db
    .prepare(
      `INSERT INTO job_leases (name, token, lease_until) VALUES (?1, ?2, ?3)
    ON CONFLICT(name) DO UPDATE SET token = excluded.token, lease_until = excluded.lease_until
    WHERE job_leases.lease_until <= ?4 AND (job_leases.completed_at IS NULL OR job_leases.completed_at <= ?5)
    RETURNING token`,
    )
    .bind(name, token, now + 300_000, now, now - minimumInterval)
    .first<{ token: string }>();
  if (!lease) return false;
  // A failure propagates and keeps the lease until expiry, avoiding retry storms.
  await run();
  await db
    .prepare(
      "UPDATE job_leases SET completed_at = ?3, lease_until = 0 WHERE name = ?1 AND token = ?2",
    )
    .bind(name, token, Date.now())
    .run();
  return true;
}
