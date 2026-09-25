import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paymentMethodLabel } from "../src/client/payment-method-label";
import { manualMethods, manualPaymentSchema } from "../src/shared/payments";

const methods = [
  ["cash", "Cash"],
  ["check", "Check"],
  ["bank-transfer", "Bank transfer"],
  ["venmo", "Venmo"],
  ["zelle", "Zelle"],
  ["paypal", "PayPal"],
  ["cash-app", "Cash App"],
  ["other", "Other"],
] as const;

describe("manual payment method labels", () => {
  it.each(methods)(
    "displays %s as %s without changing its saved value",
    (value, label) => {
      expect(paymentMethodLabel(value)).toBe(label);
      const input = {
        requestId: "6dfac6e5-24a5-4fdb-a111-80b0e145b5c9",
        amountCents: 1000,
        method: value,
      };
      expect(manualPaymentSchema.parse(input).method).toBe(value);
      expect(
        manualPaymentSchema.safeParse({ ...input, method: label }).success,
      ).toBe(false);
    },
  );

  it("covers every available manual method", () => {
    expect(methods.map(([value]) => value)).toEqual(manualMethods);
  });

  it("preserves other providers' method names and unrecognized values", () => {
    for (const method of [
      "card",
      "future-method",
      "constructor",
      "__proto__",
      "",
    ])
      expect(paymentMethodLabel(method)).toBe(method);
  });

  it("names online checkout records without changing their saved method", () => {
    expect(paymentMethodLabel("online")).toBe("Online payment");
  });

  it("uses readable labels in the dropdown and payment records, with explicit raw option values", () => {
    const source = ["BookingPayments", "PaymentAttempt"]
      .map((file) =>
        readFileSync(
          new URL(`../src/client/payments/${file}.tsx`, import.meta.url),
          "utf8",
        ),
      )
      .join("\n")
      .replace(/\s+/g, " ");
    expect(source).toContain(
      "options={manualMethods.map((value) => ({ value, label: paymentMethodLabel(value), }))}",
    );
    expect(source).toContain("{paymentMethodLabel(a.method)}");
    expect(source).not.toContain("{a.method}");
  });
});
