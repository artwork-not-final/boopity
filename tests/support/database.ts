import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { Hono } from "hono";
import type { AppEnv, Bindings } from "../../server/core/env";
import type { SqlDatabase } from "../../server/core/contracts";

// Exercise production SQL and real rollback semantics without mocking query results.
export function testDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  // These legacy-router tests intentionally use the original base schema only.
  const directory = new URL("../../db/migrations/", import.meta.url);
  for (const file of readdirSync(directory)
    .filter((file) => /^000[0-7]_.*\.sql$/.test(file))
    .sort())
    sqlite.exec(readFileSync(new URL(file, directory), "utf8"));
  let queryCount = 0;
  class Statement {
    values: SQLInputValue[] = [];
    constructor(readonly sql: string) {}
    bind(...values: SQLInputValue[]) {
      this.values = values;
      return this;
    }
    execute(asArrays = false) {
      queryCount++;
      const statement = sqlite.prepare(this.sql);
      statement.setReturnArrays(asArrays);
      const bindings = Object.fromEntries(
        this.values.map((value, i) => [String(i + 1), value]),
      );
      const results = /\?\d+/.test(this.sql)
        ? statement.all(bindings)
        : statement.all(...this.values);
      const { changes } = sqlite.prepare("SELECT changes() AS changes").get()!;
      return { results, success: true, meta: { changes: Number(changes) } };
    }
    async all() {
      return this.execute();
    }
    async raw() {
      return this.execute(true).results;
    }
    async run() {
      return this.execute();
    }
    async first(column?: string) {
      const row = this.execute().results[0] ?? null;
      return column && row ? row[column] : row;
    }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as SqlDatabase;
  for (const suffix of ["a", "b"]) {
    sqlite
      .prepare(
        "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, 0, 0)",
      )
      .run(`user-${suffix}`, `Sitter ${suffix}`, `${suffix}@example.test`);
    sqlite
      .prepare(
        "INSERT INTO sitter_profiles (id, user_id, business_name, created_at, updated_at) VALUES (?, ?, ?, 0, 0)",
      )
      .run(`sitter-${suffix}`, `user-${suffix}`, `Business ${suffix}`);
    sqlite
      .prepare(
        "INSERT INTO clients (id, sitter_id, first_name, last_name, created_at, updated_at) VALUES (?, ?, 'Jordan', 'Lee', 0, 0)",
      )
      .run(`client-${suffix}`, `sitter-${suffix}`);
    sqlite
      .prepare(
        `INSERT INTO bookings (id, sitter_id, client_id, service_name, start_at, end_at, start_date, end_date, total_amount_cents, created_at, updated_at)
      VALUES (?, ?, ?, 'Dog walk', 0, 1, '2026-09-10', '2026-09-10', 2700, 0, 0)`,
      )
      .run(`booking-${suffix}`, `sitter-${suffix}`, `client-${suffix}`);
  }
  return {
    db,
    sqlite,
    getQueryCount: () => queryCount,
    resetQueryCount: () => {
      queryCount = 0;
    },
  };
}

export function testApp(route: Hono<AppEnv>, prefix: string) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    const suffix = c.req.header("x-test-sitter") ?? "a";
    c.set("sitterId", `sitter-${suffix}`);
    c.set("userId", `user-${suffix}`);
    await next();
  });
  app.route(prefix, route);
  return async (
    path: string,
    env: Bindings,
    method = "GET",
    body?: unknown,
    sitter = "a",
  ) =>
    app.request(
      `${prefix}${path}`,
      {
        method,
        headers: {
          "content-type": "application/json",
          "x-test-sitter": sitter,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
    );
}
