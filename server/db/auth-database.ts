import { drizzle } from "drizzle-orm/sqlite-proxy";
import { authSchema } from "./schema";
import type { SqlDatabase } from "../core/contracts";

/** Drizzle's async SQLite adapter works with both local SQLite and the legacy edge adapter. */
export function authDatabase(db: SqlDatabase) {
  return drizzle(
    async (sql, values, method) => {
      const query = db.prepare(sql).bind(...values);
      if (method === "run") {
        await query.run();
        return { rows: [] };
      }
      const rows = await query.raw<unknown[]>();
      // sqlite-proxy deliberately expects a single row (or undefined) for get, arrays for all.
      return { rows: method === "get" ? rows[0] : rows };
    },
    { schema: authSchema },
  );
}
