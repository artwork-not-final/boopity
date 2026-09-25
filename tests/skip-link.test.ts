// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SkipLink } from "../src/client/components/navigation/SkipLink";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/app/settings/appearance");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each(["main-content", "workspace-content", "setup-content"])(
  "moves focus past navigation to %s without changing the route or URL hash",
  async (targetId) => {
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(SkipLink, { targetId }),
          createElement("button", null, "Navigation"),
          createElement("div", { id: targetId, tabIndex: -1 }, "Content"),
        ),
      ),
    );
    const link = container.querySelector("a")!;
    const target = document.getElementById(targetId)!;
    expect(link.textContent).toBe("Skip to content");
    expect(link.getAttribute("href")).toBe(`#${targetId}`);
    expect(link.className).toContain("-translate-y-full");
    expect(link.className).toContain("focus:translate-y-0");
    link.focus();
    await act(async () => link.click());
    expect(document.activeElement).toBe(target);
    expect(target.tabIndex).toBe(-1);
    expect(window.location.pathname).toBe("/app/settings/appearance");
    expect(window.location.hash).toBe("");
  },
);
