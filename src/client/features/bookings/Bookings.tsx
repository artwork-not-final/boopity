import { useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "../../components/ui/button";

import { Field } from "../../components/forms/Field";
import { Text } from "../../components/forms/TextFields";
import { Hint } from "../../components/feedback/Hint";

import { Choice } from "../../components/forms/Choice";

import {
  updateWorkspaceLocation,
  useWorkspaceLocation,
} from "../../lib/navigation/workspace-location";
import { timeZoneLabel } from "../../lib/format/time-zone-label";
import { BookingCalendar } from "./BookingCalendar";
import { BookingList } from "./BookingList";

import { bookingSearchTarget } from "./booking-search";

import { businessToday } from "./booking-calendar";
import { FirstBookingGuide } from "./FirstBookingChecklist";

import { compactPage, VISIBLE_PAGE_SIZE } from "../../lib/compact-page";
import { PageControls } from "../../components/navigation/PageControls";
import { SearchBox } from "../../components/forms/SearchBox";
import { usePage } from "../../hooks/usePage";

import type { Booking } from "./types";
import type {
  FormProps,
  FirstBookingTarget,
} from "../../lib/types/workspace-types";

import { NewBooking } from "./NewBooking";
import { BookingDetails } from "./BookingDetails";

export function Bookings({
  data,
  owner,
  busy,
  run,
  revision,
  onError,
  ownerEmail,
  onFirstBookingStep,
  onPayments,
}: FormProps & {
  owner: boolean;
  revision: number;
  onError: (error: unknown) => Promise<void>;
  ownerEmail: string;
  onFirstBookingStep: (
    step: FirstBookingTarget["step"],
    clientId: string | null,
  ) => void;
  onPayments: () => void;
}) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [status, setStatus] = useState("all");
  const location = useWorkspaceLocation();
  const selected = location.booking;
  const adding = selected === "new";
  const view = location.view;
  const anchor = location.date ?? businessToday(data.regional.timeZone);
  const setSelected = (booking: string | null) =>
    updateWorkspaceLocation({ booking, bookingTab: "overview" });
  const setAdding = (value: boolean) => setSelected(value ? "new" : null);
  const setView = (value: "week" | "month" | "list") =>
    updateWorkspaceLocation({ view: value });
  const setAnchor = (date: string) => updateWorkspaceLocation({ date });
  const params = new URLSearchParams({
    status,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const page = usePage<{ bookings: Booking[] }>(
    `/bookings?${params}`,
    revision,
    view === "list",
  );
  const bookings = page.data?.bookings ?? [];
  if (adding)
    return (
      <div className="space-y-6" data-refresh-paused>
        <Button
          className="-ml-3 min-h-11"
          disabled={busy}
          variant="ghost"
          onClick={() => setAdding(false)}
        >
          <ArrowLeft aria-hidden="true" />
          Back to bookings
        </Button>
        <NewBooking
          data={data}
          owner={owner}
          busy={busy}
          run={run}
          done={setSelected}
        />
      </div>
    );
  if (selected)
    return (
      <BookingDetails
        key={selected}
        id={selected}
        data={data}
        owner={owner}
        busy={busy}
        run={run}
        close={() => setSelected(null)}
        onError={onError}
      />
    );
  return (
    <div className="space-y-6">
      {owner && (
        <FirstBookingGuide
          ownerEmail={ownerEmail}
          revision={revision}
          busy={busy}
          onError={onError}
          onPayments={onPayments}
          onChoose={(step, clientId) => {
            if (step === "booking") setAdding(true);
            else onFirstBookingStep(step, clientId);
          }}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">
            {owner ? "Bookings" : "My bookings"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {timeZoneLabel(data.regional.timeZone)}{" "}
            {owner ? "" : `· ${data.policy.leadHours} hours’ notice required`}
          </p>
        </div>
        <Button
          className="min-h-11"
          disabled={busy}
          onClick={() => setAdding(true)}
        >
          <Plus aria-hidden="true" />
          {owner ? "New booking" : "Request a booking"}
        </Button>
      </div>
      <nav
        aria-label="Booking view"
        className="inline-grid grid-cols-3 gap-1 rounded-xl bg-muted p-1"
      >
        {(["week", "month", "list"] as const).map((value) => (
          <Button
            key={value}
            variant="ghost"
            disabled={busy}
            aria-pressed={view === value}
            className={`min-h-11 px-5 hover:text-foreground ${view === value ? "bg-card text-foreground shadow-sm hover:bg-card dark:hover:bg-card" : "text-muted-foreground hover:bg-card/70 dark:hover:bg-card/70"}`}
            onClick={() => setView(value)}
          >
            {value.charAt(0).toUpperCase() + value.slice(1)}
          </Button>
        ))}
      </nav>
      <div className="grid items-end gap-5 rounded-xl border bg-card p-5 sm:grid-cols-2 sm:p-6">
        <SearchBox
          label={
            owner
              ? "Search by client, pet, or service"
              : "Search by pet or service"
          }
          onSearch={(text) => {
            const target = bookingSearchTarget(text, { view, from, to });
            setView(target.view);
            setFrom(target.from);
            setTo(target.to);
            page.search(target.search);
          }}
          initialValue={page.term}
        />
        <Field label="Booking status">
          {(id) => (
            <Choice
              id={id}
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                page.reset();
              }}
              options={[
                ["all", "All bookings"],
                ["requested", "Requested"],
                ["active", "Confirmed"],
                ["completed", "Completed"],
                ["cancelled", "Cancelled"],
                ["declined", "Declined"],
                ["expired", "Expired"],
              ].map(([value, label]) => ({ value, label }))}
            />
          )}
        </Field>
        {view === "list" && (
          <>
            <Text
              label="Bookings from"
              type="date"
              value={from}
              onChange={(v) => {
                setFrom(v);
                page.reset();
              }}
            />
            <Text
              label="Bookings through"
              type="date"
              value={to}
              onChange={(v) => {
                setTo(v);
                page.reset();
              }}
            />
          </>
        )}
      </div>
      {view !== "list" ? (
        <BookingCalendar
          view={view}
          anchor={anchor}
          onAnchor={setAnchor}
          timeZone={data.regional.timeZone}
          status={status}
          search={page.term}
          revision={revision}
          owner={owner}
          busy={busy}
          onSelect={setSelected}
        />
      ) : (
        <>
          <BookingList
            bookings={bookings.slice(0, VISIBLE_PAGE_SIZE)}
            owner={owner}
            busy={busy}
            currency={data.regional.currency}
            timeZone={data.regional.timeZone}
            onSelect={setSelected}
          />
          {page.data && !bookings.length && <Hint>No bookings found.</Hint>}
          {(page.error ||
            page.loading ||
            page.offset > 0 ||
            compactPage(page.data?.pagination, bookings.length)?.hasMore) && (
            <PageControls
              label="bookings"
              {...page}
              pagination={compactPage(page.data?.pagination, bookings.length)}
            />
          )}
        </>
      )}
    </div>
  );
}
