import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Choice } from "../../src/client/components/forms/Choice";

const options = [
  { value: "dog", label: "Dog" },
  { value: "cat", label: "Cat" },
  { value: "bird", label: "Bird", disabled: true },
];
function render(props: Partial<ComponentProps<typeof Choice>> = {}) {
  return renderToStaticMarkup(
    createElement(Choice, {
      id: "species",
      value: "cat",
      onValueChange: vi.fn(),
      options,
      ...props,
    }),
  );
}
const trigger = (html: string) =>
  html.match(/<button[^>]*role="combobox"[^>]*>/)![0];
const bridge = (html: string) => html.match(/<select[^>]*>/)![0];

describe("shared styled choices", () => {
  it("renders a styled, labeled trigger and keeps raw values in the hidden form control", () => {
    const html = render({ name: "species", "aria-label": "Species" });
    expect(trigger(html)).toContain('data-slot="select-trigger"');
    expect(trigger(html)).toContain('id="species"');
    expect(trigger(html)).toContain('aria-label="Species"');
    expect(bridge(html)).toContain('aria-hidden="true"');
    expect(bridge(html)).toContain('tabindex="-1"');
    expect(bridge(html)).toContain('name="species"');
    expect(bridge(html)).toContain('id="species-native"');
    expect(html.match(/<select\b/g)).toHaveLength(1);
    expect(bridge(html)).toContain("opacity-0");
    expect(html).toContain('<option value="cat" selected="">Cat</option>');
    expect(html).not.toContain('name="species" value="choice:cat"');
  });

  it.each([false, true])(
    "identifies unnamed filter fields without adding submitted names (searchable=%s)",
    (searchable) => {
      const html = render({ id: undefined, searchable });
      const triggerId = trigger(html).match(/\bid="([^"]+)"/)![1];
      expect(bridge(html)).toContain(`id="${triggerId}-native"`);
      expect(bridge(html)).not.toMatch(/\bname=/);
      expect(html.match(/<select\b/g)).toHaveLength(1);
    },
  );

  it("keeps empty filter values distinct from an absent selection", () => {
    const html = render({
      value: "",
      placeholder: "Choose a status",
      options: [{ value: "", label: "All statuses" }, ...options],
    });
    expect(html).toContain(
      '<option value="" selected="">All statuses</option>',
    );
    expect(html.match(/<option value=""/g)).toHaveLength(1);
    expect(html).not.toContain("Choose a status");
    expect(html).toContain('data-state="closed"');
  });

  it("keeps an empty required selection invalid and exposes its description on the visible trigger", () => {
    const html = render({
      value: "",
      required: true,
      placeholder: "Choose a pet",
      "aria-describedby": "species-help",
    });
    expect(bridge(html)).toContain('required=""');
    expect(trigger(html)).toContain('aria-required="true"');
    expect(trigger(html)).toContain('aria-describedby="species-help"');
    expect(html).toContain(
      '<option value="" selected="">Choose a pet</option>',
    );
  });

  it.each([false, true])(
    "disables both the form bridge and searchable=%s trigger",
    (searchable) => {
      const html = render({ disabled: true, searchable });
      expect(bridge(html)).toContain('disabled=""');
      expect(trigger(html)).toContain('disabled=""');
      expect(html).toContain('<option value="bird" disabled="">Bird</option>');
    },
  );

  it("preserves a selected remote record when it is outside the current results", () => {
    const html = render({
      searchable: true,
      value: "client-99",
      selectedLabel: "Alex & Sam",
      options: [{ value: "client-1", label: "Another client" }],
    });
    expect(html).toContain(
      '<option value="client-99" selected="">Alex &amp; Sam</option>',
    );
    expect(html).toContain('aria-haspopup="dialog"');
    expect(trigger(html)).toContain('type="button"');
    expect(html).not.toContain('value="client-99" disabled');
  });

  it("uses a placeholder for an unknown value instead of displaying an identifier", () => {
    const html = render({
      value: "unknown-record",
      placeholder: "Choose a pet",
    });
    expect(html).toContain(
      '<option value="" selected="">Choose a pet</option>',
    );
    expect(html).not.toContain("unknown-record");
  });

  it("does not search, select, or submit merely by rendering a control", () => {
    const onValueChange = vi.fn(),
      onSearchChange = vi.fn();
    render({ searchable: true, onValueChange, onSearchChange, loading: true });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onSearchChange).not.toHaveBeenCalled();
  });

  it("routes the active self-hosted pages through the shared control", () => {
    for (const file of [
      "features/settings/Appearance",
      "features/settings/EmailSettings",
      "features/setup/SetupNavigation",
      "app/Workspace",
      "features/clients/Clients",
      "features/clients/NewPetForm",
      "components/forms/PagedSelect",
      "features/payments/BookingPayments",
      "features/payments/PaymentRecords",
    ]) {
      const source = readFileSync(
        new URL(`../../src/client/${file}.tsx`, import.meta.url),
        "utf8",
      );
      expect(source).toMatch(/import \{ Choice \} from "[^"\n]*\/Choice"/);
      expect(source).not.toContain("<select");
    }
  });
});
