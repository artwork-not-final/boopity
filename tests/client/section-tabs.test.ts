// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SectionTabs } from "../../src/client/components/navigation/SectionTabs";

const items = [
  ["contact", "Contact"],
  ["pets", "Pets"],
  ["portal", "Portal access"],
] as const;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(
  value = "contact",
  disabled = false,
  selection: "page" | "value" = "page",
) {
  const onValueChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(SectionTabs, {
        label: "Client sections",
        items,
        value,
        onValueChange,
        disabled,
        selection,
      }),
    ),
  );
  return onValueChange;
}

describe("shared underline tabs", () => {
  it("reveals a selected tab on mount and resize without scrolling the page", async () => {
    let resize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    let right = 330;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.tagName === "NAV"
          ? new DOMRect(10, 500, 250, 44)
          : new DOMRect(right - 80, 500, 80, 44);
      },
    );
    const pageScroll = vi.spyOn(window, "scrollTo");
    await render("portal");
    const nav = container.querySelector("nav")!;
    expect(nav.scrollLeft).toBe(74);
    right = 0;
    resize();
    expect(nav.scrollLeft).toBe(-20);
    // DOM test scrolling does not clamp as a real browser does; this verifies
    // the relative adjustment on the tab row rather than a page scroll call.
    expect(pageScroll).not.toHaveBeenCalled();
    await render("contact");
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it("renders lightweight navigation with only the current section selected", async () => {
    await render();
    const nav = container.querySelector("nav")!;
    expect(nav.getAttribute("aria-label")).toBe("Client sections");
    expect(nav.classList.contains("overflow-x-auto")).toBe(true);
    expect(nav.className).not.toMatch(/bg-|rounded-|grid-cols/);
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Contact",
    );
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    for (const button of container.querySelectorAll("button")) {
      expect(button.type).toBe("button");
      expect(button.dataset.variant).toBe("tab-line");
      expect(button.classList.contains("px-1")).toBe(true);
      expect(button.classList.contains("px-4")).toBe(false);
    }
  });

  it("delegates navigation without changing the current section until its URL updates", async () => {
    const navigate = await render();
    await act(async () => container.querySelectorAll("button")[1].click());
    expect(navigate).toHaveBeenCalledExactlyOnceWith("pets");
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Contact",
    );
    await render("pets");
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Pets",
    );
    await render("contact");
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Contact",
    );
  });

  it("prevents navigation while the page is saving", async () => {
    const navigate = await render("contact", true);
    for (const button of container.querySelectorAll("button")) {
      expect(button.disabled).toBe(true);
      await act(async () => button.click());
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it("retains pressed-choice semantics for filters and views without announcing a new page", async () => {
    const select = await render("contact", false, "value");
    expect(container.querySelector("[aria-current]")).toBeNull();
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-pressed="false"]')).toHaveLength(
      2,
    );
    await act(async () => container.querySelectorAll("button")[1].click());
    expect(select).toHaveBeenCalledExactlyOnceWith("pets");
    await render("pets", false, "value");
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe(
      "Pets",
    );
  });
});
