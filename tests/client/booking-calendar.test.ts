import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CalendarGrid } from "../../src/client/features/bookings/BookingCalendar";
import { Bookings } from "../../src/client/features/bookings/Bookings";
import {
  addCalendarDays,
  bookingStatus,
  bookingTime,
  bookingsForDay,
  businessToday,
  calendarDays,
  loadCalendarBookings,
  moveCalendar,
  type CalendarBooking,
} from "../../src/client/features/bookings/booking-calendar";

const booking: CalendarBooking = {
  id: "test-booking",
  serviceName: "Cat visit",
  clientName: "Alex River",
  pets: [{ id: "test-pet", name: "Clover" }],
  status: "active",
  startDate: "2026-09-12",
  endDate: "2026-09-12",
  startTime: "09:00",
  endTime: "09:30",
};
it.each([true, false])("uses underline view controls for owner=%s", (owner) => {
  const html = renderToStaticMarkup(
    createElement(Bookings, {
      data: {
        policy: {
          version: 1,
          portalEnabled: true,
          approvalMode: "request",
          leadHours: 24,
          horizonDays: 90,
          cancelHours: 24,
          requestHoldHours: 24,
          weekly: [],
          blockedDates: [],
        },
        regional: { timeZone: "America/New_York", currency: "USD" },
        revision: 1,
      },
      owner,
      busy: false,
      run: async () => {},
      revision: 1,
      onError: async () => {},
      ownerEmail: "owner@example.test",
      onFirstBookingStep: () => {},
      onPayments: () => {},
    }),
  );
  expect(html).toContain('aria-label="Booking view"');
  expect(html.match(/data-variant="tab-line"/g)).toHaveLength(3);
  expect(html).toContain('aria-pressed="true">Week');
  expect(html).not.toContain('data-variant="tab"');
});
describe("booking calendar dates", () => {
  it("uses the business date rather than the browser or UTC date", () => {
    const instant = new Date("2026-09-12T02:00:00Z");
    expect(businessToday("America/New_York", instant)).toBe("2026-09-11");
    expect(businessToday("Asia/Tokyo", instant)).toBe("2026-09-12");
  });
  it("builds Sunday-to-Saturday weeks across a year boundary", () => {
    expect(calendarDays("2027-01-01", "week")).toEqual([
      "2026-12-27",
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });
  it("includes leap day and complete bordering weeks", () => {
    const dates = calendarDays("2028-02-29", "month");
    expect(dates[0]).toBe("2028-01-30");
    expect(dates.at(-1)).toBe("2028-03-04");
    expect(dates).toContain("2028-02-29");
    expect(dates.length % 7).toBe(0);
  });
  it("moves months from month-end without skipping February", () => {
    expect(moveCalendar("2027-01-31", "month", 1)).toBe("2027-02-01");
    expect(moveCalendar("2027-01-01", "month", -1)).toBe("2026-12-01");
    expect(moveCalendar("2026-09-12", "week", 1)).toBe("2026-09-19");
  });
  it("does not skip or repeat dates at daylight-saving changes", () => {
    expect(addCalendarDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addCalendarDays("2026-11-01", 1)).toBe("2026-11-02");
  });
  it("shows overlapping stays on each inclusive day, before timed visits", () => {
    const stay = {
      ...booking,
      id: "stay",
      startDate: "2026-09-10",
      endDate: "2026-09-14",
      startTime: null,
      endTime: null,
    };
    expect(
      bookingsForDay([booking, stay], "2026-09-12").map((b) => b.id),
    ).toEqual(["stay", "test-booking"]);
    expect(bookingsForDay([stay], "2026-09-14")).toHaveLength(1);
    expect(bookingsForDay([stay], "2026-09-15")).toHaveLength(0);
  });
  it("uses human-readable time and status labels", () => {
    expect(bookingTime("00:00")).toBe("12:00 AM");
    expect(bookingTime("12:30")).toBe("12:30 PM");
    expect(bookingTime("17:15")).toBe("5:15 PM");
    expect(bookingTime(null)).toBe("All day");
    expect(bookingStatus("active")).toBe("Confirmed");
    expect(bookingStatus("requested")).toBe("Requested");
  });
});
describe("complete calendar loading", () => {
  const params = new URLSearchParams({
    from: "2026-08-30",
    to: "2026-10-03",
    status: "requested",
    search: "Clover",
  });
  it("loads all API pages with the same date/status/search filters", async () => {
    const rows = Array.from({ length: 53 }, (_, i) => ({
      ...booking,
      id: String(i),
    }));
    const read = vi.fn(async (path: string) => {
      const query = new URL(path, "http://localhost").searchParams;
      for (const [key, value] of params) expect(query.get(key)).toBe(value);
      const offset = Number(query.get("offset"));
      return {
        bookings: rows.slice(offset, offset + 50),
        pagination: { offset, limit: 50, hasMore: offset === 0 },
      };
    });
    const result = await loadCalendarBookings(
      params,
      new AbortController().signal,
      read,
    );
    expect(result).toHaveLength(53);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1][0]).toContain("offset=50");
  });
  it("deduplicates records when page boundaries change", async () => {
    let page = 0;
    const result = await loadCalendarBookings(
      params,
      new AbortController().signal,
      async () => ({
        bookings: [booking],
        pagination: { offset: page, limit: 1, hasMore: page++ === 0 },
      }),
    );
    expect(result).toHaveLength(1);
  });
  it("fails explicitly instead of displaying an incomplete calendar", async () => {
    const read = vi.fn(async () => ({
      bookings: [booking],
      pagination: { offset: 0, limit: 50, hasMore: true },
    }));
    await expect(
      loadCalendarBookings(params, new AbortController().signal, read),
    ).rejects.toThrow("Too many bookings");
    expect(read).toHaveBeenCalledTimes(100);
  });
  it("discards partial results if a later page fails", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        bookings: [booking],
        pagination: { offset: 0, limit: 50, hasMore: true },
      })
      .mockRejectedValueOnce(new Error("Offline"));
    await expect(
      loadCalendarBookings(params, new AbortController().signal, read),
    ).rejects.toThrow("Offline");
  });
  it("stops pagination after navigation aborts the request", async () => {
    const controller = new AbortController();
    const read = vi.fn(async () => {
      controller.abort();
      return {
        bookings: [booking],
        pagination: { offset: 0, limit: 50, hasMore: true },
      };
    });
    await expect(
      loadCalendarBookings(params, controller.signal, read),
    ).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
describe("calendar presentation", () => {
  function render(view: "week" | "month", owner = true) {
    return renderToStaticMarkup(
      createElement(CalendarGrid, {
        view,
        owner,
        anchor: "2026-09-12",
        dates: calendarDays("2026-09-12", view),
        today: "2026-09-12",
        selectedDay: "2026-09-12",
        onDay: () => {},
        onSelect: () => {},
        busy: false,
        bookings: [booking],
      }),
    );
  }
  it("provides directly clickable weekly visits without accordion controls", () => {
    const html = render("week");
    expect(html).toContain("Weekly booking calendar");
    expect(html).toContain("9:00 AM");
    expect(html).toContain("Confirmed");
    expect(html).toContain("Clover");
    expect(html).not.toContain("<details");
  });
  it("provides mobile day counts and a readable selected-day agenda", () => {
    const html = render("month");
    expect(html).toContain("Saturday, September 12, 2026, 1 booking");
    expect(html).toContain('aria-label="Selected day bookings"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain("<details");
  });
  it("gives visits a tinted surface and accent edge, with readable times and text statuses", () => {
    const html = render("week");
    expect(html).toContain("bg-brand-soft");
    expect(html).toContain("border-l-brand-ink");
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("sm:grid-cols-[minmax(0,1fr)_auto]");
    expect(html).toContain("hover:bg-brand-soft-hover");
    expect(html).toContain('text-sm font-medium text-foreground">9:00 AM');
    expect(html).toContain('text-emerald-800">Confirmed');
    expect(html.match(/<button\b[^>]*>/)?.[0]).not.toContain("hover:bg-accent");
  });
  it("marks today with an accessible date state in both calendar views", () => {
    for (const view of ["week", "month"] as const) {
      const html = render(view);
      expect(html.match(/aria-current="date"/g)).toHaveLength(1);
      expect(html).toContain("bg-secondary");
      expect(html).toContain("text-secondary-foreground");
    }
    expect(render("week")).toMatch(/<span[^>]*bg-secondary[^>]*>Today<\/span>/);
  });
  it("does not display client identities in the client-facing calendar", () => {
    expect(render("week", false)).not.toContain("Alex River");
    expect(render("week", true)).toContain("Alex River");
  });
});
