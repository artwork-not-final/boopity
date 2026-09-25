import type { PaymentTotals } from "../../shared/payment-records";
import { money } from "../workspace-format";

export function PaymentActivityTotals({
  totals,
  currency,
  sandbox,
}: {
  totals: PaymentTotals[];
  currency: string;
  sandbox: boolean;
}) {
  const groups = totals.length
    ? totals
    : [{ currency, receivedCents: 0, refundedCents: 0, netCents: 0 }];
  return (
    <section
      aria-label={
        sandbox
          ? "Sandbox totals for matching activity"
          : "Totals for matching activity"
      }
      className="space-y-3"
    >
      <h3 className="text-sm font-medium text-muted-foreground">
        {sandbox ? "Sandbox totals" : "Totals"} for matching activity
      </h3>
      {groups.map((group) => (
        <div key={group.currency} className="rounded-xl border bg-card">
          {groups.length > 1 && (
            <p className="border-b px-4 py-2 text-sm font-medium">
              {group.currency}
            </p>
          )}
          <dl className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {(
              [
                ["Received", group.receivedCents],
                ["Refunded", group.refundedCents],
                ["Net received", group.netCents],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-3 px-4 py-4 sm:block"
              >
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="text-xl font-semibold tabular-nums sm:mt-1">
                  {money(value, group.currency)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Includes corrections. Unpaid checkouts and booking credits are excluded.
      </p>
    </section>
  );
}
