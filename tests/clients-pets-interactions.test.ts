// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "../src/client/Workspace";
import { navigateLocal } from "../src/client/workspace-location";
import { SEARCH_DELAY_MS } from "../src/client/live-search";

const alice = {
  id: "alice",
  firstName: "Alice",
  lastName: "Example",
  email: "alice@example.test",
  phone: "2025550123",
  address: "Example lane",
  notes: "Private client note",
  status: "active",
  emergencyContactName: "Alex",
  emergencyContactPhone: "2025550124",
  petCount: 1,
  members: 0,
  invitationExpiresAt: null,
};
const scout = {
  id: "scout",
  clientId: "alice",
  name: "Scout",
  species: "dog",
  breed: "Retriever" as string | null,
  isActive: true,
  medicalConditions: null as string | null,
  medications: "With food",
  allergies: null as string | null,
  feedingInstructions: "Twice daily",
  specialInstructions: "Use the side gate",
  sitterNotes: "Private pet note",
  color: "Gold",
  weight: 22,
  dateOfBirth: null,
  spayedNeutered: true,
  microchipped: true,
  microchipId: "synthetic-chip",
  vaccinationsCurrent: true,
  behaviorNotes: "Gentle",
  vetName: "Example vet",
  vetPhone: "2025550125",
  vetClinic: "Example clinic",
  photoUrl: null,
};
type Request = {
  route: string;
  method: string;
  query: URLSearchParams;
  body: unknown;
  signal: AbortSignal | null | undefined;
};
let clients: (typeof alice)[];
let pets: (typeof scout)[];
let portalEnabled: boolean;
let requests: Request[];
let respond: (request: Request) => Response | Promise<Response> | undefined;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clients = [
    alice,
    { ...alice, id: "bob", firstName: "Bob", email: "bob@example.test" },
  ];
  pets = [
    scout,
    {
      ...scout,
      id: "clover",
      clientId: "bob",
      name: "Clover",
      species: "rabbit",
    },
  ];
  portalEnabled = true;
  requests = [];
  respond = () => undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options: RequestInit) => {
      const url = new URL(path, window.location.origin);
      const request: Request = {
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
      const { route, method, query } = request;
      if (route === "/policy")
        return Response.json({
          policy: {
            version: 1,
            portalEnabled,
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
      const search = (query.get("search") ?? "").toLowerCase();
      const offset = Number(query.get("offset"));
      const page = <T>(rows: T[]) => ({
        rows: rows.slice(offset, offset + 50),
        pagination: { offset, limit: 50, hasMore: rows.length > offset + 50 },
      });
      if (method === "GET" && route === "/owner/clients") {
        const result = page(
          clients.filter(
            (client) =>
              (query.get("status") === "all" ||
                query.get("status") === client.status) &&
              `${client.firstName} ${client.lastName} ${client.email} ${client.phone}`
                .toLowerCase()
                .includes(search),
          ),
        );
        return Response.json({
          clients: result.rows,
          pagination: result.pagination,
        });
      }
      if (method === "GET" && route === "/owner/pets") {
        const result = page(
          pets.filter(
            (pet) =>
              pet.clientId === query.get("clientId") &&
              pet.name.toLowerCase().includes(search),
          ),
        );
        return Response.json({
          pets: result.rows,
          pagination: result.pagination,
        });
      }
      if (method === "GET" && route === "/pets") {
        const result = page(
          pets
            .filter((pet) => pet.clientId === "alice")
            .map(({ id, name, species, breed, isActive }) => ({
              id,
              name,
              species,
              breed,
              isActive,
            })),
        );
        return Response.json({
          pets: result.rows,
          pagination: result.pagination,
        });
      }
      if (method === "GET") {
        const client = clients.find(
          (client) => route === `/owner/clients/${client.id}`,
        );
        if (client) return Response.json({ client });
        const pet = pets.find((pet) => route === `/owner/pets/${pet.id}`);
        if (pet) return Response.json({ pet });
      }
      if (method === "POST" && route.endsWith("/invitation"))
        return Response.json({
          url: `${window.location.origin}/login#invite=synthetic-${route.split("/")[3]}`,
        });
      if (method === "PUT" && route.startsWith("/owner/clients/"))
        return Response.json({
          client: clients.find((client) => route.endsWith(client.id)),
        });
      if (
        method !== "GET" &&
        (route.startsWith("/owner/clients/") ||
          route.startsWith("/owner/pets/"))
      )
        return Response.json({ ok: true });
      throw new Error(`Unexpected test request: ${method} ${route}`);
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
async function mount(
  path = "/app/clients/alice",
  role: "owner" | "client" = "owner",
) {
  window.history.replaceState(null, "", path);
  await act(async () =>
    root.render(
      createElement(Workspace, {
        session: {
          role,
          user: { name: "Test user", email: "user@example.test" },
          ...(role === "client" ? { clientId: "alice" } : {}),
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
function control(label: string) {
  const found = [...container.querySelectorAll("label")].find(
    (element) => element.textContent?.trim() === label,
  );
  expect(found, `Label: ${label}`).toBeDefined();
  const control = document.getElementById(found!.htmlFor);
  expect(control).not.toBeNull();
  return control!;
}
function field(label: string) {
  const element = control(label);
  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLTextAreaElement)
  )
    throw new Error(`Expected a text field: ${label}`);
  return element;
}
async function enter(label: string, value: string) {
  await act(async () => {
    const control = field(label);
    const prototype =
      control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      control,
      value,
    );
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function submit(label: string) {
  await act(async () =>
    container
      .querySelector<HTMLFormElement>(`form[aria-label="${label}"]`)!
      .requestSubmit(),
  );
}
async function choose(label: string, value: string) {
  // Exercise Choice's native change/autofill path, not its popup keyboard UI.
  await act(async () => {
    const select = control(label).parentElement!.querySelector("select")!;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
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

describe("client and pet workspace interactions", () => {
  it("keeps list pagination, status, and live search across pet-shortcut navigation", async () => {
    clients = Array.from({ length: 12 }, (_, index) => ({
      ...alice,
      id: `client-${index}`,
      firstName: `Client ${index}`,
    }));
    await mount("/app/clients");
    await click("Next clients page");
    expect(
      container.querySelectorAll('[aria-label="Clients"] li'),
    ).toHaveLength(2);
    await act(async () =>
      container
        .querySelectorAll<HTMLButtonElement>(
          '[aria-label="Clients"] li button',
        )[1]
        .click(),
    );
    expect(window.location.pathname).toBe("/app/clients/client-10/pets");
    await click("Back to clients");
    expect(container.textContent).toContain("Page 2");
    await choose("Client status", "active");
    expect(requests.at(-1)?.query.get("offset")).toBe("0");
    vi.useFakeTimers();
    await enter("Search by name, email, or phone", "Client 1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS);
    });
    expect(
      container.querySelectorAll('[aria-label="Clients"] li'),
    ).toHaveLength(3);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Clients"] button')!
        .click(),
    );
    await click("Back to clients");
    expect(field("Search by name, email, or phone").value).toBe("Client 1");
    const lastList = requests
      .filter((request) => request.route === "/owner/clients")
      .at(-1)!;
    expect(lastList.query.get("status")).toBe("active");
    expect(mutations()).toHaveLength(0);
  });

  it("creates a client and opens the saved client's contact page", async () => {
    await mount("/app/clients/new");
    await enter("First name", "Taylor");
    await enter("Last name", "Example");
    await enter("Client email", "taylor@example.test");
    respond = (request) => {
      if (request.route !== "/owner/clients" || request.method !== "POST")
        return;
      const saved = {
        ...alice,
        id: "taylor",
        firstName: "Taylor",
        email: "taylor@example.test",
      };
      clients.push(saved);
      return Response.json({ client: saved });
    };
    await submit("New client");
    expect(mutations()).toMatchObject([
      {
        route: "/owner/clients",
        method: "POST",
        body: {
          firstName: "Taylor",
          lastName: "Example",
          email: "taylor@example.test",
          status: "active",
        },
      },
    ]);
    expect(window.location.pathname).toBe("/app/clients/taylor");
    expect(field("First name").value).toBe("Taylor");
  });

  it("retains contact and pet drafts across tabs, portal updates, and resume events", async () => {
    await mount();
    const contact = field("First name");
    await enter("First name", "Unsaved Alice");
    await click("Pets");
    await act(async () => navigateLocal("/app/clients/alice/pets/scout"));
    const notes = field("Private sitter notes");
    await enter("Private sitter notes", "Unsaved care note");
    const count = requests.length;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(requests).toHaveLength(count);
    expect(field("Private sitter notes")).toBe(notes);
    expect(notes.value).toBe("Unsaved care note");
    await click("Portal access");
    await click("Revoke portal access");
    expect(field("First name")).toBe(contact);
    expect(field("Private sitter notes")).toBe(notes);
    await click("Pets");
    expect(window.location.pathname).toBe("/app/clients/alice/pets/scout");
    expect(field("Private sitter notes")).toBe(notes);
    expect(notes.value).toBe("Unsaved care note");
    await click("Contact");
    expect(contact.value).toBe("Unsaved Alice");
    expect(
      requests.filter((request) => request.route === "/owner/pets/scout"),
    ).toHaveLength(1);
  });

  it("retains a failed contact save and sends no extra write until resubmitted", async () => {
    await mount();
    await enter("Phone", "2025550199");
    const phone = field("Phone");
    respond = (request) =>
      request.method === "PUT"
        ? Response.json({ error: "Save unavailable" }, { status: 503 })
        : undefined;
    await submit("Edit client");
    expect(container.textContent).toContain("Save unavailable");
    expect(field("Phone")).toBe(phone);
    expect(phone.value).toBe("2025550199");
    expect(mutations()).toHaveLength(1);
    respond = () => undefined;
    await submit("Edit client");
    expect(mutations()).toHaveLength(2);
    expect(mutations()[1]).toMatchObject({
      route: "/owner/clients/alice",
      method: "PUT",
      body: { phone: "2025550199" },
    });
  });

  it("keeps client drafts through archive/reactivate and disables new pets for archived clients", async () => {
    await mount();
    await enter("First name", "Unsaved Alice");
    respond = (request) => {
      if (
        !request.route.startsWith("/owner/clients/alice/") ||
        request.method !== "POST"
      )
        return;
      clients[0] = {
        ...clients[0],
        status: request.route.endsWith("/archive") ? "archived" : "active",
      };
      return Response.json({ ok: true });
    };
    await click("Archive client");
    expect(field("First name").value).toBe("Unsaved Alice");
    expect(button("Create invitation").disabled).toBe(true);
    expect(
      [...container.querySelectorAll("button")].some(
        (element) => element.textContent?.trim() === "Add pet",
      ),
    ).toBe(false);
    await click("Reactivate client");
    expect(field("First name").value).toBe("Unsaved Alice");
    expect(button("Create invitation").disabled).toBe(false);
    expect(mutations().map((request) => request.route)).toEqual([
      "/owner/clients/alice/archive",
      "/owner/clients/alice/reactivate",
    ]);
  });

  it.each(["portal disabled", "lead", "archived", "no email"])(
    "does not create an invitation with %s",
    async (condition) => {
      if (condition === "portal disabled") portalEnabled = false;
      else
        clients[0] = {
          ...alice,
          ...(condition === "no email" ? { email: "" } : { status: condition }),
        };
      await mount("/app/clients/alice/portal");
      expect(button("Create invitation").disabled).toBe(true);
      await click("Create invitation");
      expect(mutations()).toHaveLength(0);
    },
  );

  it("never shows a delayed invitation response on a different client's page and clears it on revoke", async () => {
    const pending = deferred();
    respond = (request) =>
      request.route.endsWith("/invitation") ? pending.promise : undefined;
    await mount("/app/clients/alice/portal");
    await click("Create invitation");
    expect(button("Back to clients").disabled).toBe(true);
    await act(async () => navigateLocal("/app/clients/bob/portal"));
    await act(async () =>
      pending.resolve(
        Response.json({ url: "http://localhost/login#invite=synthetic-alice" }),
      ),
    );
    expect(container.querySelector("textarea[readonly]")).toBeNull();
    await act(async () => navigateLocal("/app/clients/alice/portal"));
    expect(
      container.querySelector<HTMLTextAreaElement>("textarea[readonly]")?.value,
    ).toContain("synthetic-alice");
    respond = (request) =>
      request.route.endsWith("/revoke")
        ? Response.json({ error: "Revoke unavailable" }, { status: 503 })
        : undefined;
    await click("Revoke portal access");
    expect(container.querySelector("textarea[readonly]")).not.toBeNull();
    respond = () => undefined;
    await click("Revoke portal access");
    expect(container.querySelector("textarea[readonly]")).toBeNull();
    expect(mutations().map((request) => request.route)).toEqual([
      "/owner/clients/alice/invitation",
      "/owner/clients/alice/revoke",
      "/owner/clients/alice/revoke",
    ]);
  });

  it("adds a pet for the selected client without submitting the hidden contact draft", async () => {
    await mount("/app/clients/alice/pets");
    await enter("First name", "Unsaved Alice");
    await click("Add pet");
    expect(window.location.pathname).toBe("/app/clients/alice/pets/new");
    await enter("Pet name", "Juniper");
    await choose("Species", "cat");
    await submit("Add pet");
    expect(mutations()).toMatchObject([
      {
        route: "/owner/pets/clients/alice",
        method: "POST",
        body: { name: "Juniper", species: "cat" },
      },
    ]);
    expect(window.location.pathname).toBe("/app/clients/alice/pets");
    expect(field("First name").value).toBe("Unsaved Alice");
  });

  it("saves care details before private notes and preserves unedited pet fields", async () => {
    await mount("/app/clients/alice/pets/scout");
    await enter("Medical conditions", "Care update");
    await enter("Private sitter notes", "Private update");
    await submit("Care details for Scout");
    expect(mutations()).toMatchObject([
      {
        route: "/owner/pets/scout",
        method: "PUT",
        body: {
          ...scout,
          medicalConditions: "Care update",
          sitterNotes: "Private update",
        },
      },
      {
        route: "/owner/pets/scout/notes",
        method: "PUT",
        body: { notes: "Private update" },
      },
    ]);
    expect(window.location.pathname).toBe("/app/clients/alice/pets");
  });

  it.each(["details", "notes"])(
    "retains the care draft when saving %s fails",
    async (failure) => {
      await mount("/app/clients/alice/pets/scout");
      const notes = field("Private sitter notes");
      await enter("Private sitter notes", "Unsaved note");
      respond = (request) =>
        request.method === "PUT" &&
        request.route ===
          (failure === "details"
            ? "/owner/pets/scout"
            : "/owner/pets/scout/notes")
          ? Response.json({ error: "Care save unavailable" }, { status: 503 })
          : undefined;
      await submit("Care details for Scout");
      expect(field("Private sitter notes")).toBe(notes);
      expect(notes.value).toBe("Unsaved note");
      expect(window.location.pathname).toBe("/app/clients/alice/pets/scout");
      expect(container.textContent).toContain("Care save unavailable");
      expect(mutations()).toHaveLength(failure === "details" ? 1 : 2);
      expect(button("Save care details").disabled).toBe(false);
    },
  );

  it.each([true, false])(
    "uses the explicit pet status action for isActive=%s without saving care drafts",
    async (isActive) => {
      pets[0] = { ...scout, isActive };
      await mount("/app/clients/alice/pets/scout");
      await enter("Private sitter notes", "Unsaved note");
      await click(isActive ? "Archive pet" : "Reactivate pet");
      expect(mutations()).toMatchObject([
        {
          route: `/owner/pets/scout/${isActive ? "archive" : "reactivate"}`,
          method: "POST",
          body: {},
        },
      ]);
      expect(window.location.pathname).toBe("/app/clients/alice/pets");
    },
  );

  it("ignores stale pet details on client navigation and retries failed care reads", async () => {
    const pending = deferred();
    respond = (request) =>
      request.route === "/owner/pets/scout" ? pending.promise : undefined;
    await mount("/app/clients/alice/pets/scout");
    const oldRequest = requests.find(
      (request) => request.route === "/owner/pets/scout",
    )!;
    await act(async () => navigateLocal("/app/clients/bob/pets/clover"));
    expect(oldRequest.signal?.aborted).toBe(true);
    expect(field("Pet name").value).toBe("Clover");
    await act(async () => pending.resolve(Response.json({ pet: scout })));
    expect(field("Pet name").value).toBe("Clover");
    respond = (request) =>
      request.route === "/owner/pets/scout"
        ? Response.json({ error: "Care unavailable" }, { status: 503 })
        : undefined;
    await act(async () => {
      window.history.replaceState(null, "", "/app/clients/alice/pets/scout");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(container.textContent).toContain("Care unavailable");
    respond = () => undefined;
    await click("Try again");
    expect(field("Pet name").value).toBe("Scout");
    expect(mutations()).toHaveLength(0);
  });

  it("keeps the household pet page read-only and uses no owner endpoints", async () => {
    await mount("/app/pets", "client");
    expect(container.textContent).toContain("Scout");
    expect(container.textContent).not.toContain("Clover");
    expect(container.textContent).not.toContain("Private pet note");
    expect(container.querySelector("form")).toBeNull();
    expect(
      requests.every((request) => !request.route.startsWith("/owner/")),
    ).toBe(true);
    expect(mutations()).toHaveLength(0);
  });

  it("retains a new pet draft across tabs and clears it on explicit cancel", async () => {
    await mount("/app/clients/alice/pets/new");
    await enter("Pet name", "Juniper");
    await choose("Species", "cat");
    const name = field("Pet name");
    await click("Contact");
    await click("Portal access");
    await click("Pets");
    expect(window.location.pathname).toBe("/app/clients/alice/pets/new");
    expect(field("Pet name")).toBe(name);
    expect(name.value).toBe("Juniper");
    expect(control("Species").textContent).toContain("Cat");
    await click("Cancel");
    await click("Contact");
    await click("Pets");
    expect(window.location.pathname).toBe("/app/clients/alice/pets");
    await click("Add pet");
    expect(field("Pet name").value).toBe("");
    expect(mutations()).toHaveLength(0);
  });

  it("keeps an editor through same-client history changes without persisting it across clients", async () => {
    await mount("/app/clients/alice/pets/scout");
    await enter("Private sitter notes", "Alice draft");
    const notes = field("Private sitter notes");
    for (const path of [
      "/app/clients/alice/portal",
      "/app/clients/alice/pets/scout",
    ]) {
      await act(async () => {
        window.history.replaceState(null, "", path);
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      expect(field("Private sitter notes")).toBe(notes);
    }
    await click("Contact");
    await act(async () => navigateLocal("/app/clients/bob"));
    expect(
      container.querySelector('form[aria-label="Care details for Scout"]'),
    ).toBeNull();
    await click("Pets");
    expect(window.location.pathname).toBe("/app/clients/bob/pets");
    await act(async () => navigateLocal("/app/clients/alice"));
    await click("Pets");
    expect(window.location.pathname).toBe("/app/clients/alice/pets");
    await act(async () => navigateLocal("/app/clients/alice/pets/scout"));
    expect(field("Private sitter notes").value).toBe(scout.sitterNotes);
    expect(mutations()).toHaveLength(0);
  });

  it.each(["save", "archive", "back"])(
    "does not resurrect an editor after %s",
    async (action) => {
      await mount("/app/clients/alice/pets/scout");
      await enter("Private sitter notes", "Changed note");
      await click("Contact");
      await click("Pets");
      if (action === "save") await submit("Care details for Scout");
      else await click(action === "archive" ? "Archive pet" : "Back to pets");
      await click("Contact");
      await click("Pets");
      expect(window.location.pathname).toBe("/app/clients/alice/pets");
      expect(
        container.querySelector('form[aria-label="Care details for Scout"]'),
      ).toBeNull();
    },
  );
});
