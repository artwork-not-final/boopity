import {
  cloneElement,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Choice } from "../../components/forms/Choice";
import { ReceiptText } from "lucide-react";
import { SearchBox } from "../../components/forms/SearchBox";
import { PageControls } from "../../components/navigation/PageControls";
import { usePage } from "../../hooks/usePage";
import { manualMethods, type PaymentMode } from "../../../shared/payments";
import {
  paymentRecordStatuses,
  type PaymentRecordsView,
} from "../../../shared/payment-records";
import { timeZoneLabel } from "../../lib/format/time-zone-label";
import { navigateLocal } from "../../lib/navigation/workspace-location";
import { settingsPath } from "../../lib/navigation/settings-location";
import { statusLabels } from "./payment-format";
import { PaymentActivityList } from "./PaymentActivityList";
import { PaymentActivityTotals } from "./PaymentActivityTotals";
import { Button } from "../../components/ui/button";
import { SectionTabs } from "../../components/navigation/SectionTabs";
import { Input } from "../../components/ui/input";
import { paymentMethodLabel } from "./payment-method-label";

function Filter({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-2 text-sm font-medium">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children as ReactElement<{ id?: string }>, { id })}
    </div>
  );
}

export function PaymentRecords({
  revision,
  timeZone,
  currency,
}: {
  revision: number;
  timeZone: string;
  currency: string;
}) {
  const [mode, setMode] = useState<PaymentMode>("live");
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    method: "all",
    status: "all",
  });
  const [searchKey, setSearchKey] = useState(0);
  const invalidRange = Boolean(
    filters.from && filters.to && filters.from > filters.to,
  );
  const query = new URLSearchParams({
    mode,
    method: filters.method,
    status: filters.status,
  });
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  const page = usePage<PaymentRecordsView>(
    `/payments/records?${query}`,
    revision,
    !invalidRange,
  );
  const filter = (name: keyof typeof filters, value: string) => {
    setFilters((current) => ({ ...current, [name]: value }));
    page.reset();
  };
  const filtered = Boolean(
    page.term ||
    filters.from ||
    filters.to ||
    filters.method !== "all" ||
    filters.status !== "all",
  );
  const rangeError = invalidRange
    ? "Choose an end date on or after the start date."
    : undefined;
  const errorId = useId();
  return (
    <section className="space-y-6" aria-label="Business payments">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Payments</h2>
        <Button
          variant="outline"
          onClick={() => navigateLocal(settingsPath("payments"))}
        >
          Payment settings
        </Button>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <SectionTabs
          label="Payment environment"
          selection="value"
          items={[
            ["live", "Actual payments"],
            ["test", "Sandbox"],
          ]}
          value={mode}
          onValueChange={(value) => {
            setMode(value);
            page.reset();
          }}
        />
        <SearchBox
          key={searchKey}
          label="Search by client or service"
          onSearch={page.search}
          className="w-full sm:max-w-sm"
        />
      </div>
      {mode === "test" && (
        <p
          role="status"
          className="rounded-lg border bg-card px-4 py-3 text-sm"
        >
          Sandbox activity only. No real money is included.
        </p>
      )}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <Filter label="From">
            <Input
              type="date"
              min="1970-01-01"
              max={filters.to || "9998-12-31"}
              value={filters.from}
              aria-invalid={invalidRange || undefined}
              aria-describedby={rangeError ? errorId : undefined}
              className="min-h-11 min-w-0 bg-card font-normal"
              onChange={(e) => filter("from", e.target.value)}
            />
          </Filter>
          <Filter label="To">
            <Input
              type="date"
              min={filters.from || "1970-01-01"}
              max="9998-12-31"
              value={filters.to}
              aria-invalid={invalidRange || undefined}
              aria-describedby={rangeError ? errorId : undefined}
              className="min-h-11 min-w-0 bg-card font-normal"
              onChange={(e) => filter("to", e.target.value)}
            />
          </Filter>
          <Filter label="Method">
            <Choice
              value={filters.method}
              onValueChange={(value) => filter("method", value)}
              options={[
                { value: "all", label: "All methods" },
                { value: "online", label: "Online payment" },
                ...manualMethods.map((value) => ({
                  value,
                  label: paymentMethodLabel(value),
                })),
              ]}
            />
          </Filter>
          <Filter label="Status">
            <Choice
              value={filters.status}
              onValueChange={(value) => filter("status", value)}
              options={[
                { value: "all", label: "All activity" },
                ...paymentRecordStatuses.map((value) => ({
                  value,
                  label: statusLabels[value],
                })),
              ]}
            />
          </Filter>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <p>
            By recorded date · {timeZoneLabel(page.data?.timeZone ?? timeZone)}
          </p>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilters({ from: "", to: "", method: "all", status: "all" });
                page.search("");
                setSearchKey((n) => n + 1);
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>
      {rangeError ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {rangeError}
        </p>
      ) : (
        <>
          {page.data && (
            <PaymentActivityTotals
              totals={page.data.totals}
              currency={currency}
              sandbox={mode === "test"}
            />
          )}
          <div className="space-y-3" aria-busy={page.loading}>
            <h3 className="text-lg font-semibold">Payment activity</h3>
            {page.loading ? (
              <p role="status" className="py-8 text-sm text-muted-foreground">
                Loading payments…
              </p>
            ) : (
              page.data &&
              (page.data.records.length ? (
                <PaymentActivityList
                  records={page.data.records}
                  timeZone={page.data.timeZone}
                />
              ) : (
                <div className="rounded-xl border bg-card px-6 py-10 text-center">
                  <ReceiptText
                    className="mx-auto mb-3 size-6 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <p className="font-medium">
                    {filtered
                      ? "No matching payments"
                      : mode === "test"
                        ? "No sandbox activity yet"
                        : "No payments recorded yet"}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {filtered
                      ? "Try another search or clear the filters."
                      : "Record a payment from a booking’s Payments tab."}
                  </p>
                </div>
              ))
            )}
            <PageControls
              label="payments"
              pagination={page.data?.pagination}
              offset={page.offset}
              loading={page.loading}
              error={page.error}
              go={page.go}
              retry={page.retry}
            />
          </div>
        </>
      )}
    </section>
  );
}
