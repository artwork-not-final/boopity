import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Rules } from "../src/client/features/rules/Rules";

const data = {
  policy: {
    version: 1,
    portalEnabled: true,
    approvalMode: "request" as const,
    leadHours: 12,
    horizonDays: 60,
    cancelHours: 48,
    requestHoldHours: 36,
    weekly: [{ day: 1, start: "08:30", end: "18:00" }],
    blockedDates: ["2026-12-25", "2027-01-01"],
  },
  regional: { timeZone: "America/New_York", currency: "USD" },
  revision: 1,
};

function render(busy = false, timeZone = data.regional.timeZone) {
  return renderToStaticMarkup(
    createElement(Rules, {
      data: { ...data, regional: { ...data.regional, timeZone } },
      busy,
      run: async () => {},
    }),
  );
}

describe("portal and rules layout", () => {
  it("keeps all three sections visible without accordions or nested forms", () => {
    const html = render();
    expect(html.match(/<form\b/g)).toHaveLength(1);
    expect(html.match(/<fieldset\b/g)).toHaveLength(3);
    for (const title of ["Client portal", "Booking rules", "Availability"])
      expect(html).toMatch(new RegExp(`<legend[^>]*>${title}</legend>`));
    expect(html).not.toMatch(/<details\b|<summary\b/);
    expect(html).toContain("xl:grid-cols-2");
    expect(html).toContain("Save changes");
  });

  it("shows the readable time zone without a dangling separator", () => {
    const html = render();
    expect(html).toContain("Eastern Time (New York)");
    expect(html).not.toContain("America/New_York");
    expect(html).not.toContain("·");
    expect(render(false, "America/Los_Angeles")).toContain(
      "Pacific Time (Los Angeles)",
    );
    expect(render(false, "UTC")).toContain(
      'class="mt-2 text-sm text-muted-foreground">UTC</p>',
    );
  });

  it("retains saved policy values and the existing numerical limits", () => {
    const html = render();
    expect(html).toContain('value="request" selected=""');
    expect(html).toContain("Review each request");
    expect(html).toContain("Confirm automatically");
    const numbers = html.match(/<input\b[^>]*type="number"[^>]*>/g) ?? [];
    expect(numbers).toHaveLength(4);
    for (const [index, [value, min, max]] of [
      [12, 0, 720],
      [60, 1, 365],
      [48, 0, 720],
      [36, 1, 168],
    ].entries()) {
      expect(numbers[index]).toContain(`value="${value}"`);
      expect(numbers[index]).toContain(`min="${min}"`);
      expect(numbers[index]).toContain(`max="${max}"`);
      expect(numbers[index]).toContain('required=""');
    }
    expect(html).toContain("2026-12-25\n2027-01-01");
    expect(html).toContain('maxLength="4500"');
  });

  it("labels each day and time input and disables hours only for closed days", () => {
    const html = render();
    expect(html.match(/type="checkbox"/g)).toHaveLength(8);
    const times = html.match(/<input\b[^>]*type="time"[^>]*>/g) ?? [];
    expect(times).toHaveLength(14);
    const ids = times.map((input) => input.match(/id="([^"]+)"/)?.[1]);
    expect(new Set(ids).size).toBe(14);
    for (const id of ids) expect(html).toContain(`for="${id}"`);
    for (const [index, input] of times.entries()) {
      const open = index === 2 || index === 3;
      expect(input.includes('disabled=""')).toBe(!open);
      expect(input.includes('required=""')).toBe(open);
    }
    expect(times[2]).toContain('value="08:30"');
    expect(times[3]).toContain('value="18:00"');
    expect(html).toContain('class="sr-only">Monday </span>Opens');
    expect(html).toContain('class="sr-only">Monday </span>Closes');
  });

  it("keeps access consequences and booking limits near their settings", () => {
    const html = render();
    for (const copy of [
      "Turning this off signs clients out.",
      "cancel their invitations.",
      "Changes apply to new bookings.",
      "waive client notice and cancellation limits",
      "One booking or pending request at a time.",
      "31 days maximum",
      "booking conflicts can’t be overridden.",
      "Times skipped or repeated when clocks change",
    ])
      expect(html).toContain(copy);
  });

  it("prevents another save while a request is running", () => {
    expect(render(true)).toMatch(
      /<button\b[^>]*disabled=""[^>]*>Save changes<\/button>/,
    );
    expect(render()).not.toMatch(/<button\b[^>]*disabled=""/);
  });
});
