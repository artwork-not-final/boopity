import { describe, expect, it } from "vitest";
import { bookingSearchTarget } from "../../src/client/features/bookings/booking-search";

describe("finding a booking across dates", () => {
  it.each(["week", "month", "list"] as const)(
    "searches List across all dates when submitted from %s",
    (view) => {
      expect(
        bookingSearchTarget("  Clover  ", {
          view,
          from: "2026-09-06",
          to: "2026-09-12",
        }),
      ).toEqual({ view: "list", from: "", to: "", search: "Clover" });
    },
  );
  it("clears even a one-sided date limit for a new search", () => {
    expect(
      bookingSearchTarget("Cat visit", {
        view: "list",
        from: "2026-09-12",
        to: "",
      }),
    ).toEqual({ view: "list", from: "", to: "", search: "Cat visit" });
  });
  it.each(["", "   "])(
    "clearing a search does not jump views or reset deliberate date filters (%j)",
    (text) => {
      const current = {
        view: "month" as const,
        from: "2026-09-01",
        to: "2026-09-30",
      };
      expect(bookingSearchTarget(text, current)).toEqual({
        ...current,
        search: "",
      });
    },
  );
});
