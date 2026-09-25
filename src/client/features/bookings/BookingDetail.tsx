import { useId, type ReactNode } from "react";
import {
  CalendarDays,
  Clock3,
  LockKeyhole,
  MessageSquare,
  PawPrint,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { bookingStatus, bookingTime, dateLabel } from "./booking-calendar";
import { timeZoneLabel } from "../../lib/format/time-zone-label";
import type { Booking } from "./types";

export function BookingDetailHeader({
  booking: b,
  owner,
  zone,
  currency,
}: {
  booking: Booking;
  owner: boolean;
  zone: string;
  currency: string;
}) {
  return (
    <header className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h2 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">
            {b.serviceName}
          </h2>
          <p className="flex items-start gap-2 text-base text-muted-foreground">
            <PawPrint aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="break-words">
              {b.pets.map((p) => p.name).join(", ") || "No pets listed"}
              {owner && b.clientName ? ` · ${b.clientName}` : ""}
            </span>
          </p>
        </div>
        <Badge className="px-3 py-1 text-sm" variant="outline">
          {bookingStatus(b.status)}
        </Badge>
      </div>
      <dl className="grid gap-5 rounded-xl border bg-card p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
        <SummaryItem
          icon={<CalendarDays aria-hidden="true" className="size-4" />}
          label="Date"
        >
          <time dateTime={b.startDate}>
            {dateLabel(b.startDate, {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </time>
          {b.endDate !== b.startDate && (
            <>
              {" "}
              –{" "}
              <time dateTime={b.endDate}>
                {dateLabel(b.endDate, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </time>
            </>
          )}
        </SummaryItem>
        <SummaryItem
          icon={<Clock3 aria-hidden="true" className="size-4" />}
          label="Time"
        >
          {bookingTime(b.startTime)}
          {b.endTime ? ` – ${bookingTime(b.endTime)}` : ""}
          <span className="mt-1 block text-sm font-normal text-muted-foreground">
            {timeZoneLabel(zone)}
          </span>
        </SummaryItem>
        <div className="min-w-0 border-t pt-4 sm:col-span-2 lg:col-span-1 lg:border-t-0 lg:border-l lg:pl-6 lg:pt-0">
          <dt className="text-sm text-muted-foreground">Booking total</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">
            {new Intl.NumberFormat(undefined, {
              style: "currency",
              currency,
            }).format(b.totalAmountCents / 100)}
          </dd>
        </div>
      </dl>
    </header>
  );
}

function SummaryItem({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="mb-1.5 flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="break-words text-base font-medium">{children}</dd>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="min-w-0 space-y-5 rounded-xl border bg-card p-5 sm:p-6"
    >
      <h3 id={id} className="text-lg font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

function NoteField({
  label,
  hint,
  value,
  onChange,
  maxLength = 2000,
  icon,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  icon?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-2">
      <label
        htmlFor={id}
        className="flex items-center gap-2 text-sm font-medium"
      >
        {icon}
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      <textarea
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        maxLength={maxLength}
        className="min-h-28 w-full min-w-0 resize-y rounded-md border bg-card px-3 py-2 text-base"
      />
    </div>
  );
}

export function BookingOverview({
  booking: b,
  owner,
  busy,
  zone,
  notes,
  update,
  reason,
  setNotes,
  setUpdate,
  setReason,
  onSave,
  onTransition,
}: {
  booking: Booking;
  owner: boolean;
  busy: boolean;
  zone: string;
  notes: string;
  update: string;
  reason: string;
  setNotes: (value: string) => void;
  setUpdate: (value: string) => void;
  setReason: (value: string) => void;
  onSave: () => void;
  onTransition: (action: string) => void;
}) {
  const ongoing = ["requested", "active"].includes(b.status);
  const canDecline = owner && b.status === "requested";
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
      <div className="min-w-0 space-y-6">
        <DetailSection title="Booking message">
          <p className="whitespace-pre-wrap break-words text-base leading-7 text-muted-foreground">
            {b.clientRequest || "No message with this booking."}
          </p>
        </DetailSection>
        {owner ? (
          <form
            aria-label="Visit notes"
            onSubmit={(e) => {
              e.preventDefault();
              onSave();
            }}
          >
            <DetailSection title="Visit notes">
              <NoteField
                label="Private sitter notes"
                hint="Never shown to clients."
                icon={<LockKeyhole aria-hidden="true" className="size-4" />}
                value={notes}
                onChange={setNotes}
                maxLength={4000}
              />
              <div className="border-t pt-5">
                <NoteField
                  label="Client-visible visit update"
                  hint="Shared with the client in their booking."
                  icon={<MessageSquare aria-hidden="true" className="size-4" />}
                  value={update}
                  onChange={setUpdate}
                />
              </div>
              <div className="flex justify-end">
                <Button className="min-h-11 w-full sm:w-auto" disabled={busy}>
                  Save visit notes
                </Button>
              </div>
            </DetailSection>
          </form>
        ) : (
          <DetailSection title="Update from your sitter">
            <p className="whitespace-pre-wrap break-words text-base leading-7 text-muted-foreground">
              {b.clientUpdate || "No visit update yet."}
            </p>
          </DetailSection>
        )}
      </div>
      <aside className="min-w-0 space-y-6">
        {b.status === "requested" && (
          <DetailSection title="Awaiting approval">
            {b.requestExpiresAt && (
              <p className="text-sm leading-6 text-muted-foreground">
                {owner ? "Approve by " : "Your sitter can approve until "}
                {new Date(b.requestExpiresAt).toLocaleString(undefined, {
                  timeZone: zone,
                })}
                . The slot is released if the request expires.
              </p>
            )}
            {owner && (
              <Button
                className="min-h-11 w-full"
                disabled={busy}
                onClick={() => onTransition("approve")}
              >
                Approve request
              </Button>
            )}
          </DetailSection>
        )}
        {owner && b.status === "active" && b.endAt <= Date.now() && (
          <DetailSection title="Visit complete?">
            <Button
              className="min-h-11 w-full"
              disabled={busy}
              onClick={() => onTransition("complete")}
            >
              Mark completed
            </Button>
          </DetailSection>
        )}
        <DetailSection title={ongoing ? "Cancellation" : "Booking status"}>
          {!ongoing ? (
            <p className="text-sm text-muted-foreground">
              {bookingStatus(b.status)}. See History for details.
            </p>
          ) : (
            <>
              <p className="text-sm leading-6 text-muted-foreground">
                Client cancellation deadline:{" "}
                <span className="block font-medium text-foreground">
                  {b.policy
                    ? new Date(
                        b.startAt - b.policy.cancelHours * 3_600_000,
                      ).toLocaleString(undefined, { timeZone: zone })
                    : "Contact the sitter"}
                </span>
              </p>
              {(b.canCancel || canDecline) && (
                <>
                  <NoteField
                    label={
                      canDecline
                        ? "Cancellation / decline reason"
                        : "Cancellation reason"
                    }
                    hint={
                      owner
                        ? "Shared with the client."
                        : "Shared with your sitter."
                    }
                    value={reason}
                    onChange={setReason}
                    maxLength={1000}
                  />
                  <div className="flex flex-col gap-3">
                    {b.canCancel && (
                      <Button
                        className="min-h-11"
                        variant="outline"
                        disabled={busy || !reason.trim()}
                        onClick={() => onTransition("cancel")}
                      >
                        Cancel booking
                      </Button>
                    )}
                    {canDecline && (
                      <Button
                        className="min-h-11"
                        variant="outline"
                        disabled={busy || !reason.trim()}
                        onClick={() => onTransition("decline")}
                      >
                        Decline request
                      </Button>
                    )}
                  </div>
                </>
              )}
              {!owner && !b.canCancel && (
                <p className="text-sm leading-6">
                  Cancellation deadline passed. Contact your sitter for an
                  exception.
                </p>
              )}
            </>
          )}
          {(ongoing || b.status === "cancelled") && (
            <p className="text-sm leading-6 text-muted-foreground">
              Cancelling does not issue a refund.
            </p>
          )}
        </DetailSection>
      </aside>
    </div>
  );
}

export type BookingEvent = {
  event: string;
  actorRole: string;
  createdAt: number;
  reason: string;
};
const eventLabels: Record<string, string> = {
  "recorded-past": "Past booking recorded",
  requested: "Booking requested",
  confirmed: "Booking confirmed",
  approved: "Request approved",
  declined: "Request declined",
  cancelled: "Booking cancelled",
  completed: "Visit completed",
  expired: "Request expired",
  "notes-updated": "Visit notes updated",
};

export function BookingTimeline({
  events,
  zone,
}: {
  events: BookingEvent[];
  zone: string;
}) {
  if (!events.length)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No booking activity yet.
      </p>
    );
  return (
    <ol aria-label="Booking activity" className="ml-2 border-l">
      {events.map((event, index) => (
        <li key={index} className="relative pb-7 pl-6 last:pb-0 sm:pl-8">
          <span
            aria-hidden="true"
            className="absolute -left-1.5 top-1.5 size-3 rounded-full border-2 border-card bg-muted-foreground"
          />
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h4 className="text-base font-medium">
              {Object.hasOwn(eventLabels, event.event)
                ? eventLabels[event.event]
                : bookingStatus(event.event.replaceAll("-", " "))}
            </h4>
            <time
              dateTime={new Date(event.createdAt).toISOString()}
              className="text-sm text-muted-foreground"
            >
              {new Date(event.createdAt).toLocaleString(undefined, {
                timeZone: zone,
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {event.actorRole === "owner"
              ? "Sitter"
              : event.actorRole === "system"
                ? "Automatic update"
                : bookingStatus(event.actorRole)}
          </p>
          {event.reason && (
            <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-muted/50 px-4 py-3 text-sm leading-6">
              {event.reason}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
