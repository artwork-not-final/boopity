import type { PaymentView } from "../../../shared/payments";
import type { Pagination } from "../../../shared/pagination";
import { PageControls } from "../../components/navigation/PageControls";
import { compactPage, VISIBLE_PAGE_SIZE } from "../../lib/compact-page";
import { accountingLabel, paymentDate } from "./payment-format";
import { ReverseCredit } from "./ReverseCredit";
import { Badge } from "../../components/ui/badge";
import type { RunWorkspaceAction as Run } from "../../lib/types/workspace-types";
import { money } from "../../lib/format/workspace-format";

export function AccountingHistory({
  history,
  pagination,
  currency,
  offset,
  onPage,
  owner,
  run,
  busy,
  loading,
  timeZone,
}: {
  history: PaymentView["history"];
  pagination: Pagination;
  currency: string;
  offset: number;
  onPage: (offset: number) => void;
  owner: boolean;
  run: Run;
  busy: boolean;
  loading: boolean;
  timeZone?: string;
}) {
  return (
    <section
      aria-label="Accounting history"
      className="space-y-5 rounded-xl border bg-card p-5 sm:p-6"
    >
      <h4 className="font-semibold">Accounting history</h4>
      <div className="divide-y">
        {history.slice(0, VISIBLE_PAGE_SIZE).map((h) => (
          <div key={h.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium">
                  {accountingLabel(h.kind, h.cents)}
                  {h.mode === "test" && (
                    <Badge className="ml-2" variant="outline">
                      Sandbox
                    </Badge>
                  )}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {paymentDate(h.createdAt, timeZone)}
                </p>
              </div>
              <p className="shrink-0 font-medium tabular-nums">
                {money(h.cents, currency)}
              </p>
            </div>
            {owner && h.note && (
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                {h.note}
              </p>
            )}
            {h.reversible && <ReverseCredit id={h.id} run={run} busy={busy} />}
          </div>
        ))}
      </div>
      {!history.length && (
        <p className="text-sm text-muted-foreground">
          No accounting entries on this page.
        </p>
      )}
      {(compactPage(pagination, history.length)?.hasMore || offset > 0) && (
        <PageControls
          label="accounting history"
          pagination={compactPage(pagination, history.length)}
          offset={offset}
          loading={loading || busy}
          go={onPage}
        />
      )}
    </section>
  );
}
