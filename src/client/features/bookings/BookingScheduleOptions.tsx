import { Button } from "../../components/ui/button";
import {
  navigateLocal,
  workspaceHref,
} from "../../lib/navigation/workspace-location";

export function BookingScheduleOptions({
  owner,
  hasHours,
  historical,
  leadHours,
  busy,
  outsideHours,
  waiveNotice,
  setOutsideHours,
  setWaiveNotice,
}: {
  owner: boolean;
  hasHours: boolean;
  historical: boolean;
  leadHours: number;
  busy: boolean;
  outsideHours: boolean;
  waiveNotice: boolean;
  setOutsideHours: (value: boolean) => void;
  setWaiveNotice: (value: boolean) => void;
}) {
  if (historical || (!owner && hasHours)) return null;
  return (
    <div className="space-y-4">
      {!hasHours && (
        <div className="space-y-2 rounded-lg border bg-card p-4 text-sm">
          <p>
            {owner
              ? "No booking hours are set. Choose when clients can book with you."
              : "Your sitter hasn’t added booking hours yet. Contact them to arrange a visit."}
          </p>
          {owner && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => navigateLocal(workspaceHref({ section: "rules" }))}
            >
              Set your booking hours
            </Button>
          )}
        </div>
      )}
      {owner && (
        <div className="space-y-1 border-t pt-4 text-sm">
          <p className="font-medium">Need to make an exception?</p>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-primary"
              disabled={busy}
              checked={outsideHours}
              onChange={(e) => setOutsideHours(e.target.checked)}
            />
            Book outside opening hours
          </label>
          {leadHours > 0 && (
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-primary"
                disabled={busy}
                checked={waiveNotice}
                onChange={(e) => setWaiveNotice(e.target.checked)}
              />
              Waive minimum booking notice ({leadHours} hours)
            </label>
          )}
          <p className="text-muted-foreground">
            For this booking only. Unavailable dates and other bookings still
            apply.
          </p>
        </div>
      )}
    </div>
  );
}
