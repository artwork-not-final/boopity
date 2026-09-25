import { Button } from "../../components/ui/button";
import { FormSection } from "../../components/forms/FormSection";
import { workspaceApi as api } from "../../lib/http/workspace-api";
import type { RunWorkspaceAction } from "../../lib/types/workspace-types";
import type { Service } from "./types";

export function ServiceAvailability({
  service,
  busy,
  run,
  onChange,
}: {
  service: Service;
  busy: boolean;
  run: RunWorkspaceAction;
  onChange: (service: Service) => void;
}) {
  return (
    <FormSection title="Availability">
      <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          checked={Boolean(service.portalVisible)}
          disabled={busy}
          onChange={(e) => {
            const visible = e.target.checked;
            void run(async () => {
              await api(`/owner/services/${service.id}/visibility`, "PUT", {
                visible,
              });
              onChange({ ...service, portalVisible: visible ? 1 : 0 });
            }, "Client portal visibility saved.");
          }}
        />
        Offer in the client portal
      </label>
      <p className="text-sm leading-6 text-muted-foreground">
        {service.isActive
          ? "Turn this off to keep the service available only to you."
          : "Archived services can’t be booked. This choice applies when you reactivate the service."}
      </p>
      <p className="text-sm text-muted-foreground">
        Changes here save immediately.
      </p>
      <div className="space-y-3 border-t pt-5">
        <p className="text-sm leading-6 text-muted-foreground">
          {service.isActive
            ? "Archiving stops new bookings. Existing bookings stay unchanged."
            : "Reactivate to use this service for new bookings."}
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full"
          disabled={busy}
          onClick={() =>
            void run(
              async () => {
                await api(
                  `/owner/services/${service.id}/${service.isActive ? "archive" : "reactivate"}`,
                  "POST",
                  {},
                );
                onChange({ ...service, isActive: service.isActive ? 0 : 1 });
              },
              service.isActive ? "Service archived." : "Service reactivated.",
            )
          }
        >
          {service.isActive ? "Archive service" : "Reactivate service"}
        </Button>
      </div>
    </FormSection>
  );
}
