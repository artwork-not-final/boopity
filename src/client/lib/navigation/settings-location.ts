import { readWorkspaceLocation, workspaceHref } from "./workspace-location";
export const sections = [
  { id: "appearance", label: "Appearance", title: "Business" },
  { id: "email", label: "Email delivery", title: "Email delivery" },
  { id: "google", label: "Google sign-in", title: "Google sign-in" },
  { id: "payments", label: "Payments", title: "Payments" },
] as const;
export type SettingsSection = (typeof sections)[number]["id"];

export function settingsPath(section: SettingsSection) {
  return `/app/settings/${section}`;
}

// Only UI destinations are resolved here. Owner access is checked by the API
// and by App before any settings content is rendered.
export function ownerDestination(
  pathname: string,
  search = "",
): {
  path: string;
  section: SettingsSection | null;
} {
  if (pathname === "/app/settings" || pathname.startsWith("/app/settings/")) {
    const section =
      sections.find(
        ({ id }) => pathname.replace(/\/$/, "") === settingsPath(id),
      )?.id ?? "appearance";
    return { path: settingsPath(section), section };
  }
  if (pathname === "/app" || pathname.startsWith("/app/")) {
    const location = readWorkspaceLocation(pathname, search);
    return {
      path: location.notFound ? pathname : workspaceHref(location),
      section: null,
    };
  }
  return { path: "/app/bookings", section: null };
}
