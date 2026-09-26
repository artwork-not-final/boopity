import type { PaymentBalance, PaymentMode } from "../../../shared/payments";
import { paymentStatusLabel } from "./payment-format";
import { money } from "../../lib/format/workspace-format";
import { Badge } from "../../components/ui/badge";

export function PaymentBalanceSummary({
  balances,
  activeMode,
  onlineAvailable,
  hasSandboxRecords,
}: {
  balances: PaymentBalance[];
  activeMode: PaymentMode;
  onlineAvailable: boolean;
  hasSandboxRecords: boolean;
}) {
  const showSandbox =
    (activeMode === "test" && onlineAvailable) ||
    hasSandboxRecords ||
    balances.some(
      (b) =>
        b.mode === "test" &&
        (b.receivedCents !== 0 || b.refundedCents !== 0 || b.creditCents !== 0),
    );
  return (
    <div className="space-y-4">
      {balances
        .filter((b) => b.mode === "live" || showSandbox)
        .map((b) => (
          <section
            key={b.mode}
            aria-label={
              b.mode === "live" ? "Actual payments" : "Sandbox payments"
            }
            className="overflow-hidden rounded-xl border bg-card"
          >
            <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  {b.mode === "live" ? "Balance due" : "Sandbox balance due"}
                </h4>
                <p className="text-3xl font-semibold tracking-tight tabular-nums">
                  {money(b.outstandingCents, b.currency)}
                </p>
                <Badge variant="outline" className="text-sm">
                  {paymentStatusLabel(b.status)}
                </Badge>
              </div>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-4 border-t pt-5 text-sm lg:border-t-0 lg:border-l lg:pl-8 lg:pt-0">
                {(
                  [
                    ["Booking charge", b.chargeCents],
                    ["Received", b.receivedCents],
                    ["Credits", b.creditCents],
                    ["Refunded", b.refundedCents],
                  ] as const
                ).map(([label, amount]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="mt-1 break-words text-base font-medium tabular-nums">
                      {money(amount, b.currency)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            {b.overpaymentCents > 0 && (
              <p className="border-t px-5 py-3 text-sm sm:px-6">
                Overpayment to review:{" "}
                <strong>{money(b.overpaymentCents, b.currency)}</strong>
              </p>
            )}
            {b.mode === "test" && (
              <p className="border-t bg-muted/40 px-5 py-3 text-sm text-muted-foreground sm:px-6">
                Sandbox only · no real money. Sandbox payments do not settle
                real balances.
              </p>
            )}
          </section>
        ))}
    </div>
  );
}
