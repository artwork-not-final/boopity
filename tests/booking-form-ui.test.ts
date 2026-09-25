import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NewBooking } from "../src/client/features/bookings/NewBooking";

const data = {
  policy: {
    version: 1,
    portalEnabled: true,
    approvalMode: "request" as const,
    leadHours: 24,
    horizonDays: 90,
    cancelHours: 24,
    requestHoldHours: 24,
    weekly: [],
    blockedDates: [],
  },
  regional: { timeZone: "America/New_York", currency: "USD" },
  revision: 1,
};
function render(owner: boolean) {
  return renderToStaticMarkup(
    createElement(NewBooking, {
      data,
      owner,
      busy: false,
      run: async () => {},
      done: () => {},
    }),
  );
}

describe("booking form layout", () => {
  it("groups the sitter's form into open sections with a separate summary", () => {
    const html = render(true);
    expect(html.match(/<fieldset\b/g)).toHaveLength(3);
    for (const title of [
      "Client &amp; pets",
      "Service &amp; schedule",
      "Message",
    ])
      expect(html).toMatch(new RegExp(`<legend[^>]*>${title}</legend>`));
    expect(html).toContain('aria-label="Booking summary"');
    expect(html).toContain("Eastern Time (New York)");
    expect(html).not.toContain("<details");
  });
  it("removes empty selector search and pagination controls", () => {
    const html = render(true);
    expect(html).not.toContain('type="search"');
    expect(html).not.toContain("Previous");
    expect(html).not.toContain("Next");
    expect(html).toContain("Choose a client to see their pets.");
  });
  it("requires selections before confirmation and keeps cancellation/payment guidance", () => {
    const html = render(true);
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Confirm booking<\/button>/,
    );
    expect(html).toContain("Confirmed immediately.");
    expect(html).toContain("Client cancellations require 24 hours’ notice.");
    expect(html).toContain("Payment is arranged separately.");
    expect(html).toContain("Availability is checked when you submit.");
  });
  it("keeps client requests scoped to their pets without a client selector", () => {
    const html = render(false);
    expect(html).toContain("Your pets");
    expect(html).not.toContain("Choose a client");
    expect(html).toContain("Sitter approval required.");
    expect(html).toContain("Send booking request");
    expect(html).not.toContain("Confirmed immediately.");
  });
});
