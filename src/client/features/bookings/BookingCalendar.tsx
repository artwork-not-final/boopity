import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import {
  bookingStatus,
  bookingTime,
  bookingsForDay,
  businessToday,
  calendarDays,
  loadCalendarBookings,
  moveCalendar,
  type CalendarBooking,
  type CalendarView,
} from "./booking-calendar";
import { dateLabel } from "../../lib/format/date-label";

export function BookingCalendar({
  view,
  anchor,
  onAnchor,
  timeZone,
  status,
  search,
  revision,
  owner,
  busy,
  onSelect,
}: {
  view: CalendarView;
  anchor: string;
  onAnchor: (date: string) => void;
  timeZone: string;
  status: string;
  search: string;
  revision: number;
  owner: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  const dates = calendarDays(anchor, view);
  const query = new URLSearchParams({
    from: dates[0],
    to: dates.at(-1)!,
    status,
    search,
  }).toString();
  const key = `${query}:${revision}`;
  const [state, setState] = useState<{
    key: string;
    bookings?: CalendarBooking[];
    error?: string;
  }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void loadCalendarBookings(new URLSearchParams(query), controller.signal)
      .then((bookings) => {
        if (!controller.signal.aborted) setState({ key, bookings });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ key, error: error.message });
      });
    return () => controller.abort();
  }, [key, query, retry]);
  const current = state?.key === key ? state : undefined;
  const today = businessToday(timeZone);
  return (
    <Card className="gap-5 py-5 shadow-none sm:py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6">
        <h3 className="text-xl font-semibold" aria-live="polite">
          {view === "month"
            ? dateLabel(anchor, { month: "long", year: "numeric" })
            : `${dateLabel(dates[0])} – ${dateLabel(dates.at(-1)!, { month: "short", day: "numeric", year: "numeric" })}`}
        </h3>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="size-11"
            aria-label={`Previous ${view}`}
            disabled={busy}
            onClick={() => onAnchor(moveCalendar(anchor, view, -1))}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={() => onAnchor(today)}
          >
            Today
          </Button>
          <Button
            variant="outline"
            className="size-11"
            aria-label={`Next ${view}`}
            disabled={busy}
            onClick={() => onAnchor(moveCalendar(anchor, view, 1))}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
      {!current && (
        <p role="status" className="px-6 text-sm text-muted-foreground">
          Loading calendar…
        </p>
      )}
      {current?.error && (
        <p role="alert" className="px-6 text-sm text-destructive">
          {current.error}{" "}
          <Button
            variant="outline"
            onClick={() => {
              setState(undefined);
              setRetry((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </p>
      )}
      {current?.bookings && (
        <CalendarGrid
          view={view}
          anchor={anchor}
          dates={dates}
          today={today}
          bookings={current.bookings}
          selectedDay={anchor}
          onDay={onAnchor}
          onSelect={onSelect}
          owner={owner}
          busy={busy}
        />
      )}
    </Card>
  );
}

export function CalendarGrid({
  view,
  anchor,
  dates,
  today,
  bookings,
  selectedDay,
  onDay,
  onSelect,
  owner,
  busy,
}: {
  view: CalendarView;
  anchor: string;
  dates: string[];
  today: string;
  bookings: CalendarBooking[];
  selectedDay: string;
  onDay: (date: string) => void;
  onSelect: (id: string) => void;
  owner: boolean;
  busy: boolean;
}) {
  return view === "week" ? (
    <div className="divide-y px-5 sm:px-6" aria-label="Weekly booking calendar">
      {dates.map((date) => {
        const items = bookingsForDay(bookings, date);
        return (
          <section
            key={date}
            className="grid gap-3 py-4 sm:grid-cols-[120px_minmax(0,1fr)]"
          >
            <h4
              className="text-sm font-medium"
              aria-current={date === today ? "date" : undefined}
            >
              {dateLabel(date, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
              {date === today && (
                <span className="ml-2 inline-flex rounded-md bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground sm:ml-0 sm:mt-2 sm:flex sm:w-fit">
                  Today
                </span>
              )}
            </h4>
            <div className="space-y-3">
              {items.map((booking) => (
                <CalendarEvent
                  key={booking.id}
                  booking={booking}
                  owner={owner}
                  busy={busy}
                  onSelect={onSelect}
                />
              ))}
              {!items.length && (
                <p className="text-sm text-muted-foreground">No bookings</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  ) : (
    <>
      <div className="px-3 sm:px-6" aria-label="Monthly booking calendar">
        <div className="grid grid-cols-7 text-center text-xs text-muted-foreground sm:text-sm">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <span key={day} className="py-2">
              {day}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
          {dates.map((date) => {
            const items = bookingsForDay(bookings, date);
            return (
              <div
                key={date}
                className={`min-w-0 bg-card p-1 sm:p-2 ${date.slice(0, 7) !== anchor.slice(0, 7) ? "bg-muted/70" : ""}`}
              >
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={date === selectedDay}
                  aria-current={date === today ? "date" : undefined}
                  aria-label={`${dateLabel(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}, ${items.length} ${items.length === 1 ? "booking" : "bookings"}`}
                  onClick={() => onDay(date)}
                  className={`flex min-h-11 w-full flex-col items-center justify-center rounded-md text-sm focus-visible:outline-2 focus-visible:outline-ring ${date === selectedDay ? "bg-secondary font-semibold text-secondary-foreground ring-1 ring-inset ring-brand-ink" : date === today ? "bg-secondary font-semibold text-secondary-foreground" : "hover:bg-brand-soft-hover"}`}
                >
                  <span
                    className={
                      date === today
                        ? "underline decoration-2 underline-offset-4"
                        : undefined
                    }
                  >
                    {Number(date.slice(-2))}
                  </span>
                  {items.length > 0 && (
                    <span className="text-xs lg:hidden">
                      {items.length} <span className="sr-only">bookings</span>
                    </span>
                  )}
                </button>
                <div className="hidden min-h-20 space-y-1 py-2 lg:block">
                  {items.slice(0, 2).map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      disabled={busy}
                      onClick={() => onSelect(b.id)}
                      aria-label={`${bookingTime(b.startTime)} · ${b.serviceName} · ${bookingStatus(b.status)}`}
                      className="block w-full truncate rounded border-l-2 border-brand-ink bg-brand-soft px-2 py-1 text-left text-xs text-foreground hover:bg-brand-soft-hover focus-visible:outline-2 focus-visible:outline-ring"
                      title={`${bookingTime(b.startTime)} · ${b.serviceName} · ${bookingStatus(b.status)}`}
                    >
                      {bookingTime(b.startTime)} · {b.serviceName}
                    </button>
                  ))}
                  {items.length > 2 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onDay(date)}
                      className="min-h-8 w-full text-left text-xs font-medium text-brand-ink"
                    >
                      +{items.length - 2} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <section
        className="space-y-3 border-t px-5 pt-5 sm:px-6"
        aria-label="Selected day bookings"
      >
        <h4 className="font-semibold">
          {dateLabel(selectedDay, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </h4>
        {bookingsForDay(bookings, selectedDay).map((b) => (
          <CalendarEvent
            key={b.id}
            booking={b}
            owner={owner}
            busy={busy}
            onSelect={onSelect}
          />
        ))}
        {!bookingsForDay(bookings, selectedDay).length && (
          <p className="text-sm text-muted-foreground">No matching bookings.</p>
        )}
      </section>
    </>
  );
}
function CalendarEvent({
  booking: b,
  owner,
  busy,
  onSelect,
}: {
  booking: CalendarBooking;
  owner: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onSelect(b.id)}
      className="grid w-full grid-cols-1 items-start gap-3 rounded-lg border border-l-[3px] border-l-brand-ink bg-brand-soft p-4 text-left transition-colors hover:bg-brand-soft-hover focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">
          {bookingTime(b.startTime)}
          {b.endTime ? ` – ${bookingTime(b.endTime)}` : ""}
        </span>
        <span className="mt-1 block break-words font-semibold">
          {b.serviceName}
        </span>
        <span className="mt-1 block break-words text-sm text-foreground">
          {owner && b.clientName ? `${b.clientName} · ` : ""}
          {b.pets.map((p) => p.name).join(", ")}
        </span>
      </span>
      <Badge
        variant="outline"
        className={
          b.status === "active"
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : b.status === "requested"
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "bg-card text-muted-foreground"
        }
      >
        {bookingStatus(b.status)}
      </Badge>
    </button>
  );
}
