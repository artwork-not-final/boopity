import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BookingList } from "../../src/client/features/bookings/BookingList";

const booking = {
  id: "test-booking",
  serviceName: "Pet sitting",
  clientName: "Alex River",
  pets: [{ id: "test-pet", name: "Clover" }],
  status: "active",
  startDate: "2026-09-13",
  endDate: "2026-09-13",
  startTime: null as string | null,
  endTime: null as string | null,
  totalAmountCents: 3000,
  price: { currency: "USD" },
  policy: { timeZone: "America/New_York" },
};
function render(
  changes: Partial<typeof booking> = {},
  owner = true,
  busy = false,
) {
  return renderToStaticMarkup(
    createElement(BookingList, {
      bookings: [{ ...booking, ...changes }],
      owner,
      busy,
      currency: "EUR",
      timeZone: "America/New_York",
      onSelect: () => {},
    }),
  );
}
describe("booking list rows", () => {
  it("uses one keyboard-accessible button for the whole row with no nested action", () => {
    const html = render();
    expect(html).toContain('aria-label="Booking results"');
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toContain('type="button"');
    expect(html).toContain("Open booking:");
    expect(html).not.toContain("View booking");
    expect(html).not.toContain("<a ");
    expect(html).toContain("rounded-none");
    expect(html).not.toContain("rounded-xl");
  });
  it("orders the date before pet/client and service, with status and price together", () => {
    const html = render();
    const positions = [
      "Sep 13, 2026",
      "All day",
      "Clover",
      "Alex River",
      "Pet sitting",
      "Confirmed",
      "$30.00",
    ].map((text) => html.indexOf(text));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
  it("uses a subtle brand hover on white rows instead of the full accent color", () => {
    const button = render().match(/<button\b[^>]*>/)?.[0] ?? "";
    expect(button).toContain("bg-card");
    expect(button).toContain("hover:bg-brand-soft-hover");
    expect(button).not.toContain("hover:bg-muted");
    expect(button).toContain("hover:text-foreground");
    expect(button).not.toContain("bg-accent");
    expect(button).not.toContain("text-accent-foreground");
  });
  it("uses restrained status colors while retaining their text labels", () => {
    expect(render()).toContain('text-emerald-800">Confirmed');
    expect(render({ status: "requested" })).toContain(
      'text-amber-800">Requested',
    );
    for (const status of ["completed", "cancelled", "declined", "expired"]) {
      const html = render({ status });
      expect(html).toContain(
        `text-muted-foreground">${status.charAt(0).toUpperCase() + status.slice(1)}`,
      );
      expect(html).not.toContain("bg-secondary");
    }
  });
  it("does not repeat the shared time zone", () => {
    expect(render()).not.toContain("Eastern Time");
    expect(render()).not.toContain("America/New_York");
  });
  it("preserves a different historical time zone when the shared label would be misleading", () => {
    expect(render({ policy: { timeZone: "America/Los_Angeles" } })).toContain(
      "Pacific Time (Los Angeles)",
    );
  });
  it("shows visit times and both years for a stay that crosses the year boundary", () => {
    const html = render({
      startDate: "2026-12-31",
      endDate: "2027-01-02",
      startTime: "09:00",
      endTime: "09:30",
    });
    for (const text of ["Dec 31, 2026", "Jan 2, 2027", "9:00 AM", "9:30 AM"])
      expect(html).toContain(text);
  });
  it("hides client names in the client portal and locks navigation during saves", () => {
    expect(render({}, false)).not.toContain("Alex River");
    expect(render({}, true, true)).toContain('disabled=""');
  });
  it("keeps all pet names and falls back to the service when none are available", () => {
    expect(
      render({ pets: [...booking.pets, { id: "pet-2", name: "Juniper" }] }),
    ).toContain("Clover, Juniper");
    expect(render({ pets: [] })).toContain("Pet sitting");
    expect(render({ status: "requested" })).toContain("Requested");
  });
  it("renders no empty outline when there are no results", () => {
    expect(
      renderToStaticMarkup(
        createElement(BookingList, {
          bookings: [],
          owner: true,
          busy: false,
          currency: "USD",
          timeZone: "UTC",
          onSelect: () => {},
        }),
      ),
    ).toBe("");
  });
});
