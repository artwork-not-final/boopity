import { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Field, Text, FormSection } from "../WorkspaceFields";
import { workspaceApi as api } from "../workspace-api";
import { money } from "../workspace-format";
import type { RunWorkspaceAction } from "../workspace-types";
import type { Service } from "./types";

export function ServiceForm({
  service,
  currency,
  busy,
  run,
  close,
}: {
  service: Service | null;
  currency: string;
  busy: boolean;
  run: RunWorkspaceAction;
  close: () => void;
}) {
  const [name, setName] = useState(service?.name ?? ""),
    [duration, setDuration] = useState(String(service?.durationMinutes ?? 30)),
    [allDay, setAllDay] = useState(service?.durationMinutes === null),
    [price, setPrice] = useState(String((service?.priceCents ?? 3000) / 100)),
    [extra, setExtra] = useState(
      String((service?.additionalPetPriceCents ?? 0) / 100),
    );
  const baseCents = Math.round(Number(price) * 100),
    extraCents = Math.round(Number(extra) * 100);
  return (
    <form
      aria-label={service ? "Edit service" : "New service"}
      className="min-w-0 space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          // Keep the private legacy description; this editor changes only service details and rates.
          const detail = service
            ? await api<{ service: { description: string } }>(
                `/owner/services/${service.id}`,
              )
            : null;
          await api(
            service ? `/owner/services/${service.id}` : "/owner/services",
            service ? "PUT" : "POST",
            {
              name,
              description: detail?.service.description ?? "",
              durationMinutes: allDay ? null : Number(duration),
              price: Number(price),
              additionalPetPrice: Number(extra),
            },
          );
          close();
        }, "Service saved.");
      }}
    >
      <FormSection title="Service details">
        <Text
          label="Service name"
          value={name}
          onChange={setName}
          required
          maxLength={200}
        />
        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
          />
          All-day / multi-day care
        </label>
        {!allDay && (
          <Field label="Visit length (minutes)">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={5}
                max={720}
                step={5}
                required
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            )}
          </Field>
        )}
      </FormSection>
      <FormSection title="Pricing">
        <div className="grid items-end gap-5 sm:grid-cols-2">
          <Field label={`Price per ${allDay ? "day" : "visit"} (${currency})`}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min="0.01"
                max="999999"
                step="0.01"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            )}
          </Field>
          <Field label={`Additional-pet price (${currency})`}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min="0"
                max="999999"
                step="0.01"
                required
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
              />
            )}
          </Field>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          Set the additional-pet price to 0 to charge each pet the full rate.
          Otherwise, the base price covers the first pet.
        </p>
        {Number.isFinite(baseCents) &&
          baseCents > 0 &&
          Number.isFinite(extraCents) &&
          extraCents >= 0 && (
            <p className="border-t pt-4 text-sm" aria-live="polite">
              Two pets:{" "}
              <span className="font-semibold">
                {money(
                  baseCents + (extraCents > 0 ? extraCents : baseCents),
                  currency,
                )}
              </span>{" "}
              per {allDay ? "day" : "visit"}.
            </p>
          )}
      </FormSection>
      <p className="text-sm text-muted-foreground">
        {service
          ? "Existing bookings keep their saved prices."
          : "New services start hidden from clients. You can offer them in the portal after saving."}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11" disabled={busy}>
          Save service
        </Button>
        <Button
          className="min-h-11"
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={close}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
