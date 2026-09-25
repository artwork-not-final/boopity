import { ChevronRight } from "lucide-react";
import type { PaymentRecord } from "../../../shared/payment-records";
import { dateLabel } from "../../lib/format/date-label";
import {
  navigateLocal,
  workspaceHref,
} from "../../lib/navigation/workspace-location";
import { paymentRecordLabel } from "./payment-format";
import { money } from "../../lib/format/workspace-format";
import { paymentMethodLabel } from "./payment-method-label";

export function PaymentActivityList({
  records,
  timeZone,
}: {
  records: PaymentRecord[];
  timeZone: string;
}) {
  return (
    <ul aria-label="Payment results" className="divide-y border-y">
      {records.map((record) => {
        const href = workspaceHref({
          section: "bookings",
          booking: record.bookingId,
          bookingTab: "payments",
        });
        return (
          <li key={record.id}>
            <a
              href={href}
              onClick={(e) => {
                if (
                  !e.metaKey &&
                  !e.ctrlKey &&
                  !e.shiftKey &&
                  !e.altKey &&
                  e.button === 0
                ) {
                  e.preventDefault();
                  navigateLocal(href);
                }
              }}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 bg-card px-4 py-4 text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[125px_minmax(0,1fr)_auto] sm:gap-x-6 sm:py-5"
            >
              <span className="sr-only">Open booking payments: </span>
              <time
                dateTime={new Date(record.createdAt).toISOString()}
                className="col-span-2 text-sm text-muted-foreground sm:col-span-1"
              >
                {new Intl.DateTimeFormat(undefined, {
                  timeZone,
                  dateStyle: "medium",
                }).format(record.createdAt)}
                <span className="ml-2 sm:ml-0 sm:mt-1 sm:block">
                  {new Intl.DateTimeFormat(undefined, {
                    timeZone,
                    timeStyle: "short",
                  }).format(record.createdAt)}
                </span>
              </time>
              <span className="min-w-0">
                <span className="block break-words font-semibold">
                  {record.clientName}
                </span>
                <span className="mt-1 block break-words text-sm text-muted-foreground">
                  {record.serviceName} ·{" "}
                  {dateLabel(record.startDate, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                  {record.endDate !== record.startDate &&
                    ` – ${dateLabel(record.endDate, { month: "short", day: "numeric", year: "numeric" })}`}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {paymentMethodLabel(record.method)}
                </span>
              </span>
              <span className="flex items-center gap-3 text-right">
                <span>
                  <span className="block text-base font-semibold tabular-nums">
                    {money(record.amountCents, record.currency)}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {paymentRecordLabel(record)}
                  </span>
                </span>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
