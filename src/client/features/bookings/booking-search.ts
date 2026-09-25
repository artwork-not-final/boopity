type BookingSearchView = {
  view: "week" | "month" | "list";
  from: string;
  to: string;
};

// Finding a booking should not require knowing its date. Clearing the search
// leaves the current view and any deliberately selected date filters in place.
export function bookingSearchTarget(text: string, current: BookingSearchView) {
  const search = text.trim();
  return {
    ...(search ? { view: "list" as const, from: "", to: "" } : current),
    search,
  };
}
