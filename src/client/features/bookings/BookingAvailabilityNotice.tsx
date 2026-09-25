export function BookingAvailabilityNotice({
  historical,
  overlaps,
}: {
  historical: boolean;
  overlaps: boolean;
}) {
  if (!historical) return null;
  return (
    <div
      role="status"
      className="space-y-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm leading-6"
    >
      <p>
        This visit has ended. It will be recorded as completed, with payment
        tracked separately.
      </p>
      {overlaps && (
        <p className="font-medium">
          This overlaps another booking. You can still record it—check that it
          isn’t a duplicate.
        </p>
      )}
    </div>
  );
}
