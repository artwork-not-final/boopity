import { ReceiptText } from "lucide-react";
import type { PaymentView } from "../../../shared/payments";
import type { Pagination } from "../../../shared/pagination";
import { PageControls } from "../../components/navigation/PageControls";
import { compactPage, VISIBLE_PAGE_SIZE } from "../../lib/compact-page";
import { PaymentAttempt } from "./PaymentAttempt";
import type { RunWorkspaceAction as Run } from "../../lib/types/workspace-types";

export function BookingPaymentList({
  attempts,
  pagination,
  offset,
  onPage,
  owner,
  run,
  busy,
  loading,
  timeZone,
}: {
  attempts: PaymentView["attempts"];
  pagination: Pagination;
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
      aria-label="Payment records"
      className="space-y-5 rounded-xl border bg-card p-5 sm:p-6"
    >
      <h4 className="font-semibold">Payment records</h4>
      <div className="divide-y">
        {attempts.slice(0, VISIBLE_PAGE_SIZE).map((a) => (
          <PaymentAttempt
            key={a.id}
            attempt={a}
            owner={owner}
            run={run}
            busy={busy || loading}
            timeZone={timeZone}
          />
        ))}
      </div>
      {!attempts.length && (
        <div className="py-6 text-center text-sm text-muted-foreground">
          <ReceiptText aria-hidden="true" className="mx-auto mb-3 size-6" />
          {offset
            ? "No payment records on this page."
            : "No payments recorded yet."}
        </div>
      )}
      {(compactPage(pagination, attempts.length)?.hasMore || offset > 0) && (
        <PageControls
          label="payment records"
          pagination={compactPage(pagination, attempts.length)}
          offset={offset}
          loading={loading || busy}
          go={onPage}
        />
      )}
    </section>
  );
}
