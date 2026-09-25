import nodemailer from "nodemailer";
import type { MailTransport } from "../contracts";

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  username?: string;
  password?: string;
  allowInsecureLocal?: boolean;
}
export function smtpTransport(options: SmtpOptions): MailTransport {
  if (
    /[^\x21-\x7e]/.test(options.host) ||
    !options.host ||
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65535
  )
    throw new Error("Invalid SMTP configuration");
  const allowPlain =
    options.allowInsecureLocal === true &&
    ["localhost", "127.0.0.1", "::1"].includes(options.host);
  const transport = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    requireTLS: !options.secure && !allowPlain,
    ignoreTLS: allowPlain,
    auth: options.username
      ? { user: options.username, pass: options.password }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
  return {
    idempotent: false,
    async send(message) {
      try {
        const result = await transport.sendMail({
          from: message.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          replyTo: message.reply_to,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        if (
          !result.accepted?.length ||
          result.rejected?.length ||
          !result.messageId
        )
          throw new Error("SMTP not accepted");
        return String(result.messageId);
      } catch {
        throw new Error("SMTP delivery was not confirmed");
      }
    },
  };
}
