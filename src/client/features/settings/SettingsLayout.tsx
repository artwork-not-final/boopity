import type { ReactNode } from "react";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";

import {
  sections,
  settingsPath,
  type SettingsSection,
} from "../../lib/navigation/settings-location";
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
