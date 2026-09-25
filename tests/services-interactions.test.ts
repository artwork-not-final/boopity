// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "../src/client/Workspace";
import { navigateLocal } from "../src/client/workspace-location";
import { SEARCH_DELAY_MS } from "../src/client/live-search";

const original = {
  id: "walking",
  name: "Dog walking",
  description: "Private legacy description",
  durationMinutes: 30 as number | null,
  priceCents: 3000,
  additionalPetPriceCents: 1000,
  isActive: 1,
  portalVisible: 1,
};
type Request = {
  route: string;
  method: string;
  query: URLSearchParams;
  body: unknown;
  signal: AbortSignal | null | undefined;
};
let services: (typeof original)[];
let requests: Request[];
let respond: (request: Request) => Response | Promise<Response> | undefined;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  services = [original, { ...original, id: "sitting", name: "Pet sitting" }];
  requests = [];
  respond = () => undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options: RequestInit) => {
      const url = new URL(path, window.location.origin);
      const request = {
        route: url.pathname.replace("/api/business", ""),
        method: options.method ?? "GET",
        query: url.searchParams,
        body: options.body
          ? (JSON.parse(String(options.body)) as unknown)
          : undefined,
        signal: options.signal,
      };
      requests.push(request);
      const response = respond(request);
      if (response) return response;
      if (request.route === "/policy")
        return Response.json({
          policy: {
            version: 1,
            portalEnabled: true,
            approvalMode: "request",
            leadHours: 24,
            horizonDays: 90,
            cancelHours: 24,
            requestHoldHours: 24,
            weekly: [],
            blockedDates: [],
          },
          regional: { timeZone: "America/New_York", currency: "USD" },
        });
      if (request.route === "/services") {
        const search = request.query.get("search") ?? "";
        const offset = Number(request.query.get("offset"));
        const matches = services.filter((service) =>
          service.name.toLowerCase().includes(search.toLowerCase()),
        );
        return Response.json({
          services: matches.slice(offset, offset + 50),
          pagination: {
            offset,
            limit: 50,
            hasMore: matches.length > offset + 50,
          },
        });
      }
      if (
        request.method === "GET" &&
        request.route.startsWith("/owner/services/")
      ) {
        const service = services.find(
          (service) => request.route === `/owner/services/${service.id}`,
        );
        if (service) return Response.json({ service });
      }
      if (
        request.method !== "GET" &&
        request.route.startsWith("/owner/services")
      )
        return Response.json({ ok: true });
      throw new Error(
        `Unexpected test request: ${request.method} ${request.route}`,
      );
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount(path = "/app/rates") {
  window.history.replaceState(null, "", path);
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
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (element) =>
      element.textContent?.trim() === label ||
      element.getAttribute("aria-label") === label,
  );
  expect(found, `Button: ${label}`).toBeDefined();
  return found!;
}
function input(label: string) {
  const found = [...container.querySelectorAll("label")].find(
    (element) => element.textContent?.trim() === label,
  );
  expect(found, `Label: ${label}`).toBeDefined();
  const control = found!.htmlFor
    ? document.getElementById(found!.htmlFor)
    : found!.querySelector("input");
  expect(control).toBeInstanceOf(HTMLInputElement);
  return control as HTMLInputElement;
}
async function enter(label: string, value: string) {
  await act(async () => {
    const control = input(label);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function submit() {
  // Happy DOM's floating-point modulo rejects valid decimal step values.
  // Exercise React's submit handler here; services-ui covers native constraints.
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
function mutations() {
  return requests.filter((request) => request.method !== "GET");
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("services workspace interactions", () => {
  it("keeps live search and pagination when returning from an editor", async () => {
    services = Array.from({ length: 12 }, (_, index) => ({
      ...original,
      id: `walking-${index}`,
      name: `Dog walking ${index}`,
    }));
    await mount();
    expect(
      container.querySelectorAll('[aria-label="Services"] li'),
    ).toHaveLength(10);
    await click("Next services page");
    expect(
      container.querySelectorAll('[aria-label="Services"] li'),
    ).toHaveLength(2);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Services"] button')!
        .click(),
    );
    expect(window.location.pathname).toBe("/app/rates/walking-10");
    await click("Back to services");
    expect(container.textContent).toContain("Page 2");
    vi.useFakeTimers();
    await enter("Search services by name", "Dog walking 1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS);
    });
    expect(requests.at(-1)?.query.get("search")).toBe("Dog walking 1");
    expect(requests.at(-1)?.query.get("offset")).toBe("0");
    expect(
      container.querySelectorAll('[aria-label="Services"] li'),
    ).toHaveLength(3);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Services"] button')!
        .click(),
    );
    await click("Cancel");
    expect(input("Search services by name").value).toBe("Dog walking 1");
    expect(
      container.querySelectorAll('[aria-label="Services"] li'),
    ).toHaveLength(3);
    expect(mutations()).toHaveLength(0);
  });

  it("creates an all-day service using the existing payload and returns to the list", async () => {
    await mount();
    await click("New service");
    expect(window.location.pathname).toBe("/app/rates/new");
    await enter("Service name", "Overnight care");
    await act(async () => input("All-day / multi-day care").click());
    await enter("Price per day (USD)", "45.50");
    await enter("Additional-pet price (USD)", "12.25");
    await submit();
    expect(mutations()).toMatchObject([
      {
        route: "/owner/services",
        method: "POST",
        body: {
          name: "Overnight care",
          description: "",
          durationMinutes: null,
          price: 45.5,
          additionalPetPrice: 12.25,
        },
      },
    ]);
    expect(window.location.pathname).toBe("/app/rates");
    expect(container.textContent).toContain("Service saved.");
  });

  it("preserves the latest private description when saving edited details and rates", async () => {
    await mount("/app/rates/walking");
    await enter("Service name", "Long walk");
    await enter("Visit length (minutes)", "60");
    await enter("Price per visit (USD)", "55.75");
    await enter("Additional-pet price (USD)", "0");
    services = [{ ...original, description: "Changed elsewhere" }];
    await submit();
    expect(mutations()).toMatchObject([
      {
        route: "/owner/services/walking",
        method: "PUT",
        body: {
          name: "Long walk",
          description: "Changed elsewhere",
          durationMinutes: 60,
          price: 55.75,
          additionalPetPrice: 0,
        },
      },
    ]);
    const saved = requests.findIndex((request) => request.method === "PUT");
    expect(requests[saved - 1]).toMatchObject({
      route: "/owner/services/walking",
      method: "GET",
    });
    expect(window.location.pathname).toBe("/app/rates");
  });

  it("retains the mounted draft after a failed save and only retries when submitted again", async () => {
    await mount("/app/rates/walking");
    const name = input("Service name");
    await enter("Service name", "Unsaved walk");
    respond = (request) =>
      request.method === "PUT"
        ? Response.json({ error: "Save unavailable" }, { status: 503 })
        : undefined;
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Save unavailable",
    );
    expect(input("Service name")).toBe(name);
    expect(name.value).toBe("Unsaved walk");
    expect(window.location.pathname).toBe("/app/rates/walking");
    expect(mutations()).toHaveLength(1);
    expect(button("Save service").disabled).toBe(false);
    respond = () => undefined;
    await submit();
    expect(mutations()).toHaveLength(2);
    expect(window.location.pathname).toBe("/app/rates");
  });

  it("does not overwrite a description when its pre-save read fails", async () => {
    await mount("/app/rates/walking");
    await enter("Service name", "Unsaved walk");
    respond = (request) =>
      request.route === "/owner/services/walking"
        ? Response.json({ error: "Details unavailable" }, { status: 503 })
        : undefined;
    await submit();
    expect(mutations()).toHaveLength(0);
    expect(input("Service name").value).toBe("Unsaved walk");
    expect(container.textContent).toContain("Details unavailable");
  });

  it("keeps rate drafts through visibility, archive, and reactivation changes and pauses resume refresh", async () => {
    await mount("/app/rates/walking");
    const name = input("Service name");
    await enter("Service name", "Unsaved walk");
    await enter("Price per visit (USD)", "48.25");
    const count = requests.length;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(requests).toHaveLength(count);
    const pending = deferred();
    respond = (request) =>
      request.route.endsWith("/visibility") ? pending.promise : undefined;
    await act(async () => input("Offer in the client portal").click());
    expect(input("Offer in the client portal").disabled).toBe(true);
    expect(button("Archive service").disabled).toBe(true);
    expect(button("Save service").disabled).toBe(true);
    expect(button("Back to services").disabled).toBe(true);
    await act(async () => pending.resolve(Response.json({ ok: true })));
    expect(input("Offer in the client portal").checked).toBe(false);
    await click("Archive service");
    await click("Reactivate service");
    expect(input("Service name")).toBe(name);
    expect(name.value).toBe("Unsaved walk");
    expect(input("Price per visit (USD)").value).toBe("48.25");
    expect(input("Offer in the client portal").checked).toBe(false);
    expect(mutations()).toMatchObject([
      {
        route: "/owner/services/walking/visibility",
        method: "PUT",
        body: { visible: false },
      },
      { route: "/owner/services/walking/archive", method: "POST", body: {} },
      { route: "/owner/services/walking/reactivate", method: "POST", body: {} },
    ]);
    expect(
      requests.filter((request) => request.route === "/owner/services/walking"),
    ).toHaveLength(1);
  });

  it("does not change availability or discard a draft when immediate actions fail", async () => {
    await mount("/app/rates/walking");
    await enter("Service name", "Keep this draft");
    respond = (request) =>
      request.method !== "GET"
        ? Response.json({ error: "Change unavailable" }, { status: 503 })
        : undefined;
    await act(async () => input("Offer in the client portal").click());
    expect(input("Offer in the client portal").checked).toBe(true);
    await click("Archive service");
    expect(button("Archive service").disabled).toBe(false);
    expect(input("Service name").value).toBe("Keep this draft");
    expect(container.textContent).toContain("Change unavailable");
  });

  it("retries detail reads and ignores an aborted response after navigating to another service", async () => {
    respond = (request) =>
      request.route === "/owner/services/walking"
        ? Response.json({ error: "Load unavailable" }, { status: 503 })
        : undefined;
    await mount("/app/rates/walking");
    expect(container.textContent).toContain("Load unavailable");
    const late = deferred();
    respond = (request) =>
      request.route === "/owner/services/walking" ? late.promise : undefined;
    await click("Try again");
    expect(container.textContent).toContain("Loading service…");
    const oldRequest = requests.at(-1)!;
    await act(async () => navigateLocal("/app/rates/sitting"));
    expect(oldRequest.signal?.aborted).toBe(true);
    expect(input("Service name").value).toBe("Pet sitting");
    await act(async () => late.resolve(Response.json({ service: original })));
    expect(input("Service name").value).toBe("Pet sitting");
    respond = () => undefined;
    await act(async () => {
      window.history.replaceState(null, "", "/app/rates/walking");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(input("Service name").value).toBe("Dog walking");
    expect(mutations()).toHaveLength(0);
  });
});
