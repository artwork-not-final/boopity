import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCATION_CHANGE,
  navigateLocal,
  readWorkspaceLocation as readLocation,
  updateWorkspaceLocation,
  workspaceHref,
  workspaceSection,
  type WorkspaceSection,
} from "../src/client/workspace-location";

afterEach(() => vi.unstubAllGlobals());
const readPath = (path: string) => {
  const url = new URL(path, "https://sitter.test");
  return readLocation(url.pathname, url.search);
};

describe("reloadable workspace locations", () => {
  it.each<WorkspaceSection>([
    "bookings",
    "clients",
    "rates",
    "rules",
    "followups",
    "payments",
    "pets",
  ])("round-trips the %s page", (section) => {
    expect(readPath(workspaceHref({ section })).section).toBe(section);
  });
  it("restores a client's pet editor without putting client details in the URL", () => {
    const path = workspaceHref({
      section: "clients",
      client: "client-a",
      clientTab: "pets",
      pet: "pet-a",
    });
    expect(path).toBe("/app/clients/client-a/pets/pet-a");
    expect(readPath(path)).toMatchObject({
      section: "clients",
      client: "client-a",
      clientTab: "pets",
      pet: "pet-a",
    });
  });
  it("restores a booking tab and the calendar it came from", () => {
    const route = {
      section: "bookings",
      booking: "visit-123",
      bookingTab: "history",
      date: "2030-01-07",
      view: "month",
    } as const;
    expect(readPath(workspaceHref(route))).toMatchObject(route);
  });
  it.each(["new", "service-deep-page"])(
    "restores the %s service editor",
    (service) => {
      expect(
        readPath(workspaceHref({ section: "rates", service })),
      ).toMatchObject({ section: "rates", service });
    },
  );
  it("opens payment return paths at the booking's Payments tab", () => {
    expect(readPath("/app/bookings/booking-123/payments")).toMatchObject({
      section: "bookings",
      booking: "booking-123",
      bookingTab: "payments",
    });
  });
  it("discards unrelated details and unknown or sensitive query values", () => {
    expect(
      workspaceHref({
        ...readPath(
          "/app/rules?client=alice&pet=scout&service=visit&booking=123&view=month&date=2030-01-01&token=secret&email=private@example.test",
        ),
      }),
    ).toBe("/app/rules");
    expect(
      workspaceHref({
        section: "clients",
        client: "new",
        clientTab: "portal",
        pet: "old-pet",
      }),
    ).toBe("/app/clients/new");
    expect(workspaceHref({ booking: "new", bookingTab: "payments" })).toBe(
      "/app/bookings/new",
    );
  });
  it.each([
    "../../../owner",
    "https://evil.test",
    "a/b",
    "a?x=y",
    "a".repeat(101),
  ])("rejects invalid record identifier %s", (id) => {
    expect(workspaceHref({ booking: id })).toBe("/app/bookings");
  });
  it.each(["2030-02-30", "2030-13-01", "tomorrow", "00000-01-01"])(
    "ignores invalid calendar date %s",
    (date) => {
      expect(readPath(`/app/bookings?date=${date}`).date).toBeNull();
    },
  );
  it("falls back for unknown calendar views", () => {
    expect(readPath("/app/bookings/visit?view=nope")).toMatchObject({
      section: "bookings",
      bookingTab: "overview",
      view: "week",
    });
  });
  it.each<WorkspaceSection>([
    "clients",
    "rates",
    "rules",
    "followups",
    "payments",
  ])("never mounts owner-only %s for a client", (section) => {
    expect(workspaceSection(section, false)).toBe("bookings");
  });
  it("keeps client My pets separate from the owner client list", () => {
    expect(workspaceSection("pets", false)).toBe("pets");
    expect(workspaceSection("pets", true)).toBe("clients");
  });
  it("updates history once per navigation and merges against the current URL", () => {
    const browser = new EventTarget() as EventTarget & {
      location: URL;
      history: {
        pushState: ReturnType<typeof vi.fn>;
        replaceState: ReturnType<typeof vi.fn>;
      };
    };
    browser.location = new URL("https://sitter.test/app/clients");
    const write = (_state: unknown, _title: string, path: string) => {
      browser.location = new URL(path, browser.location);
    };
    browser.history = { pushState: vi.fn(write), replaceState: vi.fn(write) };
    vi.stubGlobal("window", browser);
    const changed = vi.fn();
    browser.addEventListener(LOCATION_CHANGE, changed);
    updateWorkspaceLocation({ client: "a", clientTab: "pets" });
    updateWorkspaceLocation({ pet: "pet-a" });
    expect(browser.location.pathname).toBe("/app/clients/a/pets/pet-a");
    expect(browser.location.search).toBe("");
    expect(changed).toHaveBeenCalledTimes(2);
    updateWorkspaceLocation({ pet: "pet-a" });
    expect(browser.history.pushState).toHaveBeenCalledTimes(2);
    navigateLocal("/app/settings/email");
    expect(browser.location.pathname).toBe("/app/settings/email");
    navigateLocal("/app/rates", true);
    expect(browser.history.replaceState).toHaveBeenCalledTimes(1);
    expect(() => navigateLocal("https://evil.test/app")).toThrow("local page");
  });
  it("leaves a payment return page without reopening the booking", () => {
    const browser = new EventTarget() as EventTarget & {
      location: URL;
      history: { pushState: ReturnType<typeof vi.fn> };
    };
    browser.location = new URL(
      "https://sitter.test/app/bookings/visit/payments",
    );
    browser.history = {
      pushState: vi.fn((_state, _title, path: string) => {
        browser.location = new URL(path, browser.location);
      }),
    };
    vi.stubGlobal("window", browser);
    updateWorkspaceLocation({ booking: null, bookingTab: "overview" });
    expect(browser.location.search).toBe("");
    expect(browser.location.pathname).toBe("/app/bookings");
  });
});
