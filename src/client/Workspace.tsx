import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CalendarDays,
  ClipboardList,
  PawPrint,
  ReceiptText,
  Settings2,
  Users,
} from "lucide-react";
import { Button } from "./components/ui/button";

import { Clients } from "./clients/Clients";
import { HouseholdPets } from "./clients/HouseholdPets";

import type { RunWorkspaceAction as Run } from "./workspace-types";
import { Services } from "./services/Services";

import { Choice } from "./Choice";
import { Panel } from "./WorkspacePanel";
import { workspaceApi as api, WorkspaceError } from "./workspace-api";
import { hasWorkspaceEditor, watchWorkspaceResume } from "./workspace-refresh";
import {
  navigateLocal,
  useWorkspaceLocation,
  workspaceHref,
  workspaceSection,
  type WorkspaceSection,
} from "./workspace-location";

import { Cancellations } from "./Cancellations";

import type { WorkspaceSession } from "../shared/portal";

import { PaymentRecords } from "./payments/PaymentRecords";
import { settingsPath } from "./SettingsLayout";

import type { Policy, Data } from "./workspace-types";
import { Bookings } from "./Bookings";

import { Rules } from "./Rules";

export function Workspace({
  session,
  openSettings,
  recheckAccess,
  settings,
}: {
  session: WorkspaceSession;
  openSettings: () => void;
  recheckAccess: () => Promise<void>;
  settings?: {
    content: ReactNode;
    busy: boolean;
    leave: (path: string) => void;
  };
}) {
  const owner = session.role === "owner";
  const viewingSettings = owner && Boolean(settings);
  const location = useWorkspaceLocation();
  const tab = workspaceSection(location.section, owner);
  useEffect(() => {
    if (!viewingSettings) {
      // Client accounts never mount owner pages; paths are not authorization.
      if (
        location.section !== tab ||
        (!owner &&
          (window.location.pathname.startsWith("/app/settings") ||
            ["/login", "/register", "/setup", "/app/invitation"].includes(
              window.location.pathname,
            )))
      )
        navigateLocal(workspaceHref({ section: tab }), true);
      else if (!location.notFound) navigateLocal(workspaceHref(location), true);
    }
  }, [viewingSettings, owner, tab, location]);
  const [data, setData] = useState<Data | null>(null),
    [revision, setRevision] = useState(0);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const resumeState = useRef({
    busy,
    viewingSettings,
    tab,
    revision,
    loaded: Boolean(data),
  });
  resumeState.current = {
    busy,
    viewingSettings,
    tab,
    revision,
    loaded: Boolean(data),
  };
  function applyPolicy(policy: { policy: Policy; regional: Data["regional"] }) {
    setData((previous) => ({
      ...policy,
      revision: (previous?.revision ?? 0) + 1,
    }));
    setRevision((value) => value + 1);
  }
  async function reload() {
    const policy = await api<{ policy: Policy; regional: Data["regional"] }>(
      "/policy",
    );
    applyPolicy(policy);
  }
  async function report(error: unknown) {
    setError(
      error instanceof Error ? error.message : "Unable to load the workspace.",
    );
    if (error instanceof WorkspaceError && [401, 403].includes(error.status)) {
      setData(null);
      await recheckAccess().catch(() => {
        setError("Unable to recheck access. Reload the page to sign in again.");
      });
    }
  }
  const reportLoadError = useEffectEvent(report);
  useEffect(() => {
    // Re-read regional and booking policy settings when returning to work.
    if (!viewingSettings) void reload().catch(reportLoadError);
  }, [viewingSettings]);
  useEffect(
    () =>
      watchWorkspaceResume({
        windowTarget: window,
        documentTarget: document,
        isVisible: () => document.visibilityState === "visible",
        isOnline: () => navigator.onLine,
        canRefresh: () => {
          const current = resumeState.current;
          return (
            current.loaded &&
            !current.busy &&
            !current.viewingSettings &&
            current.tab !== "payments" &&
            !hasWorkspaceEditor(content.current)
          );
        },
        getKey: () => JSON.stringify(resumeState.current),
        read: (signal) =>
          api<{ policy: Policy; regional: Data["regional"] }>(
            "/policy",
            "GET",
            undefined,
            signal,
          ),
        apply: applyPolicy,
        // Browsing data remains available after a connection failure. A later return
        // retries; explicit list errors still have their existing Retry controls.
        onError: (error) => {
          if (
            error instanceof WorkspaceError &&
            [401, 403].includes(error.status)
          )
            void reportLoadError(error);
        },
      }),
    [],
  );
  const run: Run = async (work, success = "Changes saved.") => {
    resumeState.current.busy = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      await reload();
      setMessage(success);
    } catch (error) {
      await report(error);
    } finally {
      setBusy(false);
    }
  };
  const tabs = owner
    ? ([
        ["bookings", "Bookings", CalendarDays],
        ["clients", "Clients & pets", Users],
        ["rates", "Services & rates", PawPrint],
        ["rules", "Portal & rules", Settings2],
        ["followups", "Cancellations", ClipboardList],
        ["payments", "Payments", ReceiptText],
      ] as const)
    : ([
        ["bookings", "My bookings", CalendarDays],
        ["pets", "My pets", PawPrint],
      ] as const);
  const currentSection = viewingSettings ? "settings" : tab;
  const navigationBusy = busy || (viewingSettings && settings!.busy);
  function selectSection(value: WorkspaceSection | "settings") {
    setError("");
    setMessage("");
    if (value === "settings") {
      // Load settings before mounting editors, never over an open settings form.
      if (!viewingSettings)
        void run(async () => {
          await recheckAccess();
          openSettings();
        }, "");
    } else {
      const path = workspaceHref({ section: value });
      if (viewingSettings) settings!.leave(path);
      else navigateLocal(path);
    }
  }
  return (
    <section
      className="grid items-start gap-6 md:grid-cols-[190px_minmax(0,1fr)]"
      aria-label={owner ? "Sitter workspace" : "Client portal"}
    >
      <aside className="min-w-0 md:sticky md:top-6">
        <div className="flex gap-2 md:hidden">
          <Choice
            aria-label="Workspace section"
            value={currentSection}
            disabled={navigationBusy}
            onValueChange={(value) =>
              selectSection(value as WorkspaceSection | "settings")
            }
            options={[
              ...tabs.map(([value, label]) => ({ value, label })),
              ...(owner ? [{ value: "settings", label: "Settings" }] : []),
            ]}
          />
        </div>
        <nav
          className="hidden flex-col gap-1 md:flex"
          aria-label="Workspace sections"
        >
          {tabs.map(([value, label, Icon]) => (
            <Button
              key={value}
              className="shrink-0 justify-start whitespace-normal text-left md:w-full"
              variant={currentSection === value ? "secondary" : "ghost"}
              aria-current={currentSection === value ? "page" : undefined}
              disabled={navigationBusy}
              onClick={() => selectSection(value)}
            >
              <Icon aria-hidden="true" />
              {label}
            </Button>
          ))}
        </nav>
        {owner && (
          <div className="mt-3 hidden space-y-1 border-t pt-3 md:block">
            <Button
              className="w-full justify-start"
              variant={viewingSettings ? "secondary" : "ghost"}
              aria-current={viewingSettings ? "page" : undefined}
              disabled={navigationBusy}
              onClick={() => selectSection("settings")}
            >
              <Settings2 aria-hidden="true" />
              Settings
            </Button>
          </div>
        )}
        <p className="mt-5 hidden break-words text-xs text-muted-foreground md:block">
          {session.user.email}
        </p>
      </aside>
      <div
        ref={content}
        id="workspace-content"
        tabIndex={-1}
        data-skip-target
        className="min-w-0 space-y-4"
      >
        {!viewingSettings && (
          <h1 className="sr-only">
            {location.notFound
              ? "Page not found"
              : tabs.find(([value]) => value === tab)?.[1]}
          </h1>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-destructive bg-card p-4 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="rounded-xl border bg-card p-4 text-sm">
            {message}
          </p>
        )}
        {viewingSettings ? (
          settings!.content
        ) : location.notFound ? (
          <Panel title="Page not found">
            <Button onClick={() => selectSection("bookings")}>
              Back to bookings
            </Button>
          </Panel>
        ) : !data ? (
          <Panel title="Loading your workspace">
            <Button
              variant="outline"
              onClick={() => void run(async () => {}, "")}
            >
              Retry
            </Button>
          </Panel>
        ) : (
          <>
            {tab === "bookings" && (
              <Bookings
                key={session.user.email}
                data={data}
                owner={owner}
                busy={busy}
                run={run}
                revision={revision}
                onError={report}
                ownerEmail={session.user.email}
                onFirstBookingStep={(step, clientId) => {
                  navigateLocal(
                    workspaceHref(
                      step === "service"
                        ? { section: "rates", service: "new" }
                        : {
                            section: "clients",
                            client: step === "client" ? "new" : clientId,
                            clientTab: step === "pet" ? "pets" : "contact",
                          },
                    ),
                  );
                }}
                onPayments={() => navigateLocal(settingsPath("payments"))}
              />
            )}
            {tab === "clients" && (
              <Clients
                revision={data.revision}
                portalEnabled={data.policy.portalEnabled}
                busy={busy}
                run={run}
              />
            )}
            {tab === "rates" && (
              <Services
                revision={data.revision}
                currency={data.regional.currency}
                busy={busy}
                run={run}
              />
            )}
            {tab === "rules" && (
              <Rules
                key={data.policy.version}
                data={data}
                busy={busy}
                run={run}
              />
            )}
            {tab === "followups" && (
              <Cancellations
                revision={data.revision}
                timeZone={data.regional.timeZone}
                busy={busy}
                run={run}
              />
            )}
            {tab === "payments" && (
              <PaymentRecords
                revision={data.revision}
                timeZone={data.regional.timeZone}
                currency={data.regional.currency}
              />
            )}
            {tab === "pets" && <HouseholdPets revision={data.revision} />}
          </>
        )}
      </div>
    </section>
  );
}
