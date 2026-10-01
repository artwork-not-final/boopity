import { randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  constants,
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { join, resolve } from "node:path";
import type { Bindings } from "../core/env";
import { LocalDatabase } from "./sqlite";
import { LocalFiles } from "./files";
import { databaseLimiter } from "../core/limiter";
import { smtpTransport } from "./mail";
import { NodeControl } from "./control";
import { PaymentService } from "../payments/service";
import type { NodeConfig } from "./config";

export { loadConfig, type NodeConfig } from "./config";

function installationSecret(
  directory: string,
  override?: string,
  filename = "auth-secret",
) {
  if (override !== undefined) {
    if (override.length < 32 || /replace|example/i.test(override))
      throw new Error(
        "Authentication secret must be strong and at least 32 characters",
      );
    return override;
  }
  const path = join(directory, filename);
  try {
    const file = openSync(path, "wx", 0o600);
    try {
      writeFileSync(file, Buffer.from(randomBytes(48)).toString("base64url"));
    } finally {
      closeSync(file);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const secret = readFileSync(file, "utf8").trim();
    if (secret.length < 32)
      throw new Error("Stored authentication secret is invalid");
    chmodSync(path, 0o600);
    return secret;
  } finally {
    closeSync(file);
  }
}

export function createRuntime(
  config: NodeConfig,
  environment: NodeJS.ProcessEnv = process.env,
) {
  // An existing database must travel with its original keys. Silently generating
  // replacements during an incomplete restore would strand encrypted settings.
  if (existsSync(join(config.dataDirectory, "boopity.sqlite"))) {
    if (
      !existsSync(join(config.dataDirectory, "settings-key")) ||
      (!environment.BETTER_AUTH_SECRET &&
        !existsSync(join(config.dataDirectory, "auth-secret")))
    ) {
      throw new Error(
        "Existing installation is missing private keys. Restore the complete data directory and original host-managed authentication secret; do not generate replacement keys.",
      );
    }
  }
  mkdirSync(config.dataDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(join(config.dataDirectory, "uploads"), {
    recursive: true,
    mode: 0o700,
  });
  const secret = installationSecret(
    config.dataDirectory,
    environment.BETTER_AUTH_SECRET,
  );
  const settingsKey = installationSecret(
    config.dataDirectory,
    undefined,
    "settings-key",
  );
  const db = new LocalDatabase(join(config.dataDirectory, "boopity.sqlite"));
  try {
    db.migrate(resolve("db/migrations"));
    const env: Bindings = {
      DB: db,
      UPLOADS: new LocalFiles(join(config.dataDirectory, "uploads")),
      SELF_HOSTED: true,
      RUNTIME: "nodejs",
      AUTH_RUNTIME: "worker",
      APP_URL: config.appUrl,
      AUTH_MODE: config.appUrl.startsWith("https:") ? "production" : "spike",
      BETTER_AUTH_SECRET: secret,
      EMAIL_FROM: environment.EMAIL_FROM ?? "",
      EMAIL_DELIVERY_MODE: environment.EMAIL_DELIVERY_MODE,
      EMAIL_TEST_RECIPIENT: environment.EMAIL_TEST_RECIPIENT,
      RESEND_API_KEY: environment.RESEND_API_KEY,
      GOOGLE_CLIENT_ID: environment.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: environment.GOOGLE_CLIENT_SECRET,
      CONTACT_ENABLED: "false",
      NOTIFICATIONS_ENABLED: "false",
      API_RATE_LIMITER: databaseLimiter(db, secret, "api", 120),
      AUTH_RATE_LIMITER: databaseLimiter(db, secret, "auth", 10),
      WRITE_RATE_LIMITER: databaseLimiter(db, secret, "write", 30),
      UPLOAD_RATE_LIMITER: databaseLimiter(db, secret, "upload", 10),
      CONTACT_RATE_LIMITER: databaseLimiter(db, secret, "contact", 3),
    };
    if (environment.SMTP_HOST)
      env.MAIL_TRANSPORT = smtpTransport({
        host: environment.SMTP_HOST,
        port: Number(environment.SMTP_PORT ?? 587),
        secure: environment.SMTP_SECURE === "true",
        username: environment.SMTP_USERNAME,
        password: environment.SMTP_PASSWORD,
        allowInsecureLocal: environment.SMTP_INSECURE_LOCAL === "true",
      });
    const control = new NodeControl(env, settingsKey, { ...environment });
    control.bootstrap(db.connection);
    return {
      db,
      env,
      control,
      payments: new PaymentService(db, secret, control.payments, config.appUrl),
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Only a configured proxy may supply a client address; arbitrary forwarding headers are discarded. */
export function ingressRequest(
  request: Request,
  config: NodeConfig,
  peer: string,
): Request | null {
  const target = new URL(request.url),
    canonical = new URL(config.appUrl);
  if (target.host !== canonical.host) return null;
  const headers = new Headers(request.headers);
  const forwarded = headers.get("x-forwarded-for")?.trim();
  const address =
    config.trustedProxyIps.includes(peer) && forwarded && isIP(forwarded)
      ? forwarded
      : peer;
  for (const header of [
    "cf-connecting-ip",
    "true-client-ip",
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
  ])
    headers.delete(header);
  headers.set("cf-connecting-ip", address);
  target.protocol = canonical.protocol;
  return new Request(target, {
    method: request.method,
    headers,
    body: request.body,
    ...(request.body ? { duplex: "half" } : {}),
    signal: request.signal,
  } as RequestInit);
}
