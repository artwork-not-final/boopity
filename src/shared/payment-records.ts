import { z } from "zod";
import { listQuery, type Pagination } from "./pagination";
import { manualMethods, paymentMode } from "./payments";

export const paymentRecordStatuses = [
  "received",
  "refunded",
  "corrected",
  "pending",
  "failed",
  "expired",
  "review",
] as const;
const date = z.iso
  .date()
  .refine((value) => value >= "1970-01-01" && value <= "9998-12-31");
export const paymentRecordsQuery = listQuery
  .extend({
    mode: paymentMode.default("live"),
    method: z.enum(["all", "online", ...manualMethods]).default("all"),
    status: z.enum(["all", ...paymentRecordStatuses]).default("all"),
    from: date.optional(),
    to: date.optional(),
  })
  .refine((input) => !input.from || !input.to || input.from <= input.to, {
    message: "Choose an end date on or after the start date.",
  });
export type PaymentRecord = {
  id: string;
  bookingId: string;
  clientName: string;
  serviceName: string;
  startDate: string;
  endDate: string;
  kind: "receipt" | "refund" | "refund-reversal" | "void" | "checkout";
  status: (typeof paymentRecordStatuses)[number];
  method: string;
  provider: string;
  amountCents: number;
  currency: string;
  createdAt: number;
};
export type PaymentTotals = {
  currency: string;
  receivedCents: number;
  refundedCents: number;
  netCents: number;
};
export type PaymentRecordsView = {
  records: PaymentRecord[];
  totals: PaymentTotals[];
  pagination: Pagination;
  timeZone: string;
};
