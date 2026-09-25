import { useState, useId } from "react";
import { ArrowDownLeft } from "lucide-react";
import type { PaymentView } from "../../../shared/payments";
import { minorUnits, paymentDate, paymentStatusLabel } from "./payment-format";
import { Amount, Note } from "./PaymentFields";
import { RefundHistory } from "./RefundHistory";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { workspaceApi as api } from "../../lib/http/workspace-api";
import type { RunWorkspaceAction as Run } from "../../lib/types/workspace-types";
import { money } from "../../lib/format/workspace-format";
import { paymentMethodLabel } from "./payment-method-label";

export function PaymentAttempt({
  attempt: a,
  owner,
  run,
  busy,
  timeZone,
}: {
  attempt: PaymentView["attempts"][number];
  owner: boolean;
  run: Run;
  busy: boolean;
  timeZone?: string;
}) {
  const [amount, setAmount] = useState(""),
    [note, setNote] = useState(""),
    [confirm, setConfirm] = useState(false),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [editing, setEditing] = useState(false);
  const formId = useId();
  return (
    <article
      aria-label={`${paymentMethodLabel(a.method)} payment`}
      className="space-y-4 py-5 first:pt-0 last:pb-0"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ArrowDownLeft
            aria-hidden="true"
            className="mt-1 hidden size-4 shrink-0 text-muted-foreground sm:block"
          />
          <div className="min-w-0">
            <h5 className="break-words text-base font-medium">
              {paymentMethodLabel(a.method)}
              {a.mode === "test" && (
                <Badge variant="outline" className="ml-2">
                  Sandbox
                </Badge>
              )}
            </h5>
            <p className="mt-1 text-sm text-muted-foreground">
              {paymentDate(a.createdAt, timeZone)}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-semibold tabular-nums">
            {money(a.amountCents, a.currency)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {paymentStatusLabel(a.status)}
          </p>
        </div>
      </div>
      {owner && a.note && (
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
          {a.note}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {a.provider !== "manual" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(
                () => api(`/payments/attempts/${a.id}/reconcile`, "POST", {}),
                "Provider state checked.",
              )
            }
          >
            Check payment status
          </Button>
        )}
        {owner && a.provider !== "manual" && a.status === "open" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(
                () => api(`/payments/attempts/${a.id}/expire`, "POST", {}),
                "Checkout expired. No refund was issued.",
              )
            }
          >
            Expire checkout
          </Button>
        )}
      </div>
      <RefundHistory attempt={a} owner={owner} run={run} busy={busy} />
      {owner && a.status === "succeeded" && (
        <div className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={busy}
            aria-expanded={editing}
            aria-controls={formId}
            onClick={() => setEditing((v) => !v)}
          >
            {editing
              ? "Close refund / correction"
              : a.provider === "manual"
                ? "Refund or correct record"
                : "Refund payment"}
          </Button>
          <form
            id={formId}
            hidden={!editing}
            className="space-y-4 rounded-lg border bg-muted/20 p-4 sm:p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                async () => {
                  await api(`/payments/attempts/${a.id}/refund`, "POST", {
                    requestId,
                    amountCents: minorUnits(amount),
                    note,
                    confirm,
                  });
                  setAmount("");
                  setConfirm(false);
                  // Keep the key for uncertain retries, but not the next refund.
                  setRequestId(crypto.randomUUID());
                },
                a.provider === "manual"
                  ? "Refund recorded. No money was transferred by Boopity."
                  : "Refund requested. Check its status; pending is not refunded.",
              );
            }}
          >
            <h4 className="font-medium">
              {a.provider === "manual"
                ? "Record a refund already returned"
                : a.mode === "test"
                  ? "Issue a sandbox refund"
                  : "Issue a real Stripe refund"}
            </h4>
            <Amount label="Refund amount" value={amount} setValue={setAmount} />
            <Note
              label="Private refund / correction reason"
              required
              value={note}
              setValue={setNote}
            />
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
                className="mt-1"
              />
              {a.provider === "manual"
                ? "I already returned this money outside Boopity."
                : a.mode === "test"
                  ? "I confirm this sandbox refund."
                  : "I authorize this real refund to the original payment method."}
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy || !confirm || !amount || !note.trim()}
              >
                {a.provider === "manual"
                  ? "Record returned refund"
                  : "Confirm refund"}
              </Button>
              {a.provider === "manual" && a.refundCount === 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy || !note.trim()}
                  onClick={() =>
                    void run(
                      () =>
                        api(`/payments/attempts/${a.id}/void`, "POST", {
                          note,
                          confirm: true,
                        }),
                      "Incorrect manual record voided. No money moved.",
                    )
                  }
                >
                  Void incorrect record (no money moved)
                </Button>
              )}
            </div>
          </form>
        </div>
      )}
    </article>
  );
}
