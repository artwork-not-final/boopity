import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  BookingDetailHeader,
  BookingOverview,
  BookingTimeline,
} from "../src/client/BookingDetail";
import type { Booking } from "../src/client/Workspace";

const booking: Booking = {
  id: "visit",
  clientId: "client",
  clientName: "Alex Able",
  serviceName: "Pet sitting",
  status: "active",
  startDate: "2030-09-15",
  endDate: "2030-09-15",
  startTime: "12:00",
  endTime: "12:30",
  startAt: Date.UTC(2030, 8, 15, 16),
  endAt: Date.UTC(2030, 8, 15, 16, 30),
  totalAmountCents: 3000,
  requestExpiresAt: null,
  version: 1,
  canCancel: true,
  clientRequest: "Please use the side gate.\nTreats are on the counter.",
  clientUpdate: "Juniper enjoyed her walk.",
  privateNotes: "PRIVATE: gate code",
  pets: [{ id: "juniper", name: "Juniper", species: "dog", isActive: true }],
  policy: {
    timeZone: "America/New_York",
    cancelHours: 24,
    approvalMode: "request",
  },
  price: null,
};
const props = {
  booking,
  owner: true,
  busy: false,
  zone: "America/New_York",
  notes: booking.privateNotes!,
  update: booking.clientUpdate,
  reason: "",
  setNotes: vi.fn(),
  setUpdate: vi.fn(),
  setReason: vi.fn(),
  onSave: vi.fn(),
  onTransition: vi.fn(),
};
const overview = (changes: Partial<typeof props> = {}) =>
  renderToStaticMarkup(
    createElement(BookingOverview, { ...props, ...changes }),
  );

describe("booking detail overview", () => {
  it("keeps the booking identity, schedule and total together", () => {
    const html = renderToStaticMarkup(
      createElement(BookingDetailHeader, {
        booking,
        owner: true,
        zone: props.zone,
        currency: "USD",
      }),
    );
    for (const text of [
      "Pet sitting",
      "Juniper · Alex Able",
      "Confirmed",
      "Eastern Time (New York)",
      "12:00 PM",
      "12:30 PM",
      "Booking total",
      "$30.00",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("America/New_York");
    expect(html).not.toContain("Balance due");
  });
  it("supports multi-day all-day bookings without duplicating a time range", () => {
    const html = renderToStaticMarkup(
      createElement(BookingDetailHeader, {
        booking: {
          ...booking,
          startTime: null,
          endTime: null,
          endDate: "2030-09-18",
        },
        owner: false,
        zone: props.zone,
        currency: "USD",
      }),
    );
    expect(html).toContain('dateTime="2030-09-18"');
    expect(html).toContain("All day");
    expect(html).not.toContain("Alex Able");
  });
  it("keeps sitter notes separate from the shared update, without accordions", () => {
    const html = overview();
    expect(html).toContain("Private sitter notes");
    expect(html).toContain("Never shown to clients.");
    expect(html).toContain("Client-visible visit update");
    expect(html).toContain('maxLength="4000"');
    expect(html).toContain('maxLength="2000"');
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).not.toContain("<details");
  });
  it("keeps private notes and owner actions out of the client view", () => {
    const html = overview({ owner: false });
    expect(html).toContain("Juniper enjoyed her walk.");
    expect(html).toContain("Shared with your sitter.");
    expect(html).not.toMatch(
      /PRIVATE:|Private sitter notes|Save visit notes|Approve request|Mark completed|Decline request/,
    );
  });
  it("requires a reason to cancel or decline, while keeping approval separate", () => {
    const html = overview({
      booking: {
        ...booking,
        status: "requested",
        requestExpiresAt: booking.startAt,
      },
    });
    expect(html).toContain("Approve request");
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Cancel booking<\/button>/,
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Decline request<\/button>/,
    );
    expect(html).toContain("Cancelling does not issue a refund.");
    expect(html).toContain('maxLength="1000"');
  });
  it("shows the closed cancellation window without an unusable form", () => {
    const html = overview({
      owner: false,
      booking: { ...booking, canCancel: false },
    });
    expect(html).toContain("Cancellation deadline passed");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain(">Cancel booking<");
  });
  it("removes obsolete cancellation controls for finished bookings", () => {
    const html = overview({
      booking: { ...booking, status: "completed", canCancel: false },
    });
    expect(html).toContain("Completed. See History for details.");
    expect(html).not.toMatch(
      /Client cancellation deadline|Cancel booking|Cancellation reason/,
    );
  });
  it("does not offer completion before a visit ends and disables actions while busy", () => {
    expect(overview()).not.toContain("Mark completed");
    const html = overview({
      busy: true,
      reason: "Sitter unavailable",
      booking: { ...booking, endAt: 0 },
    });
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Mark completed<\/button>/,
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Save visit notes<\/button>/,
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Cancel booking<\/button>/,
    );
  });
});

describe("booking history timeline", () => {
  it("shows ordered events, roles, readable business-zone dates and multiline reasons", () => {
    const events = [
      {
        event: "confirmed",
        actorRole: "owner",
        createdAt: Date.UTC(2030, 8, 10, 16),
        reason: "",
      },
      {
        event: "notes-updated",
        actorRole: "owner",
        createdAt: Date.UTC(2030, 8, 10, 17),
        reason: "",
      },
      {
        event: "cancelled",
        actorRole: "client",
        createdAt: Date.UTC(2030, 8, 10, 18),
        reason: "Plans changed.\nNo visit needed.",
      },
    ];
    const html = renderToStaticMarkup(
      createElement(BookingTimeline, { events, zone: props.zone }),
    );
    expect(html).toContain('<ol aria-label="Booking activity"');
    expect(html.match(/<li\b/g)).toHaveLength(3);
    expect(html.indexOf("Booking confirmed")).toBeLessThan(
      html.indexOf("Visit notes updated"),
    );
    expect(html).toContain("Sitter");
    expect(html).toContain("Client");
    expect(html).toContain("12:00 PM");
    expect(html).toContain("Plans changed.\nNo visit needed.");
    expect(html).not.toContain("notes-updated");
  });
  it("escapes supplied text and handles automatic and unknown events", () => {
    const html = renderToStaticMarkup(
      createElement(BookingTimeline, {
        events: [
          {
            event: "new-event",
            actorRole: "system",
            createdAt: 0,
            reason: "<script>test</script>",
          },
        ],
        zone: "UTC",
      }),
    );
    expect(html).toContain("New event");
    expect(html).toContain("Automatic update");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("has a useful empty state", () => {
    expect(
      renderToStaticMarkup(
        createElement(BookingTimeline, { events: [], zone: "UTC" }),
      ),
    ).toContain("No booking activity yet.");
  });
});
