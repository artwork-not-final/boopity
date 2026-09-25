/** Application-owned contracts. Cloud/Node adapters supply these; domain code does not import a host SDK. */
export interface QueryResult<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes: number };
}
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<QueryResult<T>>;
  run<T = Record<string, unknown>>(): Promise<QueryResult<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
}
export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  /** All statements execute atomically, in order; rollback the whole batch on failure. */
  batch<T = Record<string, unknown>>(
    statements: SqlStatement[],
  ): Promise<QueryResult<T>[]>;
}
export interface StoredObject {
  size: number;
  body: ReadableStream<Uint8Array>;
  writeHttpMetadata(headers: Headers): void;
}
export interface ObjectStore {
  put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<{ size: number }>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}
export interface RequestLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}
export interface AssetServer {
  fetch(request: Request): Promise<Response>;
}
export interface MailTransport {
  /** SMTP does not provide provider-side deduplication: callers must account for ambiguous sends. */
  readonly idempotent: boolean;
  send(
    message: {
      from: string;
      to: string;
      subject: string;
      html: string;
      reply_to?: string;
    },
    key?: string,
  ): Promise<string>;
}
export interface ScheduledJob {
  cron: string;
  scheduledTime: number;
}
export interface BackgroundContext {
  waitUntil(promise: Promise<unknown>): void;
}
