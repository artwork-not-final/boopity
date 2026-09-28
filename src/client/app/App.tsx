import { useInstallationState } from "./useInstallationState";
import { BrandLayout } from "./BrandLayout";
import { ActionConfirmation } from "../components/feedback/ActionFeedback";
import type { ActionFeedback } from "../lib/types/action-feedback";
import { useInstallationLifecycle } from "./useInstallationLifecycle";
import { lazy, Suspense, useEffect, useState, useRef } from "react";

import { Button } from "../components/ui/button";
import { Notice } from "../components/feedback/Notice";
import { Card, CardContent } from "../components/ui/card";
import { defaultBranding, type Branding } from "../../shared/branding";

import { InvitationWelcome } from "../features/auth/InvitationWelcome";
import {
  LOCATION_CHANGE,
  navigateLocal,
  useLocalLocation,
} from "../lib/navigation/workspace-location";
import {
  ownerDestination,
  settingsPath,
} from "../lib/navigation/settings-location";
import { readSetupLink } from "../../shared/setup-link";
import {
  adjacentSetupStep,
  saveAndRefresh,
  savedSiteName,
  rememberSetupStep,
  setupStepPath,
  setupStepFromPath,
  installerAccess,
  type SetupStep as Step,
} from "../lib/navigation/setup-flow";
import { api } from "../lib/http/installation-api";
import { Login } from "../features/auth/Login";
import { SetupAccess } from "../features/setup/SetupAccess";
import { Unlock } from "../features/setup/Unlock";
import { steps } from "../features/setup/steps";

import "../styles/theme.css";

