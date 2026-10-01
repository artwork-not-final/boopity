// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Workspace } from "../../src/client/app/Workspace";
import type { Data } from "../../src/client/lib/types/workspace-types";

let container: HTMLDivElement;
let root: Root;
let policy: Data["policy"];
let saved: Data["policy"] | undefined;
let writes: number;
let finishSave: (response: Response) => void;
let finishReload: (response: Response) => void;

function policyResponse() {
  return Response.json({
    policy,
    regional: { timeZone: "America/New_York", currency: "USD" },
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/app/rules");
  policy = {
    version: 1,
    portalEnabled: true,
    approvalMode: "request",
    leadHours: 12,
    horizonDays: 60,
    cancelHours: 48,
    requestHoldHours: 36,
    weekly: [{ day: 1, start: "08:30", end: "18:00" }],
    blockedDates: [],
  };
  saved = undefined;
  writes = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      if (url === "/api/business/policy") {
        if (!writes) return Promise.resolve(policyResponse());
        return new Promise<Response>((resolve) => {
          finishReload = resolve;
        });
      }
      expect(url).toBe("/api/business/owner/policy");
      expect(init.method).toBe("PUT");
      writes += 1;
      saved = JSON.parse(init.body as string) as Data["policy"];
      return new Promise<Response>((resolve) => {
        finishSave = resolve;
      });
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () =>
    root.render(
      createElement(Workspace, {
        session: {
          role: "owner",
          user: { name: "Owner", email: "owner@example.test" },
        },
        openSettings: () => {},
        recheckAccess: async () => {},
      }),
    ),
  );
}

function form() {
  return container.querySelector<HTMLFormElement>(
    'form[aria-label="Portal and booking rules"]',
  )!;
}

function leadHours() {
  const label = [...form().querySelectorAll("label")].find(
    (element) => element.textContent === "Minimum booking notice (hours)",
  )!;
  return document.getElementById(label.htmlFor) as HTMLInputElement;
}

async function enterHours(value: string) {
  const input = leadHours();
  expect(isDisabled(input)).toBe(false);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function isDisabled(control: Element) {
  // Happy DOM's :disabled only checks the control's own attribute. Browsers
  // also disable descendants of a disabled fieldset (these are outside legends).
  return (
    control.hasAttribute("disabled") ||
    Boolean(control.closest("fieldset[disabled]"))
  );
}

function expectLocked() {
  const controls = [
    ...form().querySelectorAll("input, textarea, select, button"),
  ];
  expect(controls.length).toBeGreaterThan(20);
  for (const control of controls)
    expect(isDisabled(control), control.outerHTML).toBe(true);
}

it("locks every rule control through the save and version reload, then allows new edits", async () => {
  await mount();
  await enterHours("24");
  await act(async () => form().requestSubmit());
  expect(saved?.leadHours).toBe(24);
  expectLocked();

  // The custom choice is explicitly disabled as well, including its popup.
  await act(async () => {
    form().querySelector<HTMLButtonElement>('[role="combobox"]')!.click();
    form().dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  expect(
    form().querySelector('[role="combobox"]')?.getAttribute("aria-expanded"),
  ).toBe("false");
  expect(writes).toBe(1);

  await act(async () => {
    policy = { ...saved!, version: 2 };
    finishSave(Response.json({ ok: true }));
  });
  expectLocked();
  expect(leadHours().value).toBe("24");
  await act(async () => finishReload(policyResponse()));
  expect(leadHours().value).toBe("24");
  expect(isDisabled(leadHours())).toBe(false);
  expect(form().querySelector('[role="status"]')?.textContent).toBe("Saved");
  // Closed days stay disabled; open days and the remaining controls unlock.
  expect(form().querySelectorAll('input[type="time"]:disabled')).toHaveLength(
    12,
  );
  expect(
    form().querySelectorAll(
      'input[type="checkbox"]:disabled, textarea:disabled, button:disabled, select:disabled',
    ),
  ).toHaveLength(0);
  await enterHours("48");
  expect(leadHours().value).toBe("48");
  expect(form().querySelector('[role="status"]')?.textContent).toBe("");
});

it.each(["save", "reload"])(
  "unlocks the rules draft after a failed %s so it can be corrected and retried",
  async (failure) => {
    await mount();
    await enterHours("24");
    await act(async () => form().requestSubmit());
    expectLocked();
    await act(async () =>
      finishSave(
        failure === "save"
          ? Response.json({ error: "Save unavailable" }, { status: 503 })
          : Response.json({ ok: true }),
      ),
    );
    if (failure === "reload") {
      expectLocked();
      await act(async () =>
        finishReload(
          Response.json({ error: "Reload unavailable" }, { status: 503 }),
        ),
      );
    }
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "unavailable",
    );
    expect(leadHours().value).toBe("24");
    await enterHours("48");
    await act(async () => form().requestSubmit());
    expect(writes).toBe(2);
    expect(saved?.leadHours).toBe(48);
    expectLocked();
    await act(async () => {
      policy = { ...saved!, version: 2 };
      finishSave(Response.json({ ok: true }));
    });
    await act(async () => finishReload(policyResponse()));
    expect(leadHours().value).toBe("48");
    expect(isDisabled(leadHours())).toBe(false);
  },
);
