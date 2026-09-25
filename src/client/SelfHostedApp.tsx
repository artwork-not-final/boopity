import { useEffect, useState, useRef, type CSSProperties } from "react";
import { LogOut, PawPrint } from "lucide-react";
import { Button } from "./components/ui/button";
import { Notice } from "./InstallationFields";
import { Card, CardContent } from "./components/ui/card";
import {
  brandingVariables,
  defaultBranding,
  type Branding,
} from "../shared/branding";
import type { WorkspaceSession } from "../shared/portal";
import { Workspace } from "./Workspace";
import { SkipLink } from "./SkipLink";
import { InvitationWelcome } from "./InvitationWelcome";
import {
  LOCATION_CHANGE,
  navigateLocal,
  useLocalLocation,
} from "./workspace-location";
import { ownerDestination, settingsPath } from "./SettingsLayout";
import { readSetupLink } from "../shared/setup-link";
import {
  adjacentSetupStep,
  saveAndRefresh,
  savedSiteName,
  readSetupStep,
  rememberSetupStep,
  restoredSetupStep,
  setupStepPath,
  setupStepFromPath,
  installerAccess,
  type SetupEntryMode as EntryMode,
  type SetupStep as Step,
} from "./setup-flow";
import { api } from "./installation-api";
import { Login } from "./auth/Login";
import { SetupAccess } from "./setup/SetupAccess";
import { Unlock } from "./setup/Unlock";
import { SetupWizard } from "./setup/SetupWizard";
import { steps } from "./setup/steps";
import { SettingsPage } from "./settings/SettingsPage";
import { decodeResponse, parseResponse } from "./api-response";
import {
  publicInfoResponse,
  sessionResponse,
  setupStateResponse,
  setupEntryResponse,
  invitationResponse,
  type PublicInfo,
  type SetupState,
} from "../shared/api-responses";
import "./theme.css";

