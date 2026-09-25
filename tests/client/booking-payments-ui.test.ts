import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentAttempt } from "../../src/client/features/payments/PaymentAttempt";
import { PaymentBalanceSummary } from "../../src/client/features/payments/PaymentBalanceSummary";
import {
  accountingLabel,
  paymentStatusLabel,
} from "../../src/client/features/payments/payment-format";
import type { PaymentBalance, PaymentView } from "../../src/shared/payments";

const balance: PaymentBalance = {
  mode: "live",
  currency: "USD",
  chargeCents: 3000,
  creditCents: 0,
  receivedCents: 1000,
  refundedCents: 0,
  netCents: 1000,
  outstandingCents: 2000,
  overpaymentCents: 0,
  status: "partial",
};
const sandbox: PaymentBalance = {
  ...balance,
  mode: "test",
  receivedCents: 0,
  netCents: 0,
  outstandingCents: 3000,
  status: "unpaid",
};
const summary = (
  changes: Partial<Parameters<typeof PaymentBalanceSummary>[0]> = {},
) =>
  renderToStaticMarkup(
    createElement(PaymentBalanceSummary, {
      balances: [balance, sandbox],
      activeMode: "live",
      hasSandboxRecords: false,
      ...changes,
    }),
  );
const attempt: PaymentView["attempts"][number] = {
  id: "receipt",
  provider: "manual",
  mode: "live",
  amountCents: 1000,
  currency: "USD",
  status: "succeeded",
  method: "cash-app",
  createdAt: Date.UTC(2030, 8, 10, 16),
  note: "PRIVATE\nReceived in person",
  refunds: [],
  refundCount: 0,
  refundPagination: { offset: 0, limit: 50, hasMore: false },
};
const record = (changes: Partial<Parameters<typeof PaymentAttempt>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(PaymentAttempt, {
      attempt,
      owner: true,
      run: async () => {},
      busy: false,
      timeZone: "America/New_York",
      ...changes,
    }),
  );

describe("booking payment summary", () => {
  it("leads with the real balance without an unused sandbox panel", () => {
    const html = summary();
    expect(html).toContain("Balance due");
    expect(html).toContain("$20.00");
    expect(html).toContain("Partially paid");
    for (const label of ["Booking charge", "Received", "Credits", "Refunded"])
      expect(html).toContain(label);
    expect(html).not.toContain("Sandbox");
  });
  it("always separates sandbox balances when checkout is in test mode", () => {
    const html = summary({ activeMode: "test" });
    expect(html.match(/<section\b/g)).toHaveLength(2);
    expect(html).toContain("Sandbox balance due");
    expect(html).toContain("Sandbox payments do not settle real balances.");
    expect(html).toContain("$20.00");
    expect(html).toContain("$30.00");
  });
  it("keeps sandbox history visible after switching to live mode", () => {
    expect(summary({ hasSandboxRecords: true })).toContain(
      "Sandbox balance due",
    );
    expect(
      summary({ balances: [balance, { ...sandbox, receivedCents: 1000 }] }),
    ).toContain("Sandbox balance due");
  });
  it("does not hide overpayments behind a zero balance", () => {
    expect(
      summary({
        balances: [
          {
            ...balance,
            outstandingCents: 0,
            overpaymentCents: 1000,
            status: "overpaid",
          },
        ],
      }),
    ).toContain("Overpayment to review:");
  });
});

describe("booking payment records", () => {
  it("shows readable method/status, amount, time zone and multiline notes", () => {
    const html = record();
    expect(html).toContain("Cash App");
    expect(html).toContain("Received");
    expect(html).toContain("$10.00");
    expect(html).toContain("12:00 PM");
    expect(html).toContain("PRIVATE\nReceived in person");
    expect(html).not.toContain("cash-app");
  });
  it("starts with a compact record and an explicit refund/correction action", () => {
    const html = record();
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Refund or correct record");
    expect(html).toMatch(/<form[^>]*hidden=""/);
    expect(html).not.toContain("<details");
    expect(html).toContain("I already returned this money outside Boopity.");
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Record returned refund<\/button>/,
    );
  });
  it("preserves explicit real-refund consent and distinguishes sandbox refunds", () => {
    const html = record({
      attempt: { ...attempt, provider: "stripe", method: "online" },
    });
    expect(html).toContain(
      "I authorize this real refund to the original payment method.",
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Confirm refund<\/button>/,
    );
    const testHtml = record({
      attempt: {
        ...attempt,
        provider: "stripe",
        method: "online",
        mode: "test",
      },
    });
    expect(testHtml).toContain("I confirm this sandbox refund.");
    expect(testHtml).toContain("Issue a sandbox refund");
    expect(testHtml).not.toContain("Issue a real Stripe refund");
  });
  it("keeps private notes and owner mutations out of client records", () => {
    const html = record({
      owner: false,
      attempt: {
        ...attempt,
        refunds: [
          {
            id: "refund",
            amountCents: 100,
            status: "succeeded",
            note: "SECRET refund note",
          },
        ],
        refundCount: 1,
      },
    });
    expect(html).toContain("Refund: $1.00");
    expect(html).toContain("Returned");
    expect(html).not.toMatch(
      /PRIVATE|SECRET|Refund or correct|<form|Void incorrect/,
    );
  });
  it("does not offer refunds for unpaid records or void a previously refunded payment", () => {
    expect(record({ attempt: { ...attempt, status: "open" } })).not.toContain(
      "Refund or correct",
    );
    expect(record({ attempt: { ...attempt, refundCount: 1 } })).not.toContain(
      "Void incorrect record",
    );
  });
  it("uses readable accounting event names without confusing credit reversals", () => {
    expect(accountingLabel("receipt", 1000)).toBe("Payment received");
    expect(accountingLabel("credit", 1000)).toBe("Booking credit");
    expect(accountingLabel("credit", -1000)).toBe("Credit reversed");
    expect(accountingLabel("refund-reversal", 1000)).toBe("Refund reversed");
    expect(paymentStatusLabel("open")).toBe("Awaiting payment");
  });
});
