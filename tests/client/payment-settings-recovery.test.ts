// @vitest-environment happy-dom
import { StrictMode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PaymentSettings } from "../../src/client/features/payments/PaymentSettings";
import type { PaymentSettingsData } from "../../src/shared/api-responses";

const roots: Root[] = [];
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
function snapshot(): PaymentSettingsData {
  return {
    settings: { mode: "test", version: 1 },
    integrations: [
      {
        id: "",
        mode: "test",
        provider: "stripe",
        version: 0,
        enabled: false,
        managed: false,
        keyPresent: false,
        webhookSecretPresent: false,
        verified: false,
        webhookVerified: false,
        accountId: null,
        webhookUrl: "https://example.test/api/payments/webhooks/stripe/test",
        apiVersion: "test-version",
        capabilities: { checkout: true, refunds: true, expire: true },
      },
    ],
  };
}
async function mount(strict = false) {
  const container = document.createElement("div"),
    root = createRoot(container);
  roots.push(root);
  const errors: unknown[] = [];
  const onError = vi.fn(async () => {});
  await act(async () => {
    const page = createElement(PaymentSettings, {
      busy: false,
      onError,
      run: async (work) => {
        try {
          await work();
        } catch (error) {
          errors.push(error);
        }
      },
    });
    root.render(strict ? createElement(StrictMode, null, page) : page);
  });
  return { container, root, onError, errors };
}
function button(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  expect(found).toBeDefined();
  return found!;
}
async function enter(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("offers retry after the initial load fails, including malformed success responses", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(Response.json(snapshot()));
  vi.stubGlobal("fetch", fetch);
  const { container, onError } = await mount();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Loading payment setup");
  await act(async () => button(container, "Retry payment setup").click());
  expect(container.textContent).toContain("unexpected response");
  await act(async () => button(container, "Retry payment setup").click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("Stripe · sandbox");
  expect(onError).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledTimes(3);
  for (const call of fetch.mock.calls) expect(call[1].method).toBe("GET");
});

it("keeps unsaved credentials mounted through refresh, failure, and retry", async () => {
  const pending = deferred();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(Response.json(snapshot()))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(Response.json(snapshot())),
  );
  const { container } = await mount();
  const key = container.querySelector<HTMLInputElement>(
    'input[type="password"]',
  )!;
  await enter(key, "synthetic-unsaved-key");
  await act(async () => button(container, "Refresh payment setup").click());
  expect(button(container, "Save Stripe credentials").disabled).toBe(true);
  expect(container.querySelector('input[type="password"]')).toBe(key);
  await act(async () =>
    pending.resolve(
      Response.json({ error: "Temporary outage" }, { status: 503 }),
    ),
  );
  expect(key.value).toBe("synthetic-unsaved-key");
  expect(button(container, "Save Stripe credentials").disabled).toBe(true);
  await act(async () => button(container, "Retry payment setup").click());
  expect(container.querySelector('input[type="password"]')).toBe(key);
  expect(key.value).toBe("synthetic-unsaved-key");
  expect(button(container, "Save Stripe credentials").disabled).toBe(false);
});

it("does not repeat a saved credential change when its follow-up refresh fails", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(snapshot()))
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json(snapshot()));
  vi.stubGlobal("fetch", fetch);
  const { container, errors } = await mount();
  const key = container.querySelector<HTMLInputElement>(
    'input[type="password"]',
  )!;
  await enter(key, "synthetic-new-key");
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(String(errors[0])).toContain("Your change was saved");
  await act(async () => button(container, "Retry payment setup").click());
  expect(fetch.mock.calls.map((call) => call[1].method)).toEqual([
    "GET",
    "PUT",
    "GET",
    "GET",
  ]);
  expect(key.value).toBe("");
});

it("ignores superseded responses in StrictMode and cancels on unmount", async () => {
  const first = deferred(),
    second = deferred(),
    third = deferred();
  const fetch = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(third.promise);
  vi.stubGlobal("fetch", fetch);
  const { container, root, onError } = await mount(true);
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => second.resolve(Response.json(snapshot())));
  await act(async () => first.resolve(Response.json(null, { status: 401 })));
  expect(container.textContent).toContain("Stripe · sandbox");
  expect(onError).not.toHaveBeenCalled();
  await act(async () => button(container, "Refresh payment setup").click());
  await act(async () => root.unmount());
  roots.splice(roots.indexOf(root), 1);
  expect(fetch.mock.calls[2][1].signal.aborted).toBe(true);
  await act(async () => third.resolve(Response.json({}, { status: 503 })));
  expect(onError).not.toHaveBeenCalled();
});
