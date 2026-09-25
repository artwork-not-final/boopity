import { timeZoneLabel } from "../../lib/format/time-zone-label";

import { BookingTimeline, type BookingEvent } from "./BookingDetail";

import { PageControls } from "../../components/navigation/PageControls";
import { usePage } from "../../hooks/usePage";

export function BookingHistory({
  id,
  zone,
  revision,
}: {
  id: string;
  zone: string;
  revision: number;
}) {
  const page = usePage<{ history: BookingEvent[] }>(
    `/bookings/${encodeURIComponent(id)}`,
    revision,
  );
  return (
    <section
      aria-label="Booking history"
      className="space-y-6 rounded-xl border bg-card p-5 sm:p-7"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">Booking history</h3>
        <p className="text-sm text-muted-foreground">{timeZoneLabel(zone)}</p>
      </div>
      {page.data && <BookingTimeline events={page.data.history} zone={zone} />}
      {(page.error ||
        page.loading ||
        page.offset > 0 ||
        page.data?.pagination.hasMore) && (
        <PageControls
          label="booking history"
          {...page}
          pagination={page.data?.pagination}
        />
      )}
    </section>
  );
}
