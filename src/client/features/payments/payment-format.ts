import type { PaymentRecord } from "../../../shared/payment-records";

export const paymentDate = (value: number, timeZone?: string) =>
  new Date(value).toLocaleString(undefined, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });

export function accountingLabel(kind: string, cents: number) {
  if (kind === "credit")
    return cents < 0 ? "Credit reversed" : "Booking credit";
  const labels: Record<string, string> = {
    receipt: "Payment received",
    payment: "Payment received",
    refund: "Refund",
    "refund-reversal": "Refund reversed",
    void: "Payment voided",
    charge: "Booking charge",
  };
  return Object.hasOwn(labels, kind)
    ? labels[kind]
    : kind.replaceAll("-", " ").replace(/^./, (c) => c.toUpperCase());
}

export function paymentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    unpaid: "Unpaid",
    partial: "Partially paid",
    paid: "Paid",
    refunded: "Refunded",
    overpaid: "Overpaid",
    waived: "Waived",
    succeeded: "Received",
    open: "Awaiting payment",
    creating: "Processing",
    pending: "Pending",
    failed: "Failed",
    expired: "Expired",
    voided: "Voided",
  };
  return Object.hasOwn(labels, status)
    ? labels[status]
    : status.replaceAll("-", " ").replace(/^./, (c) => c.toUpperCase());
}

export function minorUnits(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error("Enter an amount with no more than two decimal places.");
  return Math.round(Number(value) * 100);
}

export const statusLabels: Record<PaymentRecord["status"], string> = {
  received: "Received",
  refunded: "Refunded",
  corrected: "Corrections",
  pending: "Awaiting payment",
  failed: "Failed",
  expired: "Expired",
  review: "Needs review",
};

export function paymentRecordLabel(record: PaymentRecord) {
  if (record.kind === "void") return "Payment voided";
  if (record.kind === "refund-reversal") return "Refund reversed";
  return statusLabels[record.status];
}
