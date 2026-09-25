// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "../src/client/Workspace";
import { navigateLocal } from "../src/client/workspace-location";

const clients = ["alice", "bob"].map((id) => ({
  id,
  firstName: id === "alice" ? "Alice" : "Bob",
  lastName: "Example",
  email: `${id}@example.test`,
  phone: "",
  address: "",
  notes: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  status: "active",
  petCount: 0,
  members: 0,
  invitationExpiresAt: null,
}));
const policy = {
  version: 1,
  portalEnabled: true,
  approvalMode: "request",
  leadHours: 24,
  horizonDays: 90,
  cancelHours: 24,
  requestHoldHours: 24,
  weekly: [],
  blockedDates: [],
};
const pagination = { offset: 0, limit: 50, hasMore: false };
let root: Root;
let container: HTMLDivElement;
let holdDetail = false;
let resumeDetail: (() => void) | undefined;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  holdDetail = false;
  resumeDetail = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options?: RequestInit) => {
      const url = new URL(path, window.location.origin);
      const route = url.pathname.replace("/api/business", "");
      let data: unknown;
      if (route === "/policy")
        data = {
          policy,
          regional: { timeZone: "America/New_York", currency: "USD" },
        };
      else if (route === "/owner/clients") data = { clients, pagination };
      else if (route === "/owner/pets") data = { pets: [], pagination };
      else if (/^\/owner\/clients\/(alice|bob)$/.test(route)) {
        if (holdDetail)
          await new Promise<void>((resolve) => {
            resumeDetail = resolve;
          });
        data = { client: clients.find((client) => route.endsWith(client.id)) };
      } else if (route.endsWith("/revoke") && options?.method === "POST")
        data = { ok: true };
      else if (route.endsWith("/invitation") && options?.method === "POST")
        data = {
          url: `${window.location.origin}/login#invite=synthetic-${route.split("/")[3]}`,
        };
      else throw new Error(`Unexpected test request: ${route}`);
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
  window.history.replaceState(null, "", "/app/clients/alice");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
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
});
afterEach(async () => {
  await act(async () => {
    resumeDetail?.();
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});
function button(text: string) {
  const element = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  );
  expect(element, `Button ${text}`).toBeDefined();
  return element!;
}
function firstName() {
  const label = [...container.querySelectorAll("label")].find(
    (label) => label.textContent === "First name",
  )!;
  return label
    ? (document.getElementById(label.htmlFor) as HTMLInputElement | null)
    : null;
}

describe("client detail lifecycle", () => {
  it("keeps the mounted contact draft across a portal mutation and delayed detail refresh", async () => {
    const input = firstName()!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Unsaved Alice");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      button("Portal access").click();
    });
    holdDetail = true;
    await act(async () => button("Revoke portal access").click());
    expect(resumeDetail).toBeDefined();
    expect(firstName()).toBe(input);
    expect(firstName()?.value).toBe("Unsaved Alice");
    await act(async () => {
      resumeDetail!();
    });
    await act(async () => button("Contact").click());
    expect(firstName()).toBe(input);
    expect(firstName()?.value).toBe("Unsaved Alice");
  });

  it("never displays one client's private invitation on another client's route", async () => {
    await act(async () => button("Portal access").click());
    await act(async () => button("Create invitation").click());
    expect(container.querySelector("textarea[readonly]")).not.toBeNull();
    await act(async () => navigateLocal("/app/clients/bob/portal"));
    expect(container.textContent).toContain("Bob Example");
    expect(container.querySelector("textarea[readonly]")).toBeNull();
  });
});
