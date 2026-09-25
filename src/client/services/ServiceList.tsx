import { ChevronRight } from "lucide-react";
import { Button } from "../components/ui/button";
import { money } from "../workspace-format";
import type { Service } from "./types";

export function ServiceList({
  services,
  currency,
  busy,
  onSelect,
}: {
  services: Service[];
  currency: string;
  busy: boolean;
  onSelect: (service: Service) => void;
}) {
  if (!services.length) return null;
  return (
    <ul aria-label="Services" className="divide-y border-y">
      {services.map((service) => (
        <li key={service.id}>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onSelect(service)}
            className="flex h-auto min-h-20 w-full min-w-0 items-center gap-4 rounded-none bg-card px-4 py-4 text-left font-normal whitespace-normal text-foreground hover:bg-muted hover:text-foreground focus-visible:ring-inset dark:hover:bg-muted"
          >
            <span className="sr-only">Edit service: </span>
            <span className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <span className="min-w-0 flex-1">
                <span className="block break-words text-base font-semibold">
                  {service.name}
                </span>
                <span className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span>
                    {service.durationMinutes === null
                      ? "All-day / multi-day"
                      : `${service.durationMinutes} min visit`}
                  </span>
                  <span className="sm:whitespace-nowrap">
                    {!service.isActive
                      ? "Archived"
                      : service.portalVisible
                        ? "In client portal"
                        : "Not offered in portal"}
                  </span>
                </span>
              </span>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 sm:block sm:max-w-64 sm:shrink-0 sm:text-right">
                <span className="break-words text-base font-semibold tabular-nums sm:block">
                  {money(service.priceCents, currency)}
                </span>
                <span className="text-sm text-muted-foreground sm:mt-1 sm:block">
                  {service.additionalPetPriceCents > 0
                    ? "First pet"
                    : "Per pet"}
                  {service.durationMinutes === null
                    ? ", per day"
                    : ", per visit"}
                </span>
                {service.additionalPetPriceCents > 0 && (
                  <span className="basis-full text-sm text-muted-foreground sm:mt-1 sm:block">
                    {money(service.additionalPetPriceCents, currency)} each
                    extra pet
                  </span>
                )}
              </span>
            </span>
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </Button>
        </li>
      ))}
    </ul>
  );
}
