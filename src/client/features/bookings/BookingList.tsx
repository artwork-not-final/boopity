import { ChevronRight } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  bookingStatus,
  bookingTime,
  type CalendarBooking,
} from "./booking-calendar";
import { dateLabel } from "../../lib/format/date-label";
import { timeZoneLabel } from "../../lib/format/time-zone-label";

type ListBooking = CalendarBooking & {
  totalAmountCents: number;
  price?: { currency: string } | null;
  policy?: { timeZone: string } | null;
};

const statusColors: Record<string, string> = {
  active: "text-emerald-800",
  requested: "text-amber-800",
};

export function BookingList({
  bookings,
  owner,
  busy,
  currency,
  timeZone,
  onSelect,
}: {
  bookings: ListBooking[];
  owner: boolean;
  busy: boolean;
  currency: string;
  timeZone: string;
  onSelect: (id: string) => void;
}) {
  if (!bookings.length) return null;
  return (
    <ul aria-label="Booking results" className="divide-y border-y">
      {bookings.map((booking) => {
        const pets = booking.pets.map((pet) => pet.name).join(", ");
        const total = new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: booking.price?.currency ?? currency,
        }).format(booking.totalAmountCents / 100);
        const differentZone =
          booking.policy?.timeZone && booking.policy.timeZone !== timeZone;
        return (
          <li key={booking.id}>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onSelect(booking.id)}
              className="grid h-auto min-h-22 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 rounded-none bg-card px-4 py-4 text-left font-normal whitespace-normal text-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset dark:hover:bg-muted sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:gap-x-6 sm:py-5"
            >
              <span className="sr-only">Open booking: </span>
              <span className="col-span-2 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-sm sm:col-span-1 sm:col-start-1 sm:row-start-1 sm:block">
                <span className="font-medium">
                  <time dateTime={booking.startDate}>
                    {dateLabel(booking.startDate, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </time>
                  {booking.endDate !== booking.startDate && (
                    <>
                      {" "}
                      –{" "}
                      <time dateTime={booking.endDate}>
                        {dateLabel(booking.endDate, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </time>
                    </>
                  )}
                </span>
                <span className="text-muted-foreground sm:mt-1 sm:block">
                  {bookingTime(booking.startTime)}
                  {booking.endTime ? ` – ${bookingTime(booking.endTime)}` : ""}
                </span>
                {differentZone && (
                  <span className="w-full text-sm text-muted-foreground sm:mt-1 sm:block">
                    {timeZoneLabel(booking.policy!.timeZone)}
                  </span>
                )}
              </span>
              <span className="col-start-1 row-start-2 min-w-0 sm:col-start-2 sm:row-start-1">
                <span className="block break-words text-base font-semibold">
                  {pets || booking.serviceName}
                  {owner && booking.clientName && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {booking.clientName}
                    </span>
                  )}
                </span>
                {pets && (
                  <span className="mt-1 block break-words text-sm text-muted-foreground">
                    {booking.serviceName}
                  </span>
                )}
              </span>
              <span className="col-start-2 row-start-2 flex min-w-0 items-center gap-3 sm:col-start-3 sm:row-start-1 sm:gap-5">
                <span className="flex min-w-0 flex-col items-end gap-1.5">
                  <Badge
                    variant="ghost"
                    className={`px-0 py-0 text-sm ${statusColors[booking.status] ?? "text-muted-foreground"}`}
                  >
                    {bookingStatus(booking.status)}
                  </Badge>
                  <span className="break-words text-base font-semibold tabular-nums">
                    {total}
                  </span>
                </span>
                <ChevronRight
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