// Keep the entry/sign-in experience independent of the workspace and editors.
// Module-level declarations preserve component identity and mounted drafts.
const Workspace = lazy(() =>
  import("./Workspace").then((module) => ({ default: module.Workspace })),
);
const SetupWizard = lazy(() =>
  import("../features/setup/SetupWizard").then((module) => ({
    default: module.SetupWizard,
  })),
);
const SettingsPage = lazy(() =>
  import("../features/settings/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);

export function App() {
  const [hasSetupLink, setHasSetupLink] = useState(
    () => readSetupLink(window.location.hash).present,
  );
  const [invalidSetupLink] = useState(() => {
    const link = readSetupLink(window.location.hash);
    return link.present && !link.token;
  });
  const [setupLinkToken, setSetupLinkToken] = useState(
    () => readSetupLink(window.location.hash).token,
  );
  const [installerCode, setInstallerCode] = useState(
    () => installerAccess(window.location.pathname) === "setup-code",
  );
  const [inviteToken] = useState(() =>
    new URLSearchParams(window.location.hash.slice(1)).get("invite"),
  );
  const [fallbackStep, setFallbackStep] = useState<Step>("identity"),
    [preview, setPreview] = useState<Branding | null>(null);
  const {
    info,
    setup,
    access,
    invitedEmail,
    entry,
    setupStarted,
    setSetup,
    setAccess,
    loadInstallation,
  } = useInstallationState(setFallbackStep);
  const [error, setError] = useState(""),
    [refreshError, setRefreshError] = useState(""),
    [message, setMessage] = useState<ActionFeedback>(""),
    [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(
    () => installerAccess(window.location.pathname) === "recovery",
  );
  const location = useLocalLocation();
  const { pathname, search } = new URL(location, "http://localhost");
  const step = setupStepFromPath(pathname) ?? fallbackStep;
  const ownerReady = setup?.state === "ready" && setup.actor === "owner";
  const setupActor = setup?.actor;
  const wizardHeading = useRef<HTMLHeadingElement>(null);
  const destination = ownerDestination(pathname, search);
  function navigate(path: string) {
    navigateLocal(path);
    setPreview(null);
    setError("");
    setMessage("");
  }
  useEffect(() => {
    const onBack = () => {
      setRecovery(installerAccess(window.location.pathname) === "recovery");
      setInstallerCode(
        installerAccess(window.location.pathname) === "setup-code",
      );
      setPreview(null);
      setError("");
      setMessage("");
    };
    window.addEventListener("popstate", onBack);
    window.addEventListener(LOCATION_CHANGE, onBack);
    return () => {
      window.removeEventListener("popstate", onBack);
      window.removeEventListener(LOCATION_CHANGE, onBack);
    };
  }, []);
  useEffect(() => {
    // Completed installations never reopen the first-run wizard via /setup.
    // Keep explicit settings links through sign-in, refresh, and browser Back.
    if (ownerReady && pathname + search !== destination.path)
      navigateLocal(destination.path, true);
  }, [ownerReady, pathname, search, destination.path]);
  async function refresh() {
    await loadInstallation();
    // A recovered connection should not leave an old failure above working
    // pages. Keep action/validation errors until the user addresses them.
    setRefreshError("");
  }
  function reportRefreshError(error: unknown) {
    setRefreshError(
      error instanceof TypeError
        ? "We couldn’t connect to Boopity. Please try again."
        : error instanceof Error
          ? error.message
          : "We couldn’t refresh this page. Please try again.",
    );
  }
  async function retryConnection() {
    setBusy(true);
    try {
      await refresh();
    } catch (error) {
      reportRefreshError(error);
    } finally {
      setBusy(false);
    }
  }
  useInstallationLifecycle({
    inviteToken,
    hasSetupLink,
    invalidSetupLink,
    refresh,
    reportRefreshError,
    setHasSetupLink,
    setSetupLinkToken,
    setMessage,
    setError,
  });
  const active = preview ?? info?.branding ?? defaultBranding;
  // Unsaved appearance previews may change colors, but the header uses the
  // name confirmed by the server so it only switches after a successful save.
  const siteName = savedSiteName(info?.branding.businessName);
  const simplifiedSetup =
    setup?.actor === "owner" &&
    setup.state !== "ready" &&
    setup.owner?.verified &&
    setup.pending.mailVerifiedAt &&
    setup.providers.managed.email;
  const visibleSteps = simplifiedSetup
    ? steps.filter(({ id }) => ["appearance", "google", "review"].includes(id))
    : steps;
  function changeSetupStep(next: Step) {
    setFallbackStep(next);
    navigateLocal(setupStepPath(next, setup?.actor === "recovery"));
    if (setup?.actor !== "recovery" && setup?.state !== "ready")
      rememberSetupStep(next);
    setPreview(null);
    setError("");
    setMessage("");
  }
  function continueSetup() {
    const next = adjacentSetupStep(visibleSteps, step, 1);
    if (next) changeSetupStep(next);
  }
  const previousStep = adjacentSetupStep(visibleSteps, step, -1);
  function leaveInstallerAccess() {
    // Preserve a requested workspace destination through email sign-in.
    if (installerAccess(window.location.pathname))
      navigateLocal(info?.ownerClaimed ? "/login" : "/setup", true);
    setRecovery(false);
    setInstallerCode(false);
    setError("");
    setMessage("");
  }
  useEffect(() => {
    if (!setupActor || ownerReady) return;
    const next =
      simplifiedSetup && !["appearance", "google", "review"].includes(step)
        ? "appearance"
        : step;
    if (next !== step) setFallbackStep(next);
    if (setupActor !== "recovery") rememberSetupStep(next);
    navigateLocal(setupStepPath(next, setupActor === "recovery"), true);
  }, [setupActor, ownerReady, simplifiedSetup, step, pathname]);
  useEffect(() => {
    if (setup || !info || access) return;
    const installer = installerAccess(pathname);
    if (installer)
      navigateLocal(
        installer === "recovery"
          ? setupStepFromPath(pathname)
            ? setupStepPath(setupStepFromPath(pathname)!, true)
            : "/setup/recovery"
          : "/setup/code",
        true,
      );
    else if (
      !info.ownerClaimed &&
      (["/", "/login", "/register", "/app"].includes(pathname) ||
        pathname.startsWith("/app/"))
    )
      navigateLocal("/setup", true);
    else if (
      info.ownerClaimed &&
      ["/", "/register", "/setup"].includes(pathname)
    )
      navigateLocal("/login" + search, true);
  }, [setup, info, access, pathname, search]);
  useEffect(() => {
    if (access?.role === "pending") navigateLocal("/app/invitation", true);
  }, [access?.role]);
  useEffect(() => {
    document.title =
      siteName === "Boopity" ? "Boopity" : `${siteName} · Powered by Boopity`;
  }, [siteName]);
  async function action(
    run: () => Promise<unknown>,
    success: ActionFeedback = "",
    afterSave?: () => void,
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await saveAndRefresh(run, refresh, afterSave);
      setMessage(success);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to complete the request.",
      );
    } finally {
      setBusy(false);
    }
  }
  const logout = () =>
    action(async () => {
      await api("/api/auth/sign-out", "POST", {});
      await api("/api/setup/lock", "POST", {});
      setSetup(null);
      setAccess(null);
      navigate("/login");
      setPreview(null);
    }, "Signed out.");
  const inWorkspace = access?.role === "client" || ownerReady;
  const showingInvitation = access?.role === "pending";
  const showingSignIn = Boolean(
    info?.ownerClaimed && !access && !setup && !recovery,
  );
  const showingAccountPage = showingInvitation || showingSignIn;
  const showingSetupEntry = Boolean(
    info && !info.ownerClaimed && !access && !setup && !recovery,
  );
  const centeredEntryPage = showingAccountPage || showingSetupEntry;
  const displayedError = error || refreshError;
  return (
    <BrandLayout
      active={active}
      siteName={siteName}
      version={info?.version}
      centeredEntryPage={centeredEntryPage}
      skipTarget={
        inWorkspace
          ? "workspace-content"
          : setup && !showingAccountPage
            ? "setup-content"
            : "main-content"
      }
      showSignOut={Boolean(setup || access)}
      busy={busy}
      onSignOut={logout}
    >
      {!inWorkspace && !setup && !showingAccountPage && (
        <div
          className={
            showingSetupEntry
              ? "mb-6 w-full max-w-md text-center"
              : "mb-6 max-w-2xl"
          }
        >
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">
            {info?.ownerClaimed && !recovery
              ? "Sign in"
              : setupStarted && !recovery
                ? "Continue setting up Boopity"
                : "Set up Boopity"}
          </h1>
        </div>
      )}
      {displayedError &&
        !showingInvitation &&
        !showingSignIn &&
        !(ownerReady && destination.section) && (
          <div
            role="alert"
            className={`mb-5 rounded-xl border border-destructive/30 bg-card p-4 text-sm text-destructive${showingSetupEntry ? " w-full max-w-md break-words" : ""}`}
          >
            {displayedError}
            {!error && refreshError && info && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-3"
                disabled={busy}
                onClick={() => void retryConnection()}
              >
                Retry connection
              </Button>
            )}
          </div>
        )}
      {message && !inWorkspace && !showingAccountPage && (
        <div className={`mb-5${showingSetupEntry ? " w-full max-w-md" : ""}`}>
          <ActionConfirmation
            feedback={message}
            dismiss={() => setMessage("")}
          />
        </div>
      )}
      <Suspense
        fallback={
          <p role="status" className="py-6 text-sm text-muted-foreground">
            Loading page…
          </p>
        }
      >
        {!info ? (
          <Card>
            <CardContent className="py-6">
              <p>Checking your installation…</p>
              <Button
                className="mt-4"
                variant="outline"
                disabled={busy}
                onClick={() => void retryConnection()}
              >
                Retry connection
              </Button>
            </CardContent>
          </Card>
        ) : access?.role === "client" ? (
          <Workspace
            key={access.user.email}
            session={access}
            openSettings={() => {}}
            recheckAccess={refresh}
          />
        ) : access?.role === "pending" ? (
          <InvitationWelcome
            businessName={siteName}
            signedInEmail={access.user.email}
            invitedEmail={invitedEmail}
            busy={busy}
            error={displayedError}
            onAccept={() =>
              void action(
                () => api("/api/portal/invitation/accept", "POST", {}),
                "Invitation accepted.",
              )
            }
            onSwitchAccount={() => void logout()}
          />
        ) : !setup ? (
          info.ownerClaimed && !recovery ? (
            <Login
              standalone
              error={displayedError}
              message={typeof message === "string" ? message : undefined}
              suggestedEmail={invitedEmail ?? undefined}
              info={info}
              busy={busy}
              run={action}
              after={leaveInstallerAccess}
            />
          ) : entry === null ? (
            <Notice>Checking setup…</Notice>
          ) : recovery ? (
            <div className="grid max-w-xl gap-4">
              <Unlock
                recovery
                busy={busy}
                run={action}
                linkToken={null}
                clearLink={() => {}}
              />
              <Button
                variant="ghost"
                disabled={busy}
                onClick={leaveInstallerAccess}
              >
                Back to sign-in
              </Button>
            </div>
          ) : (
            <SetupAccess
              mode={entry}
              started={setupStarted}
              info={info}
              busy={busy}
              run={action}
              refresh={refresh}
              linkToken={setupLinkToken}
              clearLink={() => {
                setSetupLinkToken(null);
                setHasSetupLink(false);
              }}
              installerCode={installerCode}
              leaveInstaller={leaveInstallerAccess}
              afterClaim={() => changeSetupStep("appearance")}
              clearFeedback={() => {
                setError("");
                setMessage("");
              }}
            />
          )
        ) : ownerReady ? (
          <Workspace
            key={setup.owner!.email}
            session={{
              user: { name: setup.owner!.name, email: setup.owner!.email },
              role: "owner",
            }}
            openSettings={() => navigate(settingsPath("appearance"))}
            recheckAccess={refresh}
            settings={
              destination.section
                ? {
                    busy,
                    leave: navigate,
                    content: (
                      <SettingsPage
                        section={destination.section}
                        setup={setup}
                        info={info}
                        busy={busy}
                        action={action}
                        navigate={navigate}
                        message={message}
                        dismissMessage={() => setMessage("")}
                        error={displayedError}
                        setPreview={setPreview}
                        setError={setError}
                      />
                    ),
                  }
                : undefined
            }
          />
        ) : (
          <SetupWizard
            setup={setup}
            info={info}
            busy={busy}
            action={action}
            step={step}
            visibleSteps={visibleSteps}
            changeSetupStep={changeSetupStep}
            continueSetup={continueSetup}
            previousStep={previousStep}
            wizardHeading={wizardHeading}
            setPreview={setPreview}
            navigate={navigate}
          />
        )}
      </Suspense>
    </BrandLayout>
  );
}
