import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ServiceAvailability } from "../../src/client/features/services/ServiceAvailability";
import { ServiceForm } from "../../src/client/features/services/ServiceForm";
import { ServiceList } from "../../src/client/features/services/ServiceList";

const service = {
  id: "test-service",
  name: "Dog walking",
  durationMinutes: 30 as number | null,
  priceCents: 3000,
  additionalPetPriceCents: 1000,
  isActive: 1,
  portalVisible: 1,
};
const actions = { busy: false, run: async () => {}, close: () => {} };
function list(services = [service], busy = false, currency = "USD") {
  return renderToStaticMarkup(
    createElement(ServiceList, {
      services,
      busy,
      currency,
      onSelect: () => {},
    }),
  );
}
function form(
  selected: typeof service | null = service,
  busy = false,
  currency = "USD",
) {
  return renderToStaticMarkup(
    createElement(ServiceForm, {
      ...actions,
      service: selected,
      busy,
      currency,
    }),
  );
}
function availability(selected = service, busy = false) {
  return renderToStaticMarkup(
    createElement(ServiceAvailability, {
      ...actions,
      service: selected,
      busy,
      onChange: () => {},
    }),
  );
}

describe("service list", () => {
  it("uses flat keyboard-accessible rows without inline editing or archive actions", () => {
    const html = list();
    expect(html).toContain('aria-label="Services"');
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toContain('type="button"');
    expect(html).toContain("Edit service:");
    expect(html).not.toMatch(/<input\b|<form\b|Archive service/);
    expect(html).toContain("rounded-none");
    expect(html).toContain("hover:bg-brand-soft-hover");
    expect(html).not.toContain("hover:bg-muted");
    expect(html).not.toContain("bg-accent");
    expect(list([service], true)).toContain('disabled=""');
  });
  it("clearly describes timed, daily, and additional-pet rates", () => {
    const timed = list();
    for (const copy of [
      "Dog walking",
      "30 min visit",
      "$30.00",
      "First pet, per visit",
      "$10.00",
      "each extra pet",
    ])
      expect(timed).toContain(copy);
    const daily = list([
      { ...service, durationMinutes: null, additionalPetPriceCents: 0 },
    ]);
    expect(daily).toContain("All-day / multi-day");
    expect(daily).toContain("Per pet, per day");
    expect(daily).not.toContain("each extra pet");
    expect(list([service], false, "EUR")).toContain("€30.00");
  });
  it("groups visibility with service details and aligns pricing on the right", () => {
    const html = list([{ ...service, portalVisible: 0 }]);
    expect(html.indexOf("30 min visit")).toBeLessThan(
      html.indexOf("Not offered in portal"),
    );
    expect(html.indexOf("Not offered in portal")).toBeLessThan(
      html.indexOf("$30.00"),
    );
    expect(html).toContain("sm:justify-between");
    expect(html).toContain("sm:text-right");
    expect(html).toContain("flex-col");
    expect(html).toContain("sm:flex-row");
    expect(html).not.toContain("max-w-28");
    expect(html).not.toContain("minmax(180px,1fr)");
  });
  it("distinguishes portal visibility and archived services accurately", () => {
    expect(list()).toContain("In client portal");
    const hidden = list([{ ...service, portalVisible: 0 }]);
    expect(hidden).toContain("Not offered in portal");
    expect(hidden).not.toContain("Sitter only");
    const archived = list([{ ...service, isActive: 0 }]);
    expect(archived).toContain("Archived");
    expect(archived).not.toContain("In client portal");
  });
  it("does not render an empty outline", () => {
    expect(list([])).toBe("");
  });
});

