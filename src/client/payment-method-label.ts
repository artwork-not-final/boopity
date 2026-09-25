import type { manualMethods } from "../shared/payments";

const manualMethodLabels: Record<(typeof manualMethods)[number], string> = {
  cash: "Cash",
  check: "Check",
  "bank-transfer": "Bank transfer",
  venmo: "Venmo",
  zelle: "Zelle",
  paypal: "PayPal",
  "cash-app": "Cash App",
  other: "Other",
};

/** Display only: keep the original method for stored records and API requests. */
export function paymentMethodLabel(method: string): string {
  if (method === "online") return "Online payment";
  return Object.hasOwn(manualMethodLabels, method)
    ? manualMethodLabels[method as keyof typeof manualMethodLabels]
    : method;
}
