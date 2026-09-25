import { useMemo, useSyncExternalStore } from "react";

export const LOCATION_CHANGE = "boopity:location-change";
const sections = [
  "bookings",
  "clients",
  "rates",
  "rules",
  "followups",
  "payments",
  "pets",
] as const;
export type WorkspaceSection = (typeof sections)[number];
export type WorkspaceLocation = {
  notFound: boolean;
  section: WorkspaceSection;
  booking: string | null;
  bookingTab: "overview" | "payments" | "history";
  view: "week" | "month" | "list";
  date: string | null;
  client: string | null;
  clientTab: "contact" | "pets" | "portal";
  pet: string | null;
  service: string | null;
  cancellation: string | null;
};
function choice<T extends string>(
  value: string | null | undefined,
  values: readonly T[],
  fallback: T,
): T {
  return values.includes(value as T) ? (value as T) : fallback;
}
function recordId(value: string | null | undefined) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
    ? value
    : null;
}
function normalizeLocation(
  location: Partial<WorkspaceLocation> = {},
): WorkspaceLocation {
  const section = choice(location.section, sections, "bookings");
  const booking = section === "bookings" ? recordId(location.booking) : null;
  const client = section === "clients" ? recordId(location.client) : null;
  const date = location.date;
  const validDate =
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date;
  return {
    notFound: false,
    section,
    booking,
    bookingTab:
      booking && booking !== "new"
        ? choice(
            location.bookingTab,
            ["overview", "payments", "history"],
            "overview",
          )
        : "overview",
    view:
      section === "bookings"
        ? choice(location.view, ["week", "month", "list"], "week")
        : "week",
    date: section === "bookings" && validDate ? date : null,
    client,
    clientTab:
      client && client !== "new"
        ? choice(location.clientTab, ["contact", "pets", "portal"], "contact")
        : "contact",
    pet: client && client !== "new" ? recordId(location.pet) : null,
    service: section === "rates" ? recordId(location.service) : null,
    cancellation:
      section === "followups" ? recordId(location.cancellation) : null,
  };
}
const sectionPaths: Record<WorkspaceSection, string> = {
  bookings: "bookings",
  clients: "clients",
  rates: "rates",
  rules: "rules",
  followups: "cancellations",
  payments: "payments",
  pets: "pets",
};

/** Paths identify pages. Only calendar state stays in the query string. */
export function readWorkspaceLocation(
  pathname: string,
  search = "",
): WorkspaceLocation {
  const path = pathname.replace(/\/$/, "");
  const base = normalizeLocation();
  if (path === "/app" || path === "") return base;
  const match = /^\/app\/([^/]+)(?:\/(.*))?$/.exec(path);
  if (!match) return { ...base, notFound: true };
  const section = (Object.keys(sectionPaths) as WorkspaceSection[]).find(
    (key) => sectionPaths[key] === match[1],
  );
  if (!section) return { ...base, notFound: true };
  const parts = match[2]?.split("/") ?? [];
  const query = new URLSearchParams(search);
  const state = normalizeLocation({
    section,
    view: choice(query.get("view"), ["week", "month", "list"] as const, "week"),
    date: query.get("date"),
  });
  if (!parts.length) return state;
  const id = recordId(parts[0]);
  if (!id) return { ...state, notFound: true };
  if (section === "bookings" && parts.length <= 2) {
    const tab = parts[1] ?? "overview";
    if (
      ["overview", "payments", "history"].includes(tab) &&
      (id !== "new" || parts.length === 1)
    )
      return {
        ...state,
        booking: id,
        bookingTab: tab as WorkspaceLocation["bookingTab"],
      };
  }
  if (section === "rates" && parts.length === 1)
    return { ...state, service: id };
  if (section === "followups" && parts.length === 1)
    return { ...state, cancellation: id };
  if (section === "clients") {
    if (parts.length === 1) return { ...state, client: id };
    if (id !== "new") {
      const tab = parts[1];
      if (parts.length === 2 && ["contact", "pets", "portal"].includes(tab))
        return {
          ...state,
          client: id,
          clientTab: tab as WorkspaceLocation["clientTab"],
        };
      const pet = recordId(parts[2] ?? null);
      if (parts.length === 3 && tab === "pets" && pet)
        return { ...state, client: id, clientTab: "pets", pet };
    }
  }
  return { ...state, notFound: true };
}
export function workspaceSection(
  section: WorkspaceSection,
  owner: boolean,
): WorkspaceSection {
  return owner
    ? section === "pets"
      ? "clients"
      : section
    : section === "pets"
      ? "pets"
      : "bookings";
}
export function workspaceHref(location: Partial<WorkspaceLocation>) {
  const normalized = normalizeLocation(location);
  // Only navigation state belongs in the URL, never form drafts or credentials.
  const result = new URLSearchParams();
  let path = `/app/${sectionPaths[normalized.section]}`;
  if (normalized.booking) {
    path += `/${normalized.booking}`;
    if (normalized.bookingTab !== "overview")
      path += `/${normalized.bookingTab}`;
  }
  if (normalized.client) {
    path += `/${normalized.client}`;
    if (normalized.clientTab !== "contact") path += `/${normalized.clientTab}`;
    if (normalized.clientTab === "pets" && normalized.pet)
      path += `/${normalized.pet}`;
  }
  if (normalized.service) path += `/${normalized.service}`;
  if (normalized.cancellation) path += `/${normalized.cancellation}`;
  if (normalized.date) result.set("date", normalized.date);
  if (normalized.view !== "week") result.set("view", normalized.view);
  return path + (result.size ? `?${result}` : "");
}
export function navigateLocal(path: string, replace = false) {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin)
    throw new Error("Expected a local page.");
  const target = url.pathname + url.search + url.hash;
  if (target === snapshot()) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", target);
  window.dispatchEvent(new Event(LOCATION_CHANGE));
}
export function updateWorkspaceLocation(
  patch: Partial<WorkspaceLocation>,
  replace = false,
) {
  navigateLocal(
    workspaceHref({
      ...readWorkspaceLocation(
        window.location.pathname,
        window.location.search,
      ),
      ...patch,
    }),
    replace,
  );
}
function subscribe(notify: () => void) {
  window.addEventListener("popstate", notify);
  window.addEventListener(LOCATION_CHANGE, notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener(LOCATION_CHANGE, notify);
  };
}
function snapshot() {
  return (
    window.location.pathname + window.location.search + window.location.hash
  );
}
export function useLocalLocation() {
  return useSyncExternalStore(subscribe, snapshot, () => "/app");
}
export function useWorkspaceLocation() {
  const location = useLocalLocation();
  return useMemo(() => {
    const url = new URL(location, "http://localhost");
    return readWorkspaceLocation(url.pathname, url.search);
  }, [location]);
}
