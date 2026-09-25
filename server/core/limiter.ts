import { authDigest } from "../auth/policy";
import type { RequestLimiter, SqlDatabase } from "./contracts";

export function databaseLimiter(
  db: SqlDatabase,
  secret: string,
  namespace: string,
  maximum: number,
  windowMs = 60_000,
): RequestLimiter {
  return {
    async limit({ key }) {
      const digest = await authDigest(secret, `${namespace}:${key}`),
        now = Date.now();
      const row = await db
        .prepare(
          `INSERT INTO rate_limit (id, key, count, last_request) VALUES (?1, ?1, 1, ?2)
      ON CONFLICT(key) DO UPDATE SET count = CASE WHEN last_request <= ?3 THEN 1 ELSE MIN(count + 1, ?4) END,
      last_request = CASE WHEN last_request <= ?3 THEN excluded.last_request ELSE last_request END RETURNING count`,
        )
        .bind(`limiter:${digest}`, now, now - windowMs, maximum + 1)
        .first<{ count: number }>();
      return { success: Boolean(row && row.count <= maximum) };
    },
  };
}
