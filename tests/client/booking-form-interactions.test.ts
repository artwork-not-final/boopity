// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewBooking } from "../../src/client/features/bookings/NewBooking";
import type { Data } from "../../src/client/lib/types/workspace-types";

const data: Data = {
  policy: {
    version: 1,
    portalEnabled: true,
    approvalMode: "request",
    leadHours: 24,
    horizonDays: 90,
    cancelHours: 24,
    requestHoldHours: 24,
    weekly: Array.from({ length: 7 }, (_, day) => ({
      day,
      start: "09:00",
      end: "17:00",
    })),
    blockedDates: [],
  },
  regional: { timeZone: "America/New_York", currency: "USD" },
  revision: 1,
};
type Request = {
  path: string;
  query: URLSearchParams;
  body?: Record<string, unknown>;
  signal?: AbortSignal | null;
};
let container: HTMLDivElement, root: Root;
let requests: Request[];
let preview: (request: Request) => Response | Promise<Response>;
const pagination = { offset: 0, limit: 50, hasMore: false };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 28, 12));
  requests = [];
  preview = (request) =>
    Response.json({
      slots: [{ startTime: request.query.get("startTime") ?? "10:00" }],
      historical: request.query.get("startDate") === "2025-09-01",
      overlaps: false,
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options: RequestInit) => {
      const url = new URL(path, window.location.origin);
      const request = {
        path: url.pathname.replace("/api/business", ""),
        query: url.searchParams,
        body: options.body
          ? (JSON.parse(String(options.body)) as Record<string, unknown>)
          : undefined,
        signal: options.signal,
      };
      requests.push(request);
      if (request.path === "/services")
        return Response.json({
          services: [
            {
              id: "walk",
              name: "Walk",
              durationMinutes: 30,
              priceCents: 1500,
              additionalPetPriceCents: 1000,
              isActive: 1,
              portalVisible: 1,
            },
          ],
          pagination,
        });
      if (request.path === "/owner/clients")
        return Response.json({
          clients: [{ id: "alex", firstName: "Alex", lastName: "Example" }],
          pagination,
        });
      if (["/owner/pets", "/pets"].includes(request.path))
        return Response.json({
          pets: [{ id: "scout", name: "Scout", species: "dog" }],
          pagination,
        });
      if (request.path === "/availability") return preview(request);
      if (request.path === "/bookings" && request.body)
        return Response.json({ booking: { id: "saved" } }, { status: 201 });
      throw new Error(`Unexpected test request: ${request.path}`);
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
  vi.restoreAllMocks();
});
async function mount(owner = true, hasHours = true) {
  await act(async () =>
    root.render(
      createElement(NewBooking, {
        owner,
        data: {
          ...data,
          policy: {
            ...data.policy,
            weekly: hasHours ? data.policy.weekly : [],
          },
        },
        busy: false,
        run: async (work) => {
          await work();
        },
        done: () => {},
      }),
    ),
  );
}
function label(text: string) {
  const found = [...container.querySelectorAll("label")].find(
    (node) => node.textContent?.trim() === text,
  );
  expect(found, `Label: ${text}`).toBeDefined();
  return found!;
}
async function select(text: string, value: string) {
  await act(async () => {
    const input = document.getElementById(
      `${label(text).htmlFor}-native`,
    ) as HTMLSelectElement;
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function enter(text: string, value: string) {
  await act(async () => {
    const input = document.getElementById(label(text).htmlFor)!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function toggle(text: string) {
  await act(async () => label(text).querySelector("input")!.click());
}
async function choose(owner = true, date = "2026-10-05") {
  if (owner) await select("Client", "alex");
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('fieldset input[type="checkbox"]')!
      .click(),
  );
  await select("Service", "walk");
  await enter("Start date", date);
}
async function submit() {
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
function submitButton() {
  return container.querySelector<HTMLButtonElement>("aside button")!;
}
function posts() {
  return requests.filter((request) => request.path === "/bookings");
}

describe("booking scheduling interactions", () => {
  it("submits normal sitter bookings without implicit exceptions", async () => {
    await mount();
    await choose();
    await select("Available start time", "10:00");
    expect(submitButton().disabled).toBe(false);
    await submit();
    expect(posts()[0].body).toMatchObject({
      clientId: "alex",
      petIds: ["scout"],
      startTime: "10:00",
    });
    expect(posts()[0].body).not.toHaveProperty("overrides");
  });

  it("uses explicit times for outside hours, sends selected exceptions and clears stale times when turned off", async () => {
    await mount();
    await choose();
    await select("Available start time", "10:00");
    await toggle("Book outside opening hours");
    expect(submitButton().disabled).toBe(true);
    await enter("Start time", "03:07");
    await toggle("Waive minimum booking notice (24 hours)");
    expect(submitButton().disabled).toBe(false);
    await submit();
    expect(posts()[0].body).toMatchObject({
      startTime: "03:07",
      overrides: { outsideHours: true, waiveNotice: true },
    });
    const last = requests.filter((r) => r.path === "/availability").at(-1)!;
    expect(last.query.get("outsideHours")).toBe("true");
    expect(last.query.get("waiveNotice")).toBe("true");
    await toggle("Book outside opening hours");
    expect(submitButton().disabled).toBe(true);
    expect(
      document.getElementById(label("Available start time").htmlFor),
    ).not.toBeNull();
    await submit();
    expect(posts()).toHaveLength(1);
  });

  it("waits for fresh availability after an exception changes and ignores an older response", async () => {
    await mount();
    await choose();
    await select("Available start time", "10:00");
    const pending: {
      request: Request;
      resolve: (response: Response) => void;
    }[] = [];
    preview = (request) =>
      new Promise((resolve) => pending.push({ request, resolve }));
    await toggle("Waive minimum booking notice (24 hours)");
    expect(submitButton().disabled).toBe(true);
    await submit();
    expect(posts()).toHaveLength(0);
    await toggle("Waive minimum booking notice (24 hours)");
    expect(pending[0].request.signal?.aborted).toBe(true);
    await act(async () =>
      pending[0].resolve(Response.json({ slots: [{ startTime: "10:00" }] })),
    );
    expect(submitButton().disabled).toBe(true);
    await act(async () => pending[1].resolve(Response.json({ slots: [] })));
    expect(submitButton().disabled).toBe(true);
    expect(container.textContent).toContain("No times available");
  });

  it("explains missing hours without an empty dropdown, and links to the rules page", async () => {
    preview = () => Response.json({ slots: [] });
    await mount(true, false);
    await choose();
    const time = document.getElementById(
      label("Available start time").htmlFor,
    ) as HTMLButtonElement;
    expect(time.disabled).toBe(true);
    expect(time.textContent).toContain("No times available");
    expect(container.textContent).toContain("No booking hours are set");
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Set your booking hours",
    )!;
    await act(async () => button.click());
    expect(window.location.pathname).toBe("/app/rules");
    expect(posts()).toHaveLength(0);
  });

  it("still records ended work without opening hours or an exception", async () => {
    await mount(true, false);
    await choose(true, "2025-09-01");
    await enter("Start time", "03:07");
    expect(container.textContent).toContain("recorded as completed");
    expect(container.textContent).not.toContain("Need to make an exception?");
    expect(container.textContent).not.toContain("No booking hours are set");
    expect(submitButton().disabled).toBe(false);
    await submit();
    expect(posts()[0].body).not.toHaveProperty("overrides");
  });

  it("never offers sitter exceptions to clients or includes them in client requests", async () => {
    await mount(false);
    await choose(false);
    expect(container.textContent).not.toContain("Need to make an exception?");
    await select("Available start time", "10:00");
    await submit();
    expect(posts()[0].body).not.toHaveProperty("overrides");
    expect(posts()[0].body).not.toHaveProperty("clientId");
  });
});
