import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { QueryResult, SqlDatabase, SqlStatement } from "../contracts";

function value(input: unknown): SQLInputValue {
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "number" ||
    typeof input === "bigint" ||
    ArrayBuffer.isView(input)
  )
    return input as SQLInputValue;
  if (typeof input === "boolean") return Number(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError("Unsupported SQL parameter");
}

export class LocalDatabase implements SqlDatabase {
  readonly connection: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.connection = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.connection.exec(
      "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;",
    );
  }
  prepare(sql: string): SqlStatement {
    return new LocalStatement(this, sql);
  }
  async batch<T = Record<string, unknown>>(
    queries: SqlStatement[],
  ): Promise<QueryResult<T>[]> {
    if (
      queries.some(
        (query) => !(query instanceof LocalStatement) || query.owner !== this,
      )
    )
      throw new Error("Foreign database statement");
    // No await inside the transaction: another request cannot enter this connection mid-batch.
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const results = queries.map((query) =>
        (query as LocalStatement).execute<T>(),
      );
      this.connection.exec("COMMIT");
      return results;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }
  migrate(directory: string) {
    this.connection.exec(
      "CREATE TABLE IF NOT EXISTS boopity_migrations (name TEXT PRIMARY KEY, digest TEXT NOT NULL)",
    );
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      for (const name of readdirSync(directory)
        .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
        .sort()) {
        const sql = readFileSync(join(directory, name), "utf8");
        const digest = createHash("sha256").update(sql).digest("hex");
        const previous = this.connection
          .prepare("SELECT digest FROM boopity_migrations WHERE name = ?")
          .get(name);
        if (previous) {
          if (previous.digest !== digest)
            throw new Error(`Applied migration changed: ${name}`);
          continue;
        }
        this.connection.exec(sql);
        this.connection
          .prepare("INSERT INTO boopity_migrations VALUES (?, ?)")
          .run(name, digest);
      }
      this.connection.exec("COMMIT");
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.connection.close();
  }
}

class LocalStatement implements SqlStatement {
  constructor(
    readonly owner: LocalDatabase,
    readonly sql: string,
    readonly values: unknown[] = [],
  ) {}
  bind(...values: unknown[]): SqlStatement {
    return new LocalStatement(this.owner, this.sql, values);
  }
  execute<T>(arrays = false): QueryResult<T> {
    const statement = this.owner.connection.prepare(this.sql);
    statement.setReturnArrays(arrays);
    const values = this.values.map(value);
    const numbered = /\?\d+/.test(this.sql);
    const results = numbered
      ? statement.all(
          Object.fromEntries(values.map((item, i) => [String(i + 1), item])),
        )
      : statement.all(...values);
    const changed = this.owner.connection
      .prepare("SELECT changes() AS n")
      .get()!;
    return {
      results: results as T[],
      success: true,
      meta: { changes: Number(changed.n) },
    };
  }
  async all<T = Record<string, unknown>>() {
    return this.execute<T>();
  }
  async run<T = Record<string, unknown>>() {
    return this.execute<T>();
  }
  async raw<T = unknown[]>() {
    return this.execute<T>(true).results;
  }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.execute<Record<string, unknown>>().results[0];
    return (row ? (column ? row[column] : row) : null) as T | null;
  }
}