describe("service editor", () => {
  it("shows open detail and pricing sections with the saved inputs and limits", () => {
    const html = form();
    expect(html.match(/<form\b/g)).toHaveLength(1);
    expect(html.match(/<fieldset\b/g)).toHaveLength(2);
    for (const title of ["Service details", "Pricing"])
      expect(html).toMatch(new RegExp(`<legend[^>]*>${title}</legend>`));
    expect(html).not.toMatch(/<details\b|<summary\b/);
    expect(html).toContain('value="Dog walking"');
    expect(html).toContain('maxLength="200"');
    expect(html).toContain('min="5" max="720" step="5"');
    expect(html).toContain('min="0.01" max="999999" step="0.01"');
    expect(html).toContain('min="0" max="999999" step="0.01"');
    expect(html).toContain("Price per visit (USD)");
    expect(html).toContain("Existing bookings keep their saved prices.");
    expect(html).toContain("Cancel");
  });
  it("preserves the full-rate-per-pet rule when the additional-pet price is zero", () => {
    const html = form({ ...service, additionalPetPriceCents: 0 });
    expect(html).toContain(
      "Set the additional-pet price to 0 to charge each pet the full rate.",
    );
    expect(html).toContain("$60.00");
    expect(html).toContain("per visit");
    expect(form()).toContain("$40.00");
  });
  it("shows daily pricing and hides the visit length for all-day services", () => {
    const html = form({ ...service, durationMinutes: null });
    expect(html).toContain("Price per day (USD)");
    expect(html).toContain("per day");
    expect(html).not.toContain("Visit length (minutes)");
  });
  it("starts a new service with timed defaults and explains initial portal visibility", () => {
    const html = form(null);
    expect(html).toContain('aria-label="New service"');
    expect(html).toContain("Visit length (minutes)");
    expect(html).toContain("Clients won’t see this service yet.");
    expect(html).toContain(
      "After saving, you can turn on “Offer in the client portal.”",
    );
    expect(html).toContain("bg-card p-4 text-sm leading-6 text-foreground");
    expect(html.indexOf("Clients won’t see this service yet.")).toBeLessThan(
      html.indexOf("Save service"),
    );
    expect(html).not.toContain('role="alert"');
    expect(form()).not.toContain("Clients won’t see this service yet.");
    expect(html).not.toContain("Existing bookings keep their saved prices.");
    expect(html).not.toContain("Archive service");
  });
  it("previews one- and two-pet totals together using the business currency", () => {
    const html = form({ ...service, priceCents: 1500 }, false, "EUR");
    expect(html).toContain('aria-label="Price preview"');
    expect(html).toContain('aria-live="polite" aria-atomic="true"');
    expect(html).toContain("<dt>1 pet</dt>");
    expect(html).toContain("<dt>2 pets</dt>");
    expect(html).toContain("€15.00");
    expect(html).toContain("€25.00");
    expect(html).toContain("sm:grid-cols-2");
  });
  it("disables save and cancel during a save", () => {
    expect(
      form(service, true).match(/<button\b[^>]*disabled=""/g),
    ).toHaveLength(2);
  });
});

describe("service availability", () => {
  it("keeps immediate controls separate from the rate form and explains their effects", () => {
    const html = availability();
    expect(html).not.toContain("<form");
    expect(html).toContain("Offer in the client portal");
    expect(html).toContain("Changes here save immediately.");
    expect(html).toContain("Archiving stops new bookings.");
    expect(html).toContain("Existing bookings stay unchanged.");
    expect(html).toMatch(
      /<button\b[^>]*type="button"[^>]*>Archive service<\/button>/,
    );
  });
  it("retains the visibility choice while archived and explains reactivation", () => {
    const html = availability({ ...service, isActive: 0 });
    expect(html).toContain('checked=""');
    expect(html).toContain("Archived services can’t be booked.");
    expect(html).toContain(
      "This choice applies when you reactivate the service.",
    );
    expect(html).toContain("Reactivate service");
    expect(html).not.toContain("Archive service");
  });
  it("disables both immediate actions while work is pending", () => {
    const html = availability(service, true);
    expect(html).toMatch(/<input\b[^>]*disabled=""/);
    expect(html).toMatch(/<button\b[^>]*disabled=""/);
  });
});
