import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "../../src/client/components/ui/button";

const render = (props: Parameters<typeof Button>[0] = {}) =>
  renderToStaticMarkup(
    createElement(Button, { variant: "tab-line", ...props }, "Overview"),
  );
const classes = (html: string) => html.match(/class="([^"]+)"/)![1].split(" ");

describe("shared page tab styling", () => {
  it("uses text-only hover for every unselected tab", () => {
    const tokens = classes(render());
    expect(tokens).toContain("bg-transparent");
    expect(tokens).toContain("text-muted-foreground");
    expect(tokens).toContain("hover:text-foreground");
    expect(tokens.some((token) => token.includes("hover:bg-"))).toBe(false);
    expect(tokens).not.toContain("hover:bg-brand-soft-hover");
    expect(tokens).toContain("min-h-11");
    expect(tokens).not.toContain("hover:bg-muted");
    expect(tokens).not.toContain("hover:bg-secondary/80");
  });

  it.each(["aria-pressed", "aria-[current=page]"])(
    "keeps selected %s tabs underlined with brand-colored text on hover",
    (state) => {
      const tokens = classes(render());
      for (const rule of [
        "border-brand-ink",
        "font-semibold",
        "text-brand-ink",
        "hover:text-brand-ink",
      ])
        expect(tokens).toContain(`${state}:${rule}`);
    },
  );

  it.each([true, false])(
    "preserves pressed=%s for view and filter controls",
    (selected) => {
      expect(render({ "aria-pressed": selected })).toContain(
        `aria-pressed="${selected}"`,
      );
    },
  );

  it("preserves current-page semantics for routed tabs", () => {
    const html = render({ "aria-current": "page" });
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain("aria-pressed=");
  });

  it("retains disabled and keyboard-focus affordances", () => {
    const html = render({ disabled: true });
    expect(html).toContain('disabled=""');
    const tokens = classes(html);
    expect(tokens).toContain("disabled:pointer-events-none");
    expect(tokens).toContain("disabled:opacity-50");
    expect(tokens).toContain("focus-visible:ring-[3px]");
  });

  it("allows page-specific spacing without replacing shared colors", () => {
    const tokens = classes(render({ className: "px-2" }));
    expect(tokens).toContain("px-2");
    expect(tokens).not.toContain("px-4");
    expect(tokens).toContain("hover:text-foreground");
  });

  it.each(["ghost", "outline"] as const)(
    "keeps the softer brand hover on %s buttons",
    (variant) => {
      const tokens = classes(render({ variant }));
      expect(tokens).toContain("hover:bg-brand-soft-hover");
      expect(tokens).not.toContain("hover:bg-muted");
      expect(tokens).not.toContain("hover:bg-accent");
      expect(tokens).not.toContain("hover:bg-tab-hover");
    },
  );

  it("keeps selected navigation more prominent even while hovered", () => {
    const tokens = classes(render({ variant: "secondary" }));
    expect(tokens).toContain("bg-secondary");
    expect(tokens).toContain("hover:bg-secondary");
    expect(tokens).not.toContain("hover:bg-secondary/80");
    expect(tokens).not.toContain("hover:bg-brand-soft-hover");
  });

  it("uses only text and an active underline for section tabs", () => {
    const tokens = classes(render({ variant: "tab-line" }));
    expect(tokens).toContain("bg-transparent");
    expect(tokens).toContain("rounded-none");
    expect(tokens).toContain("shadow-none");
    expect(tokens).toContain("border-b-2");
    expect(tokens).toContain("border-transparent");
    expect(tokens).toContain("hover:text-foreground");
    expect(tokens).toContain("aria-[current=page]:border-brand-ink");
    expect(tokens).toContain("aria-[current=page]:text-brand-ink");
    expect(tokens).toContain("aria-[current=page]:hover:text-brand-ink");
    expect(tokens).not.toContain("aria-[current=page]:bg-card");
    expect(tokens.some((token) => token.includes("hover:bg-"))).toBe(false);
    expect(tokens).toContain("min-h-11");
    expect(tokens).toContain("min-w-11");
  });
});
