import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "../../components/ui/button";
import { SectionTabs } from "../../components/navigation/SectionTabs";
import { useSaveFeedback } from "../../components/feedback/ActionFeedback";

import { workspaceApi as api } from "../../lib/http/workspace-api";

import {
  updateWorkspaceLocation,
  useWorkspaceLocation,
} from "../../lib/navigation/workspace-location";

import { BookingDetailHeader, BookingOverview } from "./BookingDetail";

import { BookingPayments } from "../payments/BookingPayments";

import type { Booking } from "./types";
import type { FormProps } from "../../lib/types/workspace-types";

import { BookingHistory } from "./BookingHistory";

export function BookingDetails({
  id,
  data,
  owner,
  busy,
  run,
  close,
  onError,
}: FormProps & {
  id: string;
  owner: boolean;
  close: () => void;
  onError: (e: unknown) => Promise<void>;
}) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [update, setUpdate] = useState("");
  const saveFeedback = useSaveFeedback(`booking-notes:${id}`, [notes, update]);
  const notesLoaded = useRef(false);
  const section = useWorkspaceLocation().bookingTab;
  const setSection = (bookingTab: "overview" | "payments" | "history") =>
    updateWorkspaceLocation({ bookingTab });
  const [paymentsOpened, setPaymentsOpened] = useState(section === "payments");
  const reportLoadError = useEffectEvent(onError);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void api<{ booking: Booking }>(
      "/bookings/" + encodeURIComponent(id),
      "GET",
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setBooking(result.booking);
        // Payment and status updates must not replace an unfinished visit note.
        if (!notesLoaded.current) {
          setNotes(result.booking.privateNotes ?? "");
          setUpdate(result.booking.clientUpdate);
          notesLoaded.current = true;
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(error.message);
          void reportLoadError(error);
        }
      });
    return () => controller.abort();
  }, [id, data.revision, retry]);
  const b = booking;
  const zone = b?.policy?.timeZone ?? data.regional.timeZone;
  const transition = (action: string) => {
    if (!b) return;
    void run(
      () =>
        api("/bookings/" + encodeURIComponent(id) + "/transition", "POST", {
          action,
          version: b.version,
          reason,
        }),
      "Booking updated. No payment or refund was performed.",
    );
  };
  return (
    <div data-refresh-paused className="space-y-6">
      <Button
        className="-ml-3 min-h-11"
        variant="ghost"
        disabled={busy}
        onClick={close}
      >
        <ArrowLeft aria-hidden="true" /> Back to bookings
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}{" "}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setRetry((n) => n + 1)}
          >
            Try again
          </Button>
        </p>
      )}
      {!b ? (
        <p role="status">Loading booking details…</p>
      ) : (
        <>
          <BookingDetailHeader
            booking={b}
            owner={owner}
            zone={zone}
            currency={b.price?.currency ?? data.regional.currency}
          />
          <SectionTabs
            label="Booking sections"
            items={[
              ["overview", "Overview"],
              ["payments", "Payments"],
              ["history", "History"],
            ]}
            value={section}
            disabled={busy}
            onValueChange={(value) => {
              setSection(value);
              if (value === "payments") setPaymentsOpened(true);
            }}
          />
          <div hidden={section !== "overview"}>
            <BookingOverview
              booking={b}
              owner={owner}
              busy={busy}
              zone={zone}
              notes={notes}
              update={update}
              reason={reason}
              setNotes={setNotes}
              setUpdate={setUpdate}
              setReason={setReason}
              onTransition={transition}
              onSave={() =>
                void run(
                  () =>
                    api(
                      "/bookings/" + encodeURIComponent(id) + "/notes",
                      "PUT",
                      {
                        version: b.version,
                        privateNotes: notes,
                        clientUpdate: update,
                      },
                    ),
                  saveFeedback,
                )
              }
            />
          </div>
          {section === "history" && (
            <BookingHistory id={id} zone={zone} revision={data.revision} />
          )}
          {(paymentsOpened || section === "payments") && (
            <div hidden={section !== "payments"} className="min-w-0">
              <BookingPayments
                bookingId={id}
                owner={owner}
                run={run}
                busy={busy}
                onError={onError}
                timeZone={zone}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
