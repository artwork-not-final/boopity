import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Input } from "../../src/client/components/ui/input";

const render = (props: Parameters<typeof Input>[0] = {}) =>
  renderToStaticMarkup(createElement(Input, props));
const classes = (html: string) => html.match(/class="([^"]+)"/)![1].split(" ");

describe("shared text input surface", () => {
  it.each([
    undefined,
    "text",
    "email",
    "password",
    "search",
    "number",
    "date",
    "time",
  ])(
    "uses the same opaque surface as dropdowns and text areas (type=%s)",
    (type) => {
      const tokens = classes(render({ type }));
      expect(tokens).toContain("bg-card");
      expect(tokens).not.toContain("bg-transparent");
      expect(tokens).not.toContain("dark:bg-input/30");
    },
  );

  it("keeps disabled styling separate from readable, read-only fields", () => {
    const disabled = render({ disabled: true });
    expect(disabled).toContain('disabled=""');
    expect(classes(disabled)).toContain("disabled:bg-muted");
    expect(classes(disabled)).toContain("disabled:opacity-50");
    const readOnly = render({ readOnly: true, value: "Copyable value" });
    expect(readOnly).toContain('readOnly=""');
    expect(classes(readOnly)).toContain("bg-card");
    expect(readOnly).not.toContain('disabled=""');
  });

  it("preserves explicit overrides, labels and validation attributes", () => {
    const html = render({
      className: "bg-muted min-h-11",
      id: "owner-email",
      required: true,
      "aria-invalid": true,
      "aria-describedby": "owner-email-error",
    });
    expect(classes(html)).toContain("bg-muted");
    expect(classes(html)).not.toContain("bg-card");
    expect(classes(html)).toContain("min-h-11");
    expect(html).toContain('id="owner-email"');
    expect(html).toContain('required=""');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="owner-email-error"');
  });
});
