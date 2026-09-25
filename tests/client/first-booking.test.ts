import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FirstBookingChecklist,
  checklistDismissed,
  dismissChecklist,
} from "../../src/client/features/bookings/FirstBookingChecklist";
import type { FirstBookingProgress } from "../../src/shared/first-booking";

afterEach(() => vi.unstubAllGlobals());

const empty: FirstBookingProgress = {
  service: false,
  client: false,
  pet: false,
  booking: false,
  clientId: null,
};
function render(progress: Partial<FirstBookingProgress> = {}, busy = false) {
  return renderToStaticMarkup(
    createElement(FirstBookingChecklist, {
      progress: { ...empty, ...progress },
      busy,
      onChoose: () => {},
      onPayments: () => {},
      onDismiss: () => {},
    }),
  );
}
describe("first booking checklist", () => {
  it("shows four concise steps, automatic progress and optional payments", () => {
    const html = render();
    for (const label of [
      "Your first booking",
      "0 of 4 complete",
      "Add a service",
      "Add a client",
      "Add their pet",
      "Create a booking",
      "Set up online payments (optional)",
    ])
      expect(html).toContain(label);
    expect(html.match(/<li\b/g)).toHaveLength(4);
    expect(html).toContain('aria-label="Dismiss first-booking checklist"');
    expect(html.match(/<button\b[^>]*\sdisabled=""/g)).toHaveLength(2);
  });
  it("recognizes existing records and enables booking when they are ready", () => {
    const html = render({ service: true, client: true, pet: true });
    expect(html).toContain("3 of 4 complete");
    for (const label of [
      "Service added",
      "Client added",
      "Pet added",
      "Create a booking",
    ])
      expect(html).toContain(label);
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("Add a client first.");
  });
  it("hides for businesses with booking history, including archived prerequisites", () => {
    expect(render({ booking: true })).toBe("");
    expect(
      render({ service: true, client: true, pet: true, booking: true }),
    ).toBe("");
  });
  it("disables navigation and dismissal while saving", () => {
    expect(render({}, true).match(/<button\b[^>]*\sdisabled=""/g)).toHaveLength(
      6,
    );
  });
  it("remembers dismissal as an owner-scoped browser preference", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    expect(checklistDismissed("owner@example.test")).toBe(false);
    dismissChecklist("owner@example.test");
    expect(checklistDismissed("owner@example.test")).toBe(true);
    expect(checklistDismissed("another@example.test")).toBe(false);
  });
  it("does not break the workspace when browser storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("Storage blocked");
      },
      setItem: () => {
        throw new Error("Storage blocked");
      },
    });
    expect(checklistDismissed("owner@example.test")).toBe(false);
    expect(() => dismissChecklist("owner@example.test")).not.toThrow();
  });
});
