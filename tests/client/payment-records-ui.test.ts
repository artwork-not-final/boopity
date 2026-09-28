import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentActivityList } from "../../src/client/features/payments/PaymentActivityList";
import { PaymentActivityTotals } from "../../src/client/features/payments/PaymentActivityTotals";
import { PaymentRecords } from "../../src/client/features/payments/PaymentRecords";
import { paymentRecordLabel } from "../../src/client/features/payments/payment-format";
import type { PaymentRecord } from "../../src/shared/payment-records";

const record: PaymentRecord = {
  id: "entry:receipt",
  bookingId: "visit-a",
  clientName: "Alice Able",
  serviceName: "Dog visit",
  startDate: "2026-09-15",
  endDate: "2026-09-15",
  kind: "receipt",
  status: "received",
  method: "bank-transfer",
  provider: "manual",
  amountCents: 3000,
  currency: "USD",
  createdAt: Date.parse("2026-09-14T16:00:00Z"),
};
describe("business Payments page", () => {
  it("starts with actual payments and live search, clear filters and a settings destination", () => {
    const html = renderToStaticMarkup(
      createElement(PaymentRecords, {
        revision: 0,
        timeZone: "America/New_York",
        currency: "USD",
      }),
    );
    expect(html).toContain('aria-pressed="true">Actual payments');
    expect(html.match(/data-variant="tab-line"/g)).toHaveLength(2);
    for (const label of [
      "Search by client or service",
      "Payment settings",
      "From",
      "To",
      "Method",
      "Status",
      "Eastern Time (New York)",
      "Bank transfer",
      "Cash App",
    ])
      expect(html).toContain(label);
    expect(html).not.toContain("<details");
    expect(html).not.toContain("Use live mode");
    expect(html).not.toContain("$0.00"); // Loading is not a zero total.
  });
  it("uses compact responsive links directly to booking payments, with readable dates and methods", () => {
    const html = renderToStaticMarkup(
      createElement(PaymentActivityList, {
        records: [record],
        timeZone: "America/New_York",
      }),
    );
    expect(html).toContain('href="/app/bookings/visit-a/payments"');
    for (const label of [
      "Alice Able",
      "Dog visit",
      "Sep 15, 2026",
      "Sep 14, 2026",
      "12:00 PM",
      "Bank transfer",
      "$30.00",
      "Received",
    ])
      expect(html).toContain(label);
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<button");
    expect(html).toContain("sm:grid-cols-");
    expect(html).toContain("hover:bg-brand-soft-hover");
    expect(html).not.toContain("hover:bg-muted");
  });
  it("shows signed refunds and distinguishes voids and refund reversals", () => {
    const html = renderToStaticMarkup(
      createElement(PaymentActivityList, {
        records: [
          { ...record, kind: "refund", status: "refunded", amountCents: -500 },
        ],
        timeZone: "America/New_York",
      }),
    );
    expect(html).toContain("-$5.00");
    expect(html).toContain("Refunded");
    expect(
      paymentRecordLabel({ ...record, kind: "void", status: "corrected" }),
    ).toBe("Payment voided");
    expect(
      paymentRecordLabel({
        ...record,
        kind: "refund-reversal",
        status: "corrected",
      }),
    ).toBe("Refund reversed");
  });
  it("keeps currencies separate and sandbox totals explicit", () => {
    const html = renderToStaticMarkup(
      createElement(PaymentActivityTotals, {
        currency: "USD",
        sandbox: true,
        totals: [
          {
            currency: "USD",
            receivedCents: 3000,
            refundedCents: 500,
            netCents: 2500,
          },
          {
            currency: "EUR",
            receivedCents: 1000,
            refundedCents: 0,
            netCents: 1000,
          },
        ],
      }),
    );
    expect(html).toContain("Sandbox totals for matching activity");
    expect(html.match(/<dl\b/g)).toHaveLength(2);
    expect(html).toContain("$25.00");
    expect(html).toContain("€10.00");
    expect(html).toContain(
      "Unpaid checkouts and booking credits are excluded.",
    );
  });
});
