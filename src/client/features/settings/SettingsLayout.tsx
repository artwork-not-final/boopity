import type { ReactNode } from "react";
import { SectionTabs } from "../../components/navigation/SectionTabs";
import { ActionConfirmation } from "../../components/feedback/ActionFeedback";
import type { ActionFeedback } from "../../lib/types/action-feedback";
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
  dismissMessage,
  error,
}: {
  section: SettingsSection;
  busy: boolean;
  navigate: (path: string) => void;
  children: ReactNode;
  message?: ActionFeedback;
  dismissMessage?: () => void;
  error?: string;
}) {
  return (
    <section className="space-y-4" aria-label="Business settings">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <SectionTabs
        label="Settings categories"
        items={sections.map(({ id, label }) => [id, label] as const)}
        value={section}
        disabled={busy}
        onValueChange={(id) => navigate(settingsPath(id))}
      />
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-card p-4 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <ActionConfirmation feedback={message ?? ""} dismiss={dismissMessage} />
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
