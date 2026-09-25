import { useEffect, useId, useState } from "react";
import { ArrowLeft, Check, ChevronRight, ClipboardCheck } from "lucide-react";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import {
  SearchBox,
  PageControls,
  compactPage,
  VISIBLE_PAGE_SIZE,
  usePage,
} from "./Pagination";
import { bookingTime, dateLabel } from "./booking-calendar";
import { timeZoneLabel } from "./time-zone-label";
import { workspaceApi } from "./workspace-api";
import {
  navigateLocal,
  useWorkspaceLocation,
  workspaceHref,
} from "./workspace-location";

export type Cancellation = {
  bookingId: string;
  bookingStatus: string;
  reason: string;
  clientName: string;
  serviceName: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  timeZone: string | null;
  createdAt: number;
  resolvedAt: number | null;
  resolution: string;
};
type Run = (work: () => Promise<unknown>, message?: string) => Promise<void>;
const filters = [
  ["open", "Needs review"],
  ["resolved", "Reviewed"],
  ["all", "All"],
] as const;
type ReviewStatus = (typeof filters)[number][0];
const formatDate = (date: string) =>
  dateLabel(date, { month: "short", day: "numeric", year: "numeric" });
function bookedDates(item: Cancellation) {
  return (
    formatDate(item.startDate) +
    (item.startDate === item.endDate ? "" : ` – ${formatDate(item.endDate)}`)
  );
}
function eventDate(value: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone,
  }).format(value);
}

export function Cancellations({
  revision,
  timeZone,
  busy,
  run,
}: {
  revision: number;
  timeZone: string;
  busy: boolean;
  run: Run;
}) {
  const { cancellation: selected } = useWorkspaceLocation();
  const [status, setStatus] = useState<ReviewStatus>("open");
  const page = usePage<{ followups: Cancellation[] }>(
    `/owner/financial-followups?status=${status}`,
    revision,
    !selected,
  );
  const rows = page.data?.followups ?? [];
  const pagination = compactPage(page.data?.pagination, rows.length);
  if (selected)
    return (
      <CancellationDetails
        key={selected}
        id={selected}
        revision={revision}
        timeZone={timeZone}
        busy={busy}
        run={run}
      />
    );
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">Cancellations</h2>
        <p className="text-sm text-muted-foreground">
          Review cancellations and payment issues. Handle refunds and credits in
          Payments.
        </p>
      </div>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <nav
          aria-label="Cancellation review status"
          className="inline-grid w-fit max-w-full grid-cols-[auto_auto_auto] gap-1 rounded-xl bg-muted p-1"
        >
          {filters.map(([value, label]) => (
            <Button
              key={value}
              type="button"
              variant="ghost"
              disabled={busy}
              aria-pressed={status === value}
              className={`min-h-11 px-3 hover:text-foreground ${status === value ? "bg-card text-foreground shadow-sm hover:bg-card dark:hover:bg-card" : "text-muted-foreground hover:bg-card/70 dark:hover:bg-card/70"}`}
              onClick={() => {
                setStatus(value);
                page.reset();
              }}
            >
              {label}
            </Button>
          ))}
        </nav>
        <SearchBox
          label="Search by client or service"
          initialValue={page.term}
          onSearch={page.search}
          className="w-full sm:max-w-sm"
        />
      </div>
      <CancellationList
        cancellations={rows.slice(0, VISIBLE_PAGE_SIZE)}
        busy={busy}
        timeZone={timeZone}
        onSelect={(cancellation) =>
          navigateLocal(workspaceHref({ section: "followups", cancellation }))
        }
      />
      {page.data && !rows.length && (
        <CancellationEmpty status={status} searching={Boolean(page.term)} />
      )}
      {(page.loading ||
        page.error ||
        page.offset > 0 ||
        pagination?.hasMore) && (
        <PageControls label="cancellations" {...page} pagination={pagination} />
      )}
    </div>
  );
}

