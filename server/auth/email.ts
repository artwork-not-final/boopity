import type { Bindings } from "../core/env";
import { emailConfigured } from "./config";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  reply_to?: string;
};

export type FrozenEmail = EmailMessage & { from: string };
export class EmailDeliveryError extends Error {
  constructor(readonly status: number) {
    super(`Email provider returned HTTP ${status}`);
  }
}

export async function deliverEmail(
  env: Bindings,
  message: FrozenEmail,
  idempotencyKey?: string,
): Promise<string> {
  if (!emailConfigured(env)) throw new Error("Email is not configured");
  if (
    env.EMAIL_DELIVERY_MODE === "restricted" &&
    message.to.trim().toLowerCase() !==
      env.EMAIL_TEST_RECIPIENT!.trim().toLowerCase()
  ) {
    throw new EmailDeliveryError(403);
  }
  if (env.MAIL_TRANSPORT)
    return env.MAIL_TRANSPORT.send(message, idempotencyKey);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    // Only explicit delivery fields are allowed, even for a persisted outbox payload.
    body: JSON.stringify({
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      ...(message.reply_to ? { reply_to: message.reply_to } : {}),
    }),
  });
  if (!response.ok) throw new EmailDeliveryError(response.status);
  const result = (await response.json()) as { id?: string };
  if (!result.id) throw new Error("Email provider did not confirm acceptance");
  return result.id;
}

export async function sendEmail(
  env: Bindings,
  message: EmailMessage,
): Promise<void> {
  if (!env.RESEND_API_KEY && !env.MAIL_TRANSPORT) {
    throw new Error("Account email delivery is unavailable");
  }

  await deliverEmail(env, { from: env.EMAIL_FROM, ...message });
}
