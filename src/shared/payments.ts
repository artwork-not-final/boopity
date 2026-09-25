import { z } from "zod";
import { pageOffset, type Pagination } from "./pagination";

export const paymentViewQuery = z.object({
  attemptOffset: pageOffset,
  historyOffset: pageOffset,
});
export type RefundView = {
  id: string;
  amountCents: number;
  status: string;
  note?: string;
};
export type RefundPage = { refunds: RefundView[]; pagination: Pagination };

export const paymentMode = z.enum(["test", "live"]);
export type PaymentMode = z.infer<typeof paymentMode>;
export const cents = z.number().int().min(1).max(99_999_999);
export const paymentKey = z.uuid();
export const manualMethods = [
  "cash",
  "check",
  "bank-transfer",
  "venmo",
  "zelle",
  "paypal",
  "cash-app",
  "other",
] as const;
export const manualPaymentSchema = z
  .object({
    requestId: paymentKey,
    amountCents: cents,
    method: z.enum(manualMethods),
    note: z.string().trim().max(1000).default(""),
  })
  .strict();
export const refundSchema = z
  .object({
    requestId: paymentKey,
    amountCents: cents,
    note: z.string().trim().min(1).max(1000),
    confirm: z.literal(true),
  })
  .strict();
export const creditSchema = z
  .object({
    requestId: paymentKey,
    amountCents: cents,
    note: z.string().trim().min(1).max(1000),
    mode: paymentMode,
  })
  .strict();
export type PaymentBalance = {
  mode: PaymentMode;
  currency: string;
  chargeCents: number;
  creditCents: number;
  receivedCents: number;
  refundedCents: number;
  netCents: number;
  outstandingCents: number;
  overpaymentCents: number;
  status: "unpaid" | "partial" | "paid" | "refunded" | "overpaid" | "waived";
};
export type PaymentView = {
  bookingId: string;
  bookingStatus: string;
  activeMode: PaymentMode;
  balances: PaymentBalance[];
  onlineAvailable: boolean;
  pagination: { attempts: Pagination; history: Pagination };
  attempts: {
    id: string;
    provider: string;
    mode: PaymentMode;
    amountCents: number;
    currency: string;
    status: string;
    method: string;
    createdAt: number;
    note?: string;
    refunds: RefundView[];
    refundCount: number;
    refundPagination: Pagination;
  }[];
  history: {
    id: string;
    reversible: boolean;
    kind: string;
    cents: number;
    mode: PaymentMode;
    createdAt: number;
    note?: string;
  }[];
};
export type IntegrationView = {
  id: string;
  provider: string;
  mode: PaymentMode;
  version: number;
  enabled: boolean;
  managed: boolean;
  keyPresent: boolean;
  webhookSecretPresent: boolean;
  verified: boolean;
  webhookVerified: boolean;
  accountId: string | null;
  webhookUrl: string;
  apiVersion: string;
  capabilities: { checkout: boolean; refunds: boolean; expire: boolean };
};
