import { useEffect, useEffectEvent, useId, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { workspaceApi, WorkspaceError } from "../../lib/http/workspace-api";
import type {
  FirstBookingProgress,
  FirstBookingStep,
} from "../../../shared/first-booking";

type Actions = {
  busy: boolean;
  onChoose: (step: FirstBookingStep, clientId: string | null) => void;
  onPayments: () => void;
};

export function checklistDismissalKey(ownerEmail: string) {
  return `boopity:first-booking:${ownerEmail}:dismissed`;
}

export function checklistDismissed(ownerEmail: string) {
  try {
    return localStorage.getItem(checklistDismissalKey(ownerEmail)) === "true";
  } catch {
    return false;
  }
}

export function dismissChecklist(ownerEmail: string) {
  try {
    localStorage.setItem(checklistDismissalKey(ownerEmail), "true");
  } catch {
    // Dismissal still works for this visit when browser storage is unavailable.
  }
}

export function FirstBookingGuide({
  ownerEmail,
  revision,
  onError,
  ...actions
}: Actions & {
  ownerEmail: string;
  revision: number;
  onError: (error: unknown) => Promise<void>;
}) {
  const [dismissed, setDismissed] = useState(() =>
    checklistDismissed(ownerEmail),
  );
  const [progress, setProgress] = useState<FirstBookingProgress | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const reportLoadError = useEffectEvent(onError);
  useEffect(() => {
    if (dismissed) return;
    const controller = new AbortController();
    setError(false);
    void workspaceApi<{ progress: FirstBookingProgress }>(
      "/owner/first-booking",
      "GET",
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setProgress(result.progress);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setError(true);
        if (
          error instanceof WorkspaceError &&
          [401, 403].includes(error.status)
        )
          void reportLoadError(error);
      });
    return () => controller.abort();
  }, [ownerEmail, revision, dismissed, retry]);
  const dismiss = () => {
    dismissChecklist(ownerEmail);
    setDismissed(true);
  };
  if (dismissed) return null;
  if (error)
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-4 text-sm">
        <p role="status">Your first-booking checklist couldn’t load.</p>
        <Button
          variant="outline"
          size="sm"
          disabled={actions.busy}
          onClick={() => setRetry((n) => n + 1)}
        >
          Retry
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={actions.busy}
          onClick={dismiss}
        >
          Dismiss
        </Button>
      </div>
    );
  return progress ? (
    <FirstBookingChecklist
      progress={progress}
      onDismiss={dismiss}
      {...actions}
    />
  ) : null;
}

export function FirstBookingChecklist({
  progress,
  busy,
  onChoose,
  onPayments,
  onDismiss,
}: Actions & { progress: FirstBookingProgress; onDismiss: () => void }) {
  const titleId = useId();
  // A business with booking history has already passed this introduction.
  if (progress.booking) return null;
  const steps: {
    id: FirstBookingStep;
    label: string;
    doneLabel: string;
    enabled: boolean;
    hint?: string;
  }[] = [
    {
      id: "service",
      label: "Add a service",
      doneLabel: "Service added",
      enabled: true,
    },
    {
      id: "client",
      label: "Add a client",
      doneLabel: "Client added",
      enabled: true,
    },
    {
      id: "pet",
      label: "Add their pet",
      doneLabel: "Pet added",
      enabled: progress.client,
      hint: "Add a client first.",
    },
    {
      id: "booking",
      label: "Create a booking",
      doneLabel: "Booking created",
      enabled: progress.service && progress.client && progress.pet,
      hint: "Complete the steps above first.",
    },
  ];
  const completed = steps.filter((step) => progress[step.id]).length;
  return (
    <section aria-labelledby={titleId}>
      <Card className="gap-3 rounded-xl py-4 shadow-none">
        <CardHeader className="flex flex-row items-start justify-between gap-3 px-4">
          <div>
            <h2 id={titleId} className="font-semibold">
              Your first booking
            </h2>
            <p
              className="mt-1 text-sm text-muted-foreground"
              aria-live="polite"
            >
              {completed} of 4 complete
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onDismiss}
            aria-label="Dismiss first-booking checklist"
          >
            Dismiss
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 px-4">
          <ol className="grid gap-2 sm:grid-cols-2">
            {steps.map((step, index) => (
              <li key={step.id}>
                {progress[step.id] ? (
                  <div className="flex min-h-12 items-center gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <Check
                      className="size-5 shrink-0 text-brand-ink"
                      aria-hidden="true"
                    />
                    <span>
                      {step.doneLabel}
                      <span className="sr-only"> — complete</span>
                    </span>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    disabled={busy || !step.enabled}
                    className="h-auto min-h-12 w-full justify-start gap-3 whitespace-normal px-3 py-2 text-left"
                    onClick={() => onChoose(step.id, progress.clientId)}
                  >
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded-full border text-xs"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      {step.label}
                      {!step.enabled && (
                        <span className="mt-0.5 block text-xs font-normal">
                          {step.hint}
                        </span>
                      )}
                    </span>
                    {step.enabled && (
                      <ChevronRight
                        className="size-4 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  </Button>
                )}
              </li>
            ))}
          </ol>
          <Button
            variant="link"
            className="h-auto whitespace-normal p-0 text-left text-sm"
            disabled={busy}
            onClick={onPayments}
          >
            Set up online payments (optional)
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
