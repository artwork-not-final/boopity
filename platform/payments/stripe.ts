import Stripe from "stripe";
import type {
  CheckoutInput,
  CheckoutState,
  PaymentProvider,
  ProviderEvent,
  ProviderRefund,
} from "./provider";

export const stripeApiVersion = "2026-08-26.dahlia";
export class StripePayments implements PaymentProvider {
  readonly capabilities = { checkout: true, refunds: true, expire: true };
  readonly client: Stripe;
  constructor(
    key: string,
    private readonly webhookSecret: string,
  ) {
    this.client = new Stripe(key || "unconfigured", {
      apiVersion: stripeApiVersion,
      httpClient: Stripe.createFetchHttpClient(),
      timeout: 10_000,
      maxNetworkRetries: 0,
    });
  }
  async verify() {
    const [account, balance] = await Promise.all([
      this.client.accounts.retrieve(null),
      this.client.balance.retrieve(),
    ]);
    if (!account.id || !account.charges_enabled)
      throw new Error("Account cannot accept charges");
    return {
      accountId: account.id,
      mode: balance.livemode ? ("live" as const) : ("test" as const),
    };
  }
  async createCheckout(input: CheckoutInput) {
    const metadata = {
      boopity_attempt: input.attemptId,
      boopity_integration: input.integrationId,
    };
    const session = await this.client.checkout.sessions.create(
      {
        mode: "payment",
        ui_mode: "hosted_page",
        integration_identifier: input.integrationLabel,
        adaptive_pricing: { enabled: false },
        success_url: input.returnUrl,
        cancel_url: input.returnUrl,
        expires_at: Math.floor(input.expiresAt / 1000),
        client_reference_id: input.attemptId,
        metadata,
        payment_intent_data: { metadata },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amountCents,
              product_data: { name: input.name },
            },
          },
        ],
        expand: ["payment_intent.latest_charge"],
      },
      { idempotencyKey: `boopity:checkout:${input.attemptId}` },
    );
    return this.present(session);
  }
  async inspectCheckout(id: string) {
    return this.present(
      await this.client.checkout.sessions.retrieve(id, {
        expand: ["payment_intent.latest_charge"],
      }),
    );
  }
  private async present(
    session: Stripe.Checkout.Session,
  ): Promise<CheckoutState> {
    if (
      session.mode !== "payment" ||
      session.amount_total === null ||
      !session.currency
    )
      throw new Error("Unexpected checkout shape");
    const intent =
      session.payment_intent && typeof session.payment_intent !== "string"
        ? session.payment_intent
        : null;
    const charge =
      intent?.latest_charge && typeof intent.latest_charge !== "string"
        ? intent.latest_charge
        : null;
    let status: CheckoutState["status"] =
      session.status === "expired"
        ? "expired"
        : session.status === "complete"
          ? "processing"
          : "open";
    if (session.payment_status === "paid") {
      if (
        !intent ||
        intent.status !== "succeeded" ||
        intent.amount_received !== session.amount_total ||
        intent.currency !== session.currency ||
        intent.livemode !== session.livemode ||
        intent.metadata.boopity_attempt !== session.metadata?.boopity_attempt
      )
        throw new Error("Payment proof mismatch");
      status = "succeeded";
    } else if (
      session.status === "complete" &&
      intent &&
      ["requires_payment_method", "canceled"].includes(intent.status)
    )
      status = "failed";
    const refunds: ProviderRefund[] = [];
    if (intent && status === "succeeded") {
      // Bound the work; fail closed rather than silently truncating an accounting reconciliation.
      for await (const refund of this.client.refunds.list({
        payment_intent: intent.id,
        limit: 100,
      })) {
        if (
          refunds.length >= 1000 ||
          refund.currency !== session.currency ||
          !refund.status ||
          ![
            "pending",
            "requires_action",
            "succeeded",
            "failed",
            "canceled",
          ].includes(refund.status)
        )
          throw new Error("Refund reconciliation requires review");
        refunds.push({
          id: refund.id,
          localId: refund.metadata?.boopity_refund,
          amountCents: refund.amount,
          status: refund.status as ProviderRefund["status"],
        });
      }
    }
    let url: string | null = null;
    if (session.url) {
      const target = new URL(session.url);
      // Custom Stripe domains need an explicit future allowlist; do not trust arbitrary stored redirects.
      if (
        target.protocol !== "https:" ||
        target.hostname !== "checkout.stripe.com" ||
        target.username ||
        target.password
      )
        throw new Error("Unexpected checkout address");
      url = target.href;
    }
    return {
      id: session.id,
      paymentRef:
        intent?.id ??
        (typeof session.payment_intent === "string"
          ? session.payment_intent
          : null),
      url,
      status,
      amountCents: session.amount_total,
      currency: session.currency.toUpperCase(),
      mode: session.livemode ? "live" : "test",
      attemptId: session.metadata?.boopity_attempt ?? "",
      integrationId: session.metadata?.boopity_integration ?? "",
      refunds,
      disputed: Boolean(charge?.disputed),
    };
  }
  async expireCheckout(id: string, key: string) {
    await this.client.checkout.sessions.expire(id, {}, { idempotencyKey: key });
  }
  async refund(paymentRef: string, amountCents: number, refundId: string) {
    await this.client.refunds.create(
      {
        payment_intent: paymentRef,
        amount: amountCents,
        metadata: { boopity_refund: refundId },
      },
      { idempotencyKey: `boopity:refund:${refundId}` },
    );
  }
  async findAttempt(paymentRef: string) {
    return (
      (await this.client.paymentIntents.retrieve(paymentRef)).metadata
        .boopity_attempt ?? null
    );
  }
  async verifyEvent(raw: string, signature: string): Promise<ProviderEvent> {
    const event = await this.client.webhooks.constructEventAsync(
      raw,
      signature,
      this.webhookSecret,
      300,
      Stripe.createSubtleCryptoProvider(),
    );
    const object = event.data.object as unknown as {
      id: string;
      payment_intent?: string | { id: string };
      metadata?: Record<string, string>;
    };
    return {
      id: event.id,
      type: event.type,
      mode: event.livemode ? "live" : "test",
      account: event.account,
      ...(event.type.startsWith("checkout.session.")
        ? {
            checkoutRef: object.id,
            localAttemptId: object.metadata?.boopity_attempt,
          }
        : {}),
      ...((event.type.startsWith("refund.") ||
        event.type.startsWith("charge.")) &&
      object.payment_intent
        ? {
            paymentRef:
              typeof object.payment_intent === "string"
                ? object.payment_intent
                : object.payment_intent.id,
          }
        : {}),
    };
  }
}
