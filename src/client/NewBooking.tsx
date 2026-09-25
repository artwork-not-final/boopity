import { useEffect, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Field, Text, Area, Hint, FormSection } from "./WorkspaceFields";

import type { ClientSummary, Pet } from "./clients/types";
import { money } from "./workspace-format";

import type { Service } from "./services/types";
import { Choice } from "./Choice";

import { workspaceApi as api } from "./workspace-api";

import { timeZoneLabel } from "./time-zone-label";

import { useBookingAvailability } from "./booking-availability";
import { BookingAvailabilityNotice } from "./BookingAvailabilityNotice";
import { bookingTime, dateLabel } from "./booking-calendar";

import { PagedSelect } from "./Pagination";

import type { Booking } from "./booking-types";
import type { FormProps } from "./workspace-types";

import { PetChooser } from "./PetChooser";
export function NewBooking({
  data,
  owner,
  busy,
  run,
  done,
}: FormProps & { owner: boolean; done: (id: string) => void }) {
  const [client, setClient] = useState<ClientSummary | null>(null),
    [service, setService] = useState<Service | null>(null),
    [selectedPets, setSelectedPets] = useState<Pet[]>([]);
  const clientId = client?.id ?? "",
    serviceId = service?.id ?? "",
    petIds = selectedPets.map((p) => p.id);
  const [date, setDate] = useState(""),
    [endDate, setEndDate] = useState(""),
    [time, setTime] = useState(""),
    [message, setMessage] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  const availability = useBookingAvailability({
    owner,
    serviceId,
    durationMinutes: service?.durationMinutes,
    date,
    endDate,
    time,
    timeZone: data.regional.timeZone,
    revision: data.revision,
  });
  const { slots, error: slotError, historical, directTime } = availability;
  const hasSelectedSlot = Boolean(
    slots?.some(
      (slot) =>
        slot.startTime === (service?.durationMinutes === null ? null : time),
    ),
  );
  useEffect(() => {
    setTime("");
  }, [serviceId, date]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (
      busy ||
      !hasSelectedSlot ||
      !petIds.length ||
      (service?.durationMinutes !== null && !time)
    )
      return;
    void run(
      async () => {
        const response = await api<{ booking: Booking }>("/bookings", "POST", {
          requestId,
          ...(owner ? { clientId } : {}),
          serviceId,
          petIds,
          startDate: date,
          ...(service?.durationMinutes === null
            ? { endDate }
            : { startTime: time }),
          message,
        });
        done(response.booking.id);
      },
      historical
        ? "Past booking recorded. No payment was recorded."
        : "Booking saved. Review its confirmation or approval status below.",
    );
  };
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">
        {owner ? "New booking" : "Request a booking"}
      </h2>
      <form
        aria-label={owner ? "New booking" : "Request a booking"}
        className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]"
        onSubmit={submit}
      >
        <div className="min-w-0 space-y-6">
          <FormSection title={owner ? "Client & pets" : "Your pets"}>
            {owner && (
              <PagedSelect<ClientSummary>
                compact
                disabled={busy}
                label="Client"
                path="/owner/clients?status=active"
                collection="clients"
                selected={client}
                onSelect={(value) => {
                  setClient(value);
                  setSelectedPets([]);
                }}
                describe={(value) => `${value.firstName} ${value.lastName}`}
                revision={data.revision}
              />
            )}
            {!owner || clientId ? (
              <PetChooser
                key={clientId}
                path={
                  owner
                    ? `/owner/pets?clientId=${encodeURIComponent(clientId)}&activeOnly=true`
                    : "/pets?activeOnly=true"
                }
                selected={selectedPets}
                setSelected={setSelectedPets}
                revision={data.revision}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Choose a client to see their pets.
              </p>
            )}
          </FormSection>
          <FormSection title="Service & schedule">
            <PagedSelect<Service>
              compact
              disabled={busy}
              label="Service"
              path="/services?activeOnly=true"
              collection="services"
              selected={service}
              onSelect={setService}
              revision={data.revision}
              describe={(s) =>
                `${s.name} · ${s.durationMinutes === null ? "per day" : `${s.durationMinutes} minutes`} · from ${money(s.priceCents, data.regional.currency)}`
              }
            />
            <p className="text-sm text-muted-foreground">
              {timeZoneLabel(data.regional.timeZone)}
            </p>
            <div className="grid gap-5 sm:grid-cols-2">
              <Text
                label="Start date"
                type="date"
                required
                value={date}
                onChange={setDate}
              />
              {service?.durationMinutes === null && (
                <Text
                  label="Last day of care"
                  type="date"
                  required
                  value={endDate}
                  onChange={setEndDate}
                />
              )}
              {service && service.durationMinutes !== null && (
                <Field
                  label={directTime ? "Start time" : "Available start time"}
                >
                  {(id) =>
                    directTime ? (
                      <Input
                        id={id}
                        type="time"
                        className="min-h-11"
                        required
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                      />
                    ) : (
                      <Choice
                        id={id}
                        required
                        disabled={busy || availability.loading}
                        value={time}
                        onValueChange={setTime}
                        placeholder={
                          slots
                            ? "Choose a time"
                            : "Choose a service and date first"
                        }
                        options={(slots ?? []).map((slot) => ({
                          value: slot.startTime!,
                          label: bookingTime(slot.startTime),
                        }))}
                      />
                    )
                  }
                </Field>
              )}
            </div>
            {slotError && (
              <p role="alert" className="text-sm text-destructive">
                {slotError}
              </p>
            )}
            {availability.loading && (
              <p role="status" className="text-sm text-muted-foreground">
                Checking visit…
              </p>
            )}
            <BookingAvailabilityNotice
              historical={historical}
              overlaps={availability.overlaps}
            />
            {slots?.length === 0 && (
              <Hint>
                {owner
                  ? "No times available. Try another date or time."
                  : "No times available. Try another date or contact the sitter."}
              </Hint>
            )}
            {!historical &&
              service?.durationMinutes === null &&
              Boolean(slots?.length) && (
                <p className="text-sm">
                  <Check className="mr-2 inline size-4" aria-hidden="true" />
                  Dates available.
                </p>
              )}
          </FormSection>
          <FormSection title="Message">
            <Area
              label="Booking message (shared with client and sitter)"
              value={message}
              onChange={setMessage}
            />
          </FormSection>
        </div>
        <aside
          className="space-y-5 rounded-xl border bg-card p-5 sm:p-6 xl:sticky xl:top-6"
          aria-label="Booking summary"
        >
          <h3 className="text-lg font-semibold">Summary</h3>
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Service</dt>
              <dd className="mt-1 break-words font-medium">
                {service?.name || "Choose a service"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Pets</dt>
              <dd className="mt-1 break-words font-medium">
                {selectedPets.map((p) => p.name).join(", ") || "Choose pets"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">When</dt>
              <dd className="mt-1 font-medium">
                {date
                  ? dateLabel(date, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "Choose a date"}
                {service?.durationMinutes === null && endDate
                  ? ` – ${dateLabel(endDate)}`
                  : ""}
                {time ? ` · ${bookingTime(time)}` : ""}
              </dd>
            </div>
          </dl>
          {service && (
            <div className="border-t pt-4 text-sm">
              <p className="mb-1 font-medium">Rate</p>
              {service.additionalPetPriceCents > 0
                ? `First pet ${money(service.priceCents, data.regional.currency)}, then ${money(service.additionalPetPriceCents, data.regional.currency)} per additional pet`
                : `${money(service.priceCents, data.regional.currency)} per pet`}
              {service.durationMinutes === null
                ? ", per calendar day (inclusive dates)."
                : ", per visit."}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {historical ? (
              "Saved as completed. Payment is arranged separately."
            ) : (
              <>
                {owner || data.policy.approvalMode === "instant"
                  ? "Confirmed immediately."
                  : `Sitter approval required. The slot is held for ${data.policy.requestHoldHours} hours or until the visit starts, whichever comes first.`}{" "}
                Client cancellations require {data.policy.cancelHours} hours’
                notice. Payment is arranged separately.
              </>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {historical
              ? "Uses the service’s current rate. Record payment or adjust the charge after saving."
              : "Availability is checked when you submit."}
          </p>
          <Button
            className="min-h-11 w-full whitespace-normal"
            disabled={
              busy ||
              !petIds.length ||
              !hasSelectedSlot ||
              Boolean(service?.durationMinutes !== null && !time)
            }
          >
            {historical
              ? "Record past booking"
              : owner || data.policy.approvalMode === "instant"
                ? "Confirm booking"
                : "Send booking request"}
          </Button>
        </aside>
      </form>
    </div>
  );
}