export function SelfHostedApp() {
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
  const [access, setAccess] = useState<WorkspaceSession | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [inviteToken] = useState(() =>
    new URLSearchParams(window.location.hash.slice(1)).get("invite"),
  );
  const initialized = useRef(false);
  const [info, setInfo] = useState<PublicInfo | null>(null),
    [setup, setSetup] = useState<SetupState | null>(null);
  const [entry, setEntry] = useState<EntryMode | null>(null);
  const [setupStarted, setSetupStarted] = useState(false);
  const restoredStep = useRef(false);
  const [fallbackStep, setFallbackStep] = useState<Step>("identity"),
    [preview, setPreview] = useState<Branding | null>(null);
  const [error, setError] = useState(""),
    [refreshError, setRefreshError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(
    () => installerAccess(window.location.pathname) === "recovery",
  );
  const location = useLocalLocation();
  const { pathname, search } = new URL(location, "http://localhost");
  const step = setupStepFromPath(pathname) ?? fallbackStep;
  const ownerReady = setup?.state === "ready" && setup.actor === "owner";
  const hasSetup = setup !== null;
  const setupActor = setup?.actor;
  const wizardHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!ownerReady) wizardHeading.current?.focus();
  }, [step, ownerReady, hasSetup]);
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
  async function loadInstallation() {
    const data = parseResponse(
      publicInfoResponse,
      await api("/api/installation"),
    );
    setInfo(data);
    const setupEntry = data.ownerClaimed
      ? { mode: "owner" as const, started: true }
      : parseResponse(setupEntryResponse, await api("/api/setup/entry"));
    setEntry(setupEntry.mode);
    setSetupStarted(setupEntry.started);
    if (data.ownerClaimed) {
      const [identity, invite] = await Promise.all([
        fetch("/api/portal/session", { cache: "no-store" }),
        api("/api/portal/invitation").then((value) =>
          parseResponse(invitationResponse, value),
        ),
      ]);
      setInvitedEmail(invite.invitation?.email ?? null);
      if (identity.ok) {
        const session = await decodeResponse(identity, sessionResponse);
        setAccess(session);
        if (session.role !== "owner") {
          setSetup(null);
          return;
        }
      } else if ([401, 403].includes(identity.status)) setAccess(null);
      else throw new Error("Your session could not be checked. Please retry.");
    } else setAccess(null);
    const response = await fetch("/api/setup/status", { cache: "no-store" });
    if (response.status === 401) {
      setSetup(null);
      return;
    }
    if (!response.ok)
      throw new Error(
        "Your settings could not be loaded. Check the server and try again.",
      );
    const current = await decodeResponse(response, setupStateResponse);
    if (current.state === "ready") rememberSetupStep(null);
    else if (current.actor !== "recovery" && !restoredStep.current) {
      const next =
        setupStepFromPath(window.location.pathname) ??
        restoredSetupStep(current, readSetupStep());
      setFallbackStep(next);
      rememberSetupStep(next);
      restoredStep.current = true;
    }
    setSetup(current);
  }
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const providerError = new URLSearchParams(window.location.search).get(
      "error",
    );
    if (providerError)
      setError(
        providerError === "account_not_linked"
          ? "Sign in with an email code, then try Google with the same owner or invited client email."
          : "Google sign-in failed. Try an email code or contact the sitter.",
      );
    // Remove private fragments before any requests. Keep setup credentials only
    // in memory until explicit confirmation, never in storage or callback URLs.
    if (inviteToken || hasSetupLink)
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    if (invalidSetupLink)
      setError(
        "This setup link is incomplete. Use your setup password, or ask your installer for a new link.",
      );
    void (async () => {
      try {
        if (inviteToken && !hasSetupLink)
          await api("/api/portal/invitation/open", "POST", {
            token: inviteToken,
          });
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Unable to open this invitation.",
        );
      }
      await refresh();
    })().catch(reportRefreshError);
  }, [hasSetupLink, invalidSetupLink, inviteToken]);
  useEffect(() => {
    // Opening a new fragment on this same page does not remount React. Handle
    // that navigation too, removing the credential before updating the UI.
    const openSetupLink = () => {
      const link = readSetupLink(window.location.hash);
      if (!link.present) return;
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      setHasSetupLink(true);
      setSetupLinkToken(link.token);
      setMessage("");
      setError(
        link.token
          ? ""
          : "This setup link is incomplete. Use your setup password, or ask your installer for a new link.",
      );
    };
    window.addEventListener("hashchange", openSetupLink);
    return () => window.removeEventListener("hashchange", openSetupLink);
  }, []);
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible")
        void refresh().catch(reportRefreshError);
    };
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    return () => {
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
    };
  }, []);
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
    success = "Changes saved.",
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
    <div
      data-boopity-theme
      className={centeredEntryPage ? "flex min-h-svh flex-col" : "min-h-screen"}
      style={brandingVariables(active) as CSSProperties}
    >
      <SkipLink
        targetId={
          inWorkspace
            ? "workspace-content"
            : setup && !showingAccountPage
              ? "setup-content"
              : "main-content"
        }
      />
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {active.logoUrl ? (
              <img
                key={info?.version}
                src={active.logoUrl}
                alt={`${siteName} logo`}
                className="size-9 shrink-0 rounded-lg object-contain"
              />
            ) : (
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <PawPrint className="size-5" aria-hidden="true" />
              </span>
            )}
            <span className="truncate font-semibold tracking-tight">
              {siteName}
            </span>
          </div>
          {setup || access ? (
            <Button
              aria-label="Sign out"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void logout()}
            >
              <LogOut aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          ) : null}
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        data-skip-target
        className={
          centeredEntryPage
            ? "mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6 sm:py-14"
            : "mx-auto max-w-7xl px-4 py-6 sm:px-6"
        }
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
          <p
            role="status"
            className={`mb-5 rounded-xl border bg-card p-4 text-sm${showingSetupEntry ? " w-full max-w-md break-words" : ""}`}
          >
            {message}
          </p>
        )}
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
              message={message}
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
      </main>
      <footer
        className={
          centeredEntryPage
            ? "mx-auto flex w-full max-w-7xl justify-center px-4 py-5 text-xs text-muted-foreground sm:px-6"
            : "mx-auto flex max-w-7xl justify-end px-4 py-4 text-xs text-muted-foreground sm:px-6"
        }
      >
        <span>
          Powered by{" "}
          <strong className="font-semibold text-foreground">Boopity</strong>
        </span>
      </footer>
    </div>
  );
}
