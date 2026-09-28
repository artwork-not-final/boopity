// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ActionConfirmation,
  ActionFeedbackProvider,
  SavedStatus,
  useSaveFeedback,
} from "../../src/client/components/feedback/ActionFeedback";
import type { ActionFeedback } from "../../src/client/lib/types/action-feedback";

let container: HTMLDivElement;
let root: Root;
const dismiss = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  dismiss.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function Editor({ draft }: { draft: string }) {
  const feedback = useSaveFeedback("test-form", [draft]);
  return createElement(SavedStatus, { feedback });
}
async function render(
  feedback: ActionFeedback,
  draft = "initial",
  key = "first",
  busy = false,
) {
  await act(async () =>
    root.render(
      createElement(ActionFeedbackProvider, {
        feedback,
        dismiss,
        busy,
        children: [
          createElement(ActionConfirmation, {
            key: "confirmation",
            feedback,
            dismiss,
          }),
          createElement(Editor, { key, draft }),
        ],
      }),
    ),
  );
}

it("announces routine list saves without a visible banner or dismiss button", async () => {
  await render({ announcement: "Service saved." });
  const status = container.querySelector('[role="status"]');
  expect(status?.classList.contains("sr-only")).toBe(true);
  expect(status?.textContent).toBe("Service saved.");
  expect(container.querySelector("button")).toBeNull();
});

it("keeps inline confirmation through a refreshed form remount, then clears it on editing", async () => {
  await render("");
  expect(container.textContent).toBe("");
  await render({ saved: "test-form" });
  expect(container.textContent).toBe("Saved");
  await render({ saved: "test-form" }, "server-confirmed", "refreshed");
  expect(container.textContent).toBe("Saved");
  expect(dismiss).not.toHaveBeenCalled();
  await render({ saved: "test-form" }, "unsaved edit", "refreshed");
  expect(dismiss).toHaveBeenCalledOnce();
});

it("does not claim a newer draft was saved if it changed during an in-flight save", async () => {
  await render("");
  await render("", "initial", "first", true);
  await render("", "unsaved edit", "first", true);
  await render({ saved: "test-form" }, "unsaved edit");
  expect(dismiss).toHaveBeenCalledOnce();
});

it("does not clear another form's result or an important confirmation when a draft changes", async () => {
  await render({ saved: "another-form" });
  expect(container.textContent).toBe("");
  await render({ saved: "another-form" }, "edit");
  await render("Invitation created.", "another edit");
  expect(dismiss).not.toHaveBeenCalled();
  expect(container.textContent).toBe("Invitation created.");
});

it.each(["Payment recorded.", "Invitation created.", "Booking cancelled."])(
  "keeps %s noticeable until explicitly dismissed, without moving focus",
  async (message) => {
    vi.useFakeTimers();
    const focused = document.createElement("button");
    // The notice never calls focus; test from outside the React root.
    document.body.append(focused);
    focused.focus();
    await render(message);
    expect(document.activeElement).toBe(focused);
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe(message);
    expect(status?.classList.contains("sr-only")).toBe(false);
    expect(status?.parentElement?.classList.contains("border-l-4")).toBe(true);
    expect(status?.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(dismiss).not.toHaveBeenCalled();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Dismiss confirmation"]',
        )!
        .click(),
    );
    expect(dismiss).toHaveBeenCalledOnce();
    focused.remove();
  },
);

it("renders confirmation text as text, not markup", async () => {
  await render("<img src=x onerror=alert(1)>");
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
});
