import { useState, useEffect } from "react";
import type { PaymentView, RefundPage } from "../../shared/payments";
import { refundPageResponse } from "../../shared/api-responses";
import { PageControls } from "../Pagination";
import { paymentStatusLabel } from "./payment-format";
import { Button } from "../components/ui/button";
import { workspaceApi as api } from "../workspace-api";
import type { RunWorkspaceAction as Run } from "../workspace-types";
import { money } from "../workspace-format";

export function RefundHistory({
  attempt,
  owner,
  run,
  busy,
}: {
  attempt: PaymentView["attempts"][number];
  owner: boolean;
  run: Run;
  busy: boolean;
}) {
  const [offset, setOffset] = useState(0),
    [retry, setRetry] = useState(0),
    [state, setState] = useState<{
      offset: number;
      data?: RefundPage;
      error?: string;
    } | null>(null);
  useEffect(() => {
    if (offset === 0) return;
    const controller = new AbortController();
    setState(null);
    void api<RefundPage>(
      `/payments/attempts/${attempt.id}/refunds?offset=${offset}`,
      "GET",
      undefined,
      controller.signal,
      refundPageResponse,
    )
      .then((data) => {
        if (!controller.signal.aborted) setState({ offset, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ offset, error: error.message });
      });
    return () => controller.abort();
  }, [attempt.id, offset, retry]);
  const page =
    offset === 0
      ? { refunds: attempt.refunds, pagination: attempt.refundPagination }
      : state?.offset === offset
        ? state.data
        : undefined;
  const error = state?.offset === offset ? state.error : undefined;
  if (!attempt.refundCount) return null;
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Refunds ({attempt.refundCount})</p>
      {(page?.refunds ?? []).map((r) => (
        <div key={r.id} className="space-y-2 text-sm">
          <p>
            Refund: {money(r.amountCents, attempt.currency)} ·{" "}
            {r.status === "succeeded"
              ? "Returned"
              : paymentStatusLabel(r.status)}
          </p>
          {owner && r.note && (
            <p className="whitespace-pre-wrap break-words text-muted-foreground">
              {r.note}
            </p>
          )}
          {owner && r.status === "creating" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    api(`/payments/refunds/${r.id}/retry`, "POST", {
                      confirm: true,
                    }),
                  "The same refund request was retried safely.",
                )
              }
            >
              Retry same refund
            </Button>
          )}
        </div>
      ))}
      {(attempt.refundPagination.hasMore || offset > 0) && (
        <PageControls
          label="refunds"
          offset={offset}
          pagination={page?.pagination}
          loading={busy || (!page && !error)}
          error={error}
          go={setOffset}
          retry={() => setRetry((n) => n + 1)}
        />
      )}
    </div>
  );
}
