import { useState, useEffect, useEffectEvent } from "react";
import { RefreshCw } from "lucide-react";
import { Choice } from "../Choice";
import {
  manualMethods,
  type PaymentMode,
  type PaymentView,
} from "../../shared/payments";
import { paymentViewResponse } from "../../shared/api-responses";
import { minorUnits } from "./payment-format";
import { PaymentBalanceSummary } from "./PaymentBalanceSummary";
import { BookingPaymentList } from "./BookingPaymentList";
import { AccountingHistory } from "./AccountingHistory";
import { Button } from "../components/ui/button";
import { Field, Amount, Note } from "./PaymentFields";
import { workspaceApi as api } from "../workspace-api";
import type { RunWorkspaceAction as Run } from "../workspace-types";
import { money } from "../workspace-format";
import { paymentMethodLabel } from "../payment-method-label";

export function BookingPayments({
  bookingId,
  owner,
  run,
  busy: workspaceBusy,
  onError,
  timeZone,
}: {
  bookingId: string;
  owner: boolean;
  run: Run;
  busy: boolean;
  onError: (e: unknown) => Promise<void>;
  timeZone?: string;
}) {
  const [state, setState] = useState<{
      key: string;
      data?: PaymentView;
      error?: string;
    }>({ key: "" }),
    [attemptOffset, setAttemptOffset] = useState(0),
    [historyOffset, setHistoryOffset] = useState(0),
    [retry, setRetry] = useState(0),
    [amount, setAmount] = useState(""),
    [method, setMethod] = useState<(typeof manualMethods)[number]>("cash"),
    [note, setNote] = useState(""),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [creditAmount, setCreditAmount] = useState(""),
    [creditNote, setCreditNote] = useState(""),
    [creditMode, setCreditMode] = useState<PaymentMode>("live"),
    [creditId, setCreditId] = useState(() => crypto.randomUUID()),
    [checkoutId, setCheckoutId] = useState(() => crypto.randomUUID());
  const [action, setAction] = useState<"payment" | "credit">("payment");
  const path = `/payments/bookings/${encodeURIComponent(bookingId)}?${new URLSearchParams({ attemptOffset: String(attemptOffset), historyOffset: String(historyOffset) })}`;
  const requestKey = `${path}:${retry}`;
  const refresh = async () =>
    setState({
      key: requestKey,
      data: await api(path, "GET", undefined, undefined, paymentViewResponse),
    });
  const current = state.key === requestKey ? state : null;
  const loading = !current;
  // Keep keyed refund editors mounted while a page is in flight. Old rows are
  // explicitly busy and cannot be acted on; failures replace them with a retry.
  const data = current?.data ?? (loading ? state.data : undefined);
  const busy = workspaceBusy || loading;
  const reportLoadError = useEffectEvent(onError);
  useEffect(() => {
    const controller = new AbortController();
    void api(path, "GET", undefined, controller.signal, paymentViewResponse)
      .then((v) => {
        if (!controller.signal.aborted) setState({ key: requestKey, data: v });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({
            key: requestKey,
            error:
              error instanceof Error
                ? error.message
                : "Unable to load payment records.",
          });
          void reportLoadError(error);
        }
      });
    return () => {
      controller.abort();
    };
  }, [requestKey, path]);
  const work: Run = (task, message) =>
    run(async () => {
      await task();
      await refresh();
    }, message);
  if (!data)
    return (
      <section
        aria-label="Booking payments"
        className="space-y-3 rounded-xl border bg-card p-6"
      >
        {current?.error ? (
          <>
            <p role="alert" className="text-sm text-destructive">
              {current.error}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRetry((n) => n + 1)}
            >
              Retry payment records
            </Button>
          </>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Loading payment records…
          </p>
        )}
      </section>
    );
  const checkoutBalance = data.balances.find(
    (b) => b.mode === data.activeMode,
  )!;
  return (
    <section
      aria-label="Booking payments"
      aria-busy={loading}
      className="space-y-6"
    >
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading payments…
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Payment summary</h3>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void work(async () => {}, "Payment records refreshed.")
          }
        >
          <RefreshCw aria-hidden="true" /> Refresh payments
        </Button>
      </div>
      <PaymentBalanceSummary
        balances={data.balances}
        activeMode={data.activeMode}
        hasSandboxRecords={
          data.attempts.some((a) => a.mode === "test") ||
          data.history.some((h) => h.mode === "test")
        }
      />
      {data.onlineAvailable && checkoutBalance.outstandingCents > 0 && (
        <div className="space-y-3 rounded-xl border p-4">
          <p className="text-sm">
            {data.activeMode === "test"
              ? "Test checkout: no real money."
              : "Pay on Stripe."}{" "}
            Amount due:{" "}
            {money(checkoutBalance.outstandingCents, checkoutBalance.currency)}.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              void work(async () => {
                const result = await api<{
                  url: string | null;
                  status: string;
                }>(`/payments/bookings/${bookingId}/checkout`, "POST", {
                  requestId: checkoutId,
                });
                if (result.url) {
                  const url = new URL(result.url);
                  if (
                    url.protocol !== "https:" ||
                    url.hostname !== "checkout.stripe.com" ||
                    url.username ||
                    url.password
                  )
                    throw new Error("Unexpected checkout address.");
                  window.location.assign(url.href);
                } else if (
                  ["expired", "failed", "succeeded"].includes(result.status)
                ) {
                  // A confirmed terminal attempt is not the next payment intent.
                  // Keep the key for in-flight or uncertain outcomes.
                  setCheckoutId(crypto.randomUUID());
                }
              }, "Checkout status refreshed. A return from Stripe is not proof of payment.")
            }
          >
            {data.activeMode === "test"
              ? "Open sandbox checkout"
              : "Pay outstanding balance"}
          </Button>
        </div>
      )}
      {!data.onlineAvailable && !owner && (
        <p className="text-sm">
          Online payment is unavailable. Contact your sitter to arrange payment.
        </p>
      )}
      <div
        className={
          owner
            ? "grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"
            : "space-y-6"
        }
      >
        {owner && (
          <aside
            aria-label="Manage booking payments"
            className="min-w-0 rounded-xl border bg-card p-5 xl:col-start-2 xl:row-start-1 sm:p-6"
          >
            <nav
              aria-label="Payment actions"
              className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
            >
              {(
                [
                  ["payment", "Record payment"],
                  ["credit", "Adjust charge"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant="ghost"
                  aria-pressed={action === value}
                  disabled={busy}
                  className={`min-h-11 px-2 hover:bg-card hover:text-foreground ${action === value ? "bg-card shadow-sm" : "text-muted-foreground"}`}
                  onClick={() => setAction(value)}
                >
                  {label}
                </Button>
              ))}
            </nav>
            <form
              hidden={action !== "payment"}
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                void work(async () => {
                  await api(`/payments/bookings/${bookingId}/manual`, "POST", {
                    requestId,
                    amountCents: minorUnits(amount),
                    method,
                    note,
                  });
                  setAmount("");
                  setNote("");
                  setRequestId(crypto.randomUUID());
                }, "Payment recorded. No provider was charged.");
              }}
            >
              <h4 className="font-semibold">Record money already received</h4>
              <p className="text-sm leading-6 text-muted-foreground">
                Record cash or payments received elsewhere. No money is
                transferred.
              </p>
              <Amount
                value={amount}
                setValue={setAmount}
                label={`Received amount (${checkoutBalance.currency})`}
              />
              <Field label="Manual payment method">
                {(id) => (
                  <Choice
                    id={id}
                    disabled={busy}
                    value={method}
                    onValueChange={(value) => setMethod(value as typeof method)}
                    options={manualMethods.map((value) => ({
                      value,
                      label: paymentMethodLabel(value),
                    }))}
                  />
                )}
              </Field>
              <Note value={note} setValue={setNote} />
              <Button className="min-h-11 w-full" disabled={busy || !amount}>
                Record payment
              </Button>
            </form>
            <form
              hidden={action !== "credit"}
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                void work(async () => {
                  await api(`/payments/bookings/${bookingId}/credit`, "POST", {
                    requestId: creditId,
                    amountCents: minorUnits(creditAmount),
                    note: creditNote,
                    mode: creditMode,
                  });
                  setCreditAmount("");
                  setCreditNote("");
                  setCreditId(crypto.randomUUID());
                }, "Charge reduced. No money was refunded.");
              }}
            >
              <h4 className="font-semibold">Reduce the booking charge</h4>
              <p className="text-sm leading-6 text-muted-foreground">
                Apply a discount or waive a charge. This does not refund money.
              </p>
              <Field label="Credit ledger">
                {(id) => (
                  <Choice
                    id={id}
                    disabled={busy}
                    value={creditMode}
                    onValueChange={(value) =>
                      setCreditMode(value as PaymentMode)
                    }
                    options={[
                      { value: "live", label: "Actual booking charge" },
                      { value: "test", label: "Sandbox booking charge only" },
                    ]}
                  />
                )}
              </Field>
              <Amount
                value={creditAmount}
                setValue={setCreditAmount}
                label="Amount to credit"
              />
              <Note
                value={creditNote}
                setValue={setCreditNote}
                required
                label="Private reason for credit"
              />
              <Button
                className="min-h-11 w-full"
                variant="outline"
                disabled={busy || !creditAmount || !creditNote.trim()}
              >
                Record booking credit
              </Button>
            </form>
          </aside>
        )}
        <div className="min-w-0 space-y-6 xl:col-start-1 xl:row-start-1">
          <BookingPaymentList
            attempts={data.attempts}
            pagination={data.pagination.attempts}
            offset={attemptOffset}
            onPage={setAttemptOffset}
            owner={owner}
            run={work}
            busy={busy}
            loading={loading}
            timeZone={timeZone}
          />
          {
            <AccountingHistory
              history={data.history}
              pagination={data.pagination.history}
              currency={checkoutBalance.currency}
              offset={historyOffset}
              onPage={setHistoryOffset}
              owner={owner}
              run={work}
              busy={busy}
              loading={loading}
              timeZone={timeZone}
            />
          }
        </div>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        Cancelling does not refund payments or waive charges. Refunds return
        money; credits reduce charges.
      </p>
    </section>
  );
}
