import type { IntegrationView, PaymentMode } from "../../src/shared/payments";

export type CheckoutInput = {
  attemptId: string;
  integrationId: string;
  amountCents: number;
  currency: string;
  name: string;
  returnUrl: string;
  expiresAt: number;
  integrationLabel: string;
};
export type ProviderRefund = {
  id: string;
  localId?: string;
  amountCents: number;
  status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled";
};
export type CheckoutState = {
  id: string;
  paymentRef: string | null;
  url: string | null;
  status: "open" | "processing" | "succeeded" | "failed" | "expired";
  amountCents: number;
  currency: string;
  mode: PaymentMode;
  attemptId: string;
  integrationId: string;
  refunds: ProviderRefund[];
  disputed: boolean;
};
export type ProviderEvent = {
  id: string;
  type: string;
  mode: PaymentMode;
  account?: string;
  checkoutRef?: string;
  paymentRef?: string;
  localAttemptId?: string;
};
export interface PaymentProvider {
  readonly capabilities: {
    checkout: boolean;
    refunds: boolean;
    expire: boolean;
  };
  verify(): Promise<{ accountId: string; mode: PaymentMode }>;
  createCheckout(input: CheckoutInput): Promise<CheckoutState>;
  inspectCheckout(id: string): Promise<CheckoutState>;
  expireCheckout(id: string, key: string): Promise<void>;
  refund(
    paymentRef: string,
    amountCents: number,
    refundId: string,
  ): Promise<void>;
  verifyEvent(raw: string, signature: string): Promise<ProviderEvent>;
  findAttempt(paymentRef: string): Promise<string | null>;
}
export type Integration = {
  id: string;
  provider: string;
  mode: PaymentMode;
  version: number;
  enabled: boolean;
  verified: boolean;
  webhookVerified: boolean;
  accountId: string | null;
  adapter: PaymentProvider;
};
export interface PaymentIntegrations {
  get(mode: PaymentMode): Promise<Integration | null>;
  webhookSeen(mode: PaymentMode, version: number): Promise<void>;
}
export interface PaymentAdmin {
  views(): Promise<IntegrationView[]>;
  save(mode: PaymentMode, body: unknown, actor: string): Promise<void>;
  verify(mode: PaymentMode, actor: string): Promise<void>;
  enable(
    mode: PaymentMode,
    enabled: boolean,
    version: number,
    actor: string,
  ): Promise<void>;
}
