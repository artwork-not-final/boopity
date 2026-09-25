import type { ReactNode } from "react";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { readWorkspaceLocation, workspaceHref } from "./workspace-location";

const sections = [
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
// and by SelfHostedApp before any settings content is rendered.
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

export function SettingsLayout({
  section,
  busy,
  navigate,
  children,
  message,
  error,
}: {
  section: SettingsSection;
  busy: boolean;
  navigate: (path: string) => void;
  children: ReactNode;
  message?: string;
  error?: string;
}) {
  return (
    <section className="space-y-4" aria-label="Business settings">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <nav
        aria-label="Settings categories"
        className="flex flex-wrap gap-1 border-b pb-3"
      >
        {sections.map(({ id, label }) => (
          <Button
            key={id}
            size="sm"
            variant={section === id ? "secondary" : "ghost"}
            aria-current={section === id ? "page" : undefined}
            disabled={busy}
            onClick={() => navigate(settingsPath(id))}
          >
            {label}
          </Button>
        ))}
      </nav>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-card p-4 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-xl border bg-card p-4 text-sm">
          {message}
        </p>
      )}
      {section === "payments" ? (
        children
      ) : (
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>
              <h2>{sections.find(({ id }) => id === section)!.title}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">{children}</CardContent>
        </Card>
      )}
    </section>
  );
}
