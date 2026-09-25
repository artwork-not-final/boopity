import { describe, expect, it } from "vitest";
import {
  readWorkspaceLocation,
  workspaceHref,
  type WorkspaceLocation,
} from "../src/client/lib/navigation/workspace-location";
import { ownerDestination } from "../src/client/lib/navigation/settings-location";
const read = (path: string) => {
  const url = new URL(path, "https://sitter.test");
  return readWorkspaceLocation(url.pathname, url.search);
};
const routes: [string, Partial<WorkspaceLocation>][] = [
  ["/app/bookings", { section: "bookings" }],
  ["/app/bookings/new", { section: "bookings", booking: "new" }],
  ["/app/bookings/booking-1", { section: "bookings", booking: "booking-1" }],
  [
    "/app/bookings/booking-1/history",
    { section: "bookings", booking: "booking-1", bookingTab: "history" },
  ],
  [
    "/app/bookings/booking-1/payments",
    { section: "bookings", booking: "booking-1", bookingTab: "payments" },
  ],
  ["/app/clients", { section: "clients" }],
  ["/app/clients/new", { section: "clients", client: "new" }],
  ["/app/clients/client-a", { section: "clients", client: "client-a" }],
  [
    "/app/clients/client-a/portal",
    { section: "clients", client: "client-a", clientTab: "portal" },
  ],
  [
    "/app/clients/client-a/pets",
    { section: "clients", client: "client-a", clientTab: "pets" },
  ],
  [
    "/app/clients/client-a/pets/new",
    { section: "clients", client: "client-a", clientTab: "pets", pet: "new" },
  ],
  [
    "/app/clients/client-a/pets/pet-a",
    { section: "clients", client: "client-a", clientTab: "pets", pet: "pet-a" },
  ],
  ["/app/rates", { section: "rates" }],
  ["/app/rates/new", { section: "rates", service: "new" }],
  ["/app/rates/service-819", { section: "rates", service: "service-819" }],
  ["/app/rules", { section: "rules" }],
  ["/app/cancellations", { section: "followups" }],
  [
    "/app/cancellations/booking-a",
    { section: "followups", cancellation: "booking-a" },
  ],
  ["/app/payments", { section: "payments" }],
  ["/app/pets", { section: "pets" }],
];
describe("named page paths", () => {
  it.each(routes)("round-trips %s", (path, state) => {
    expect(workspaceHref(state)).toBe(path);
    expect(read(path)).toMatchObject({ ...state, notFound: false });
    expect(read(path + "/")).toEqual(read(path));
    expect(ownerDestination(path)).toEqual({ path, section: null });
  });
  it.each([
    "/app?section=rates",
    "/app?section=followups",
    "/app?section=rates&service=service-a",
    "/app?section=clients&client=a&clientTab=pets&pet=scout",
    "/app?section=clients&client=a&clientTab=portal&pet=scout",
    "/app?booking=visit&bookingTab=history",
    "/app?payment=booking-123",
  ])("does not use old query parameters to select a page: %s", (oldPath) => {
    const old = new URL(oldPath, "https://sitter.test");
    expect(ownerDestination(old.pathname, old.search).path).toBe(
      "/app/bookings",
    );
    expect(read(oldPath)).toEqual(read("/app/bookings"));
  });
  it("opens Bookings at the workspace entry point", () => {
    expect(ownerDestination("/app").path).toBe("/app/bookings");
    expect(read("/app/")).toEqual(read("/app/bookings"));
  });
  it("keeps calendar state through detail navigation", () => {
    const path = "/app/bookings/visit/history?date=2030-01-07&view=month";
    expect(workspaceHref(read(path))).toBe(path);
  });
  it("ignores conflicting legacy queries and unknown values on named paths", () => {
    const path =
      "/app/clients/alice/pets/scout?section=rates&booking=visit&client=bob&pet=nori&payment=other&token=private&email=private@example.test";
    expect(workspaceHref(read(path))).toBe("/app/clients/alice/pets/scout");
  });
  it.each([
    "/app/unknown",
    "/app/rates/id/more",
    "/app/bookings/new/payments",
    "/app/bookings/id/wrong",
    "/app/clients/new/pets",
    "/app/clients/id/private",
    "/app/clients/id/pets/a/extra",
    "/app/rules/extra",
    "/app/cancellations/id/extra",
    "/app/cancellations/a%2Fb",
    "/app/clients/a%2Fb",
    "/app/clients/a%3Fb",
    "/app/clients/%",
    "/app/rates/" + "a".repeat(101),
  ])("does not silently open another page for invalid path %s", (path) => {
    expect(read(path).notFound).toBe(true);
  });
});
