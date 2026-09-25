import { useId, useState } from "react";

import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Field, Area, FormSection } from "./WorkspaceFields";

import { Choice } from "./Choice";

import { workspaceApi as api } from "./workspace-api";

import { timeZoneLabel } from "./time-zone-label";

import type { Policy, FormProps } from "./workspace-types";

const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function Rules({ data, busy, run }: FormProps) {
  const [value, setValue] = useState(data.policy),
    [blocked, setBlocked] = useState(data.policy.blockedDates.join("\n"));
  const hoursId = useId();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Portal &amp; rules</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {timeZoneLabel(data.regional.timeZone)}
        </p>
      </div>
      <form
        aria-label="Portal and booking rules"
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              api("/owner/policy", "PUT", {
                ...value,
                blockedDates: [
                  ...new Set(blocked.split(/\s+/).filter(Boolean)),
                ],
              }),
            "Portal and booking rules saved.",
          );
        }}
      >
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <div className="min-w-0 space-y-6">
            <FormSection title="Client portal">
              <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  checked={value.portalEnabled}
                  onChange={(e) =>
                    setValue({ ...value, portalEnabled: e.target.checked })
                  }
                />
                Allow invited clients to sign in
              </label>
              <p className="text-sm leading-6 text-muted-foreground">
                Turning this off signs clients out. Revoke access on a client’s
                record to cancel their invitations.
              </p>
            </FormSection>
            <FormSection title="Booking rules">
              <p className="text-sm text-muted-foreground">
                Changes apply to new bookings.
              </p>
              <Field label="Booking approval">
                {(id) => (
                  <Choice
                    id={id}
                    disabled={busy}
                    value={value.approvalMode}
                    onValueChange={(approvalMode) =>
                      setValue({
                        ...value,
                        approvalMode: approvalMode as "request" | "instant",
                      })
                    }
                    options={[
                      { value: "request", label: "Review each request" },
                      { value: "instant", label: "Confirm automatically" },
                    ]}
                  />
                )}
              </Field>
              <div className="grid items-end gap-5 sm:grid-cols-2">
                {[
                  ["leadHours", "Minimum booking notice (hours)", 0, 720],
                  ["horizonDays", "Book ahead up to (days)", 1, 365],
                  ["cancelHours", "Cancellation notice (hours)", 0, 720],
                  [
                    "requestHoldHours",
                    "Time to approve a request (hours)",
                    1,
                    168,
                  ],
                ].map(([key, label, min, max]) => (
                  <Field key={key} label={String(label)}>
                    {(id) => (
                      <Input
                        id={id}
                        type="number"
                        required
                        min={Number(min)}
                        max={Number(max)}
                        value={Number(value[key as keyof Policy])}
                        onChange={(e) =>
                          setValue({ ...value, [key]: Number(e.target.value) })
                        }
                      />
                    )}
                  </Field>
                ))}
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                You can waive client notice and cancellation limits when
                managing a booking.
              </p>
            </FormSection>
          </div>
          <FormSection title="Availability">
            <p className="text-sm leading-6 text-muted-foreground">
              One booking or pending request at a time. Every day of a stay must
              be open (31 days maximum).
            </p>
            <div className="divide-y border-y">
              <div
                aria-hidden="true"
                className="hidden grid-cols-[minmax(100px,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 py-3 text-sm font-medium text-muted-foreground sm:grid"
              >
                <span>Day</span>
                <span>Opens</span>
                <span>Closes</span>
              </div>
              {days.map((day, index) => {
                const slot = value.weekly.find((s) => s.day === index);
                const change = (patch: { start?: string; end?: string }) =>
                  setValue({
                    ...value,
                    weekly: value.weekly.map((s) =>
                      s.day === index ? { ...s, ...patch } : s,
                    ),
                  });
                return (
                  <div
                    key={day}
                    className="grid grid-cols-2 items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[minmax(100px,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
                  >
                    <label className="col-span-2 flex min-h-11 items-center gap-2 text-sm sm:col-span-1">
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-primary"
                        checked={Boolean(slot)}
                        onChange={(e) =>
                          setValue({
                            ...value,
                            weekly: e.target.checked
                              ? [
                                  ...value.weekly,
                                  { day: index, start: "09:00", end: "17:00" },
                                ]
                              : value.weekly.filter((s) => s.day !== index),
                          })
                        }
                      />
                      {day}
                    </label>
                    {(["start", "end"] as const).map((edge) => (
                      <div key={edge} className="min-w-0 space-y-1">
                        <label
                          htmlFor={`${hoursId}-${index}-${edge}`}
                          className="block text-sm text-muted-foreground sm:sr-only"
                        >
                          <span className="sr-only">{day} </span>
                          {edge === "start" ? "Opens" : "Closes"}
                        </label>
                        <Input
                          id={`${hoursId}-${index}-${edge}`}
                          type="time"
                          className="min-h-10 min-w-0"
                          disabled={!slot}
                          required={Boolean(slot)}
                          value={
                            slot?.[edge] ??
                            (edge === "start" ? "09:00" : "17:00")
                          }
                          onChange={(e) => change({ [edge]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <Area
              label="Unavailable dates (YYYY-MM-DD, one per line)"
              value={blocked}
              onChange={setBlocked}
              maxLength={4500}
            />
            <p className="text-sm leading-6 text-muted-foreground">
              Closed hours, unavailable dates and booking conflicts can’t be
              overridden. Times skipped or repeated when clocks change can’t be
              booked.
            </p>
          </FormSection>
        </div>
        <div className="flex justify-end border-t pt-4">
          <Button className="min-h-11 w-full sm:w-auto" disabled={busy}>
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
}
