import type { Bindings } from "./env";

export async function cleanupExpiredRecords(env: Bindings, now = Date.now()) {
  // Only expired auth state and old diagnostic runs. Never delete accounts, business records,
  // notifications, invoices, or files. Bounded indexed deletes stay within the Free query budget.
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM session WHERE id IN (SELECT id FROM session WHERE expires_at < ?1 LIMIT 100)",
    ).bind(now),
    env.DB.prepare(
      "DELETE FROM verification WHERE id IN (SELECT id FROM verification WHERE expires_at < ?1 LIMIT 100)",
    ).bind(now),
    env.DB.prepare(
      "DELETE FROM rate_limit WHERE id IN (SELECT id FROM rate_limit WHERE last_request < ?1 LIMIT 100)",
    ).bind(now - 86_400_000),
    env.DB.prepare(
      "DELETE FROM cron_runs WHERE id IN (SELECT id FROM cron_runs WHERE created_at < ?1 LIMIT 100)",
    ).bind(now - 30 * 86_400_000),
  ]);
}
