// @vitest-environment happy-dom
import { act, createElement, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AppErrorBoundary } from "../../src/client/app/AppErrorBoundary";

it("offers a reload without showing private exception details", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container, { onCaughtError: () => {} });
  const reload = vi
    .spyOn(window.location, "reload")
    .mockImplementation(() => {});
  function BrokenPage(): never {
    throw new Error("PRIVATE client and credential details");
  }
  try {
    await act(async () =>
      root.render(
        createElement(AppErrorBoundary, null, createElement(BrokenPage)),
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This page couldn’t load",
    );
    expect(container.textContent).not.toContain("PRIVATE");
    await act(async () => container.querySelector("button")!.click());
    expect(reload).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("handles a rejected lazy page without exposing the chunk error or retrying a mutation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container, { onCaughtError: () => {} });
  const load = vi.fn(() =>
    Promise.reject(new Error("PRIVATE chunk URL and response")),
  );
  const Page = lazy(load);
  try {
    await act(async () =>
      root.render(
        createElement(
          AppErrorBoundary,
          null,
          createElement(
            Suspense,
            {
              fallback: createElement("p", { role: "status" }, "Loading page…"),
            },
            createElement(Page),
          ),
        ),
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This page couldn’t load",
    );
    expect(container.textContent).not.toContain("PRIVATE");
    expect(load).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