export function CancellationEmpty({
  status,
  searching,
}: {
  status: ReviewStatus;
  searching: boolean;
}) {
  return (
    <div
      className="space-y-2 rounded-xl border border-dashed px-5 py-10 text-center"
      role="status"
    >
      <ClipboardCheck
        aria-hidden="true"
        className="mx-auto mb-3 size-6 text-muted-foreground"
      />
      <h3 className="font-medium">
        {searching
          ? "No matching cancellations"
          : status === "open"
            ? "No cancellations need review"
            : status === "resolved"
              ? "No reviewed cancellations yet"
              : "No cancellations yet"}
      </h3>
      {searching && (
        <p className="text-sm text-muted-foreground">
          Try another client or service name.
        </p>
      )}
    </div>
  );
}

export function CancellationList({
  cancellations,
  busy,
  timeZone,
  onSelect,
}: {
  cancellations: Cancellation[];
  busy: boolean;
  timeZone: string;
  onSelect: (id: string) => void;
}) {
  if (!cancellations.length) return null;
  return (
    <ul aria-label="Cancellations" className="divide-y border-y">
      {cancellations.map((item) => (
        <li key={item.bookingId}>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onSelect(item.bookingId)}
            className="grid h-auto min-h-22 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 rounded-none bg-card px-4 py-4 text-left font-normal whitespace-normal text-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset dark:hover:bg-muted sm:grid-cols-[minmax(0,1fr)_minmax(170px,1fr)_auto] sm:gap-x-6 sm:py-5"
          >
            <span className="sr-only">
              {item.resolvedAt !== null
                ? "View cancellation: "
                : "Review cancellation: "}
            </span>
            <span className="col-start-1 row-start-1 min-w-0">
              <span className="block break-words text-base font-semibold">
                {item.clientName}
              </span>
              <span className="mt-1 block break-words text-sm text-muted-foreground">
                {item.serviceName}
              </span>
            </span>
            <span className="col-start-1 row-start-2 min-w-0 text-sm sm:col-start-2 sm:row-start-1">
              <span className="block font-medium">{bookedDates(item)}</span>
              <span className="mt-1 block text-muted-foreground">
                {bookingTime(item.startTime)}
              </span>
              {item.timeZone && item.timeZone !== timeZone && (
                <span className="mt-1 block text-muted-foreground">
                  {timeZoneLabel(item.timeZone)}
                </span>
              )}
            </span>
            <span className="col-start-2 row-span-2 row-start-1 flex flex-col items-end gap-2 sm:col-start-3 sm:row-span-1">
              <Badge
                variant="outline"
                className="gap-1 bg-card font-normal text-foreground"
              >
                {item.resolvedAt !== null && (
                  <Check aria-hidden="true" className="size-3.5" />
                )}
                {item.resolvedAt !== null ? "Reviewed" : "Needs review"}
              </Badge>
              <ChevronRight
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

function CancellationDetails({
  id,
  revision,
  timeZone,
  busy,
  run,
}: {
  id: string;
  revision: number;
  timeZone: string;
  busy: boolean;
  run: Run;
}) {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    key: string;
    item?: Cancellation;
    error?: string;
  } | null>(null);
  const key = `${id}:${revision}:${retry}`;
  useEffect(() => {
    const controller = new AbortController();
    void workspaceApi<{ followup: Cancellation }>(
      `/owner/financial-followups/${encodeURIComponent(id)}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then(({ followup }) => {
        if (!controller.signal.aborted) setState({ key, item: followup });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            key,
            error:
              error instanceof Error
                ? error.message
                : "Unable to load this cancellation.",
          });
      });
    return () => controller.abort();
  }, [key, id]);
  const current = state?.key === key ? state : null;
  return (
    <div className="space-y-6">
      <Button
        type="button"
        variant="ghost"
        disabled={busy}
        className="-ml-3 min-h-11"
        onClick={() => navigateLocal(workspaceHref({ section: "followups" }))}
      >
        <ArrowLeft aria-hidden="true" /> Back to cancellations
      </Button>
      {current?.item ? (
        <CancellationReview
          key={id}
          item={current.item}
          timeZone={timeZone}
          busy={busy}
          onResolve={(resolution) =>
            run(
              () =>
                workspaceApi(
                  `/owner/financial-followups/${encodeURIComponent(id)}/resolve`,
                  "POST",
                  {
                    resolution,
                    expectedCreatedAt: current.item!.createdAt,
                    expectedReason: current.item!.reason,
                  },
                ),
              "Review recorded. No money was moved.",
            )
          }
        />
      ) : current?.error ? (
        <div role="alert" className="space-y-3 rounded-xl border bg-card p-5">
          <p>{current.error}</p>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setRetry((n) => n + 1)}
          >
            Retry
          </Button>
        </div>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Loading cancellation…
        </p>
      )}
    </div>
  );
}

export function CancellationReview({
  item,
  timeZone,
  busy,
  onResolve,
}: {
  item: Cancellation;
  timeZone: string;
  busy: boolean;
  onResolve: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const noteId = useId();
  const zone = item.timeZone ?? timeZone;
  const reviewed = item.resolvedAt !== null;
  const openBooking = (payments: boolean) =>
    navigateLocal(
      workspaceHref({
        section: "bookings",
        booking: item.bookingId,
        bookingTab: payments ? "payments" : "overview",
      }),
    );
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2 className="break-words text-2xl font-semibold">
            {item.clientName}
          </h2>
          <p className="break-words text-muted-foreground">
            {item.serviceName}
          </p>
        </div>
        <Badge
          variant="outline"
          className="min-h-8 gap-1 bg-card px-3 text-sm font-normal"
        >
          {reviewed && <Check aria-hidden="true" className="size-4" />}
          {reviewed ? "Reviewed" : "Needs review"}
        </Badge>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section
          aria-labelledby={`${noteId}-booking`}
          className="min-w-0 space-y-5 rounded-xl border bg-card p-5 sm:p-6"
        >
          <h3 id={`${noteId}-booking`} className="font-semibold">
            {item.bookingStatus === "cancelled"
              ? "Cancelled booking"
              : "Booking"}
          </h3>
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Booking dates</dt>
              <dd className="mt-1 font-medium">{bookedDates(item)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Time</dt>
              <dd className="mt-1">
                {bookingTime(item.startTime)}
                <span className="mt-1 block text-muted-foreground">
                  {timeZoneLabel(zone)}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Flagged on</dt>
              <dd className="mt-1">{eventDate(item.createdAt, zone)}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-3 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => openBooking(false)}
            >
              View booking
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => openBooking(true)}
            >
              View payments
            </Button>
          </div>
        </section>
        <section
          aria-labelledby={`${noteId}-review`}
          className="min-w-0 space-y-5 rounded-xl border bg-card p-5 sm:p-6"
        >
          <h3 id={`${noteId}-review`} className="font-semibold">
            {reviewed ? "Review recorded" : "Review details"}
          </h3>
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Reason for review</h4>
            <p className="whitespace-pre-wrap break-words text-sm">
              {item.reason}
            </p>
          </div>
          {reviewed ? (
            <>
              <p className="whitespace-pre-wrap break-words">
                {item.resolution}
              </p>
              <p className="text-sm text-muted-foreground">
                Reviewed {eventDate(item.resolvedAt!, zone)}
              </p>
            </>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy && note.trim() && note.trim().length <= 1000)
                  void onResolve(note.trim());
              }}
            >
              <div className="space-y-2">
                <label htmlFor={noteId} className="block text-sm font-medium">
                  Review note
                </label>
                <textarea
                  id={noteId}
                  required
                  maxLength={1000}
                  rows={4}
                  disabled={busy}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  aria-describedby={`${noteId}-help`}
                  className="min-h-28 w-full min-w-0 resize-y rounded-md border bg-card px-3 py-2 text-base"
                />
                <p
                  id={`${noteId}-help`}
                  className="text-sm text-muted-foreground"
                >
                  Private to your business.
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                Marking reviewed does not refund payments or change charges.
              </p>
              <Button
                type="submit"
                className="min-h-11 w-full sm:w-auto"
                disabled={busy || !note.trim() || note.trim().length > 1000}
              >
                Mark reviewed
              </Button>
            </form>
          )}
        </section>
      </div>
    </>
  );
}
