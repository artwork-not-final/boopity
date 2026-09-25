import { Login } from "../auth/Login";
import { GuidedClaim } from "./GuidedClaim";
import { HostingSetupHelp } from "./HostingSetupHelp";
import { SetupPasswordLogin } from "./SetupPasswordLogin";
import { SetupPasswordHelp } from "./SetupPasswordHelp";
import { Unlock } from "./Unlock";
import {
  navigateLocal,
  useLocalLocation,
} from "../../lib/navigation/workspace-location";
import {
  setupAccessView,
  setupHelpFromPath,
  setupHelpPath,
  type SetupEntryMode as EntryMode,
  type SetupHelp,
} from "../../lib/navigation/setup-flow";
import type { PublicInfo } from "../../../shared/api-responses";
import type { RunInstallationAction as Run } from "../../lib/types/installation-types";
import { Button } from "../../components/ui/button";

export function SetupAccess({
  mode,
  started,
  info,
  busy,
  run,
  refresh,
  linkToken,
  clearLink,
  installerCode = false,
  leaveInstaller,
  afterClaim,
  clearFeedback,
}: {
  mode: EntryMode;
  started: boolean;
  info: PublicInfo;
  busy: boolean;
  run: Run;
  refresh: () => Promise<unknown>;
  linkToken: string | null;
  clearLink: () => void;
  installerCode?: boolean;
  leaveInstaller: () => void;
  afterClaim: () => void;
  clearFeedback: () => void;
}) {
  const help = setupHelpFromPath(
    new URL(useLocalLocation(), "http://localhost").pathname,
  );
  const view = setupAccessView(mode, help, Boolean(linkToken), installerCode);
  const hasPassword = mode === "password" || mode === "password-email";
  function showHelp(next: SetupHelp) {
    clearFeedback();
    navigateLocal(setupHelpPath(next));
  }
  return (
    <div className="grid w-full max-w-md gap-4">
      {view === "owner" ? (
        <Login info={info} busy={busy} run={run} after={leaveInstaller} />
      ) : view === "password" ? (
        <SetupPasswordLogin
          returning={started}
          emailRecovery={mode === "password-email"}
          busy={busy}
          run={run}
          onForgot={() => showHelp("forgot")}
        />
      ) : view === "password-help" ? (
        <SetupPasswordHelp
          busy={busy}
          onResetHelp={() => showHelp("hosting")}
        />
      ) : view === "link" || view === "code" ? (
        <>
          <Unlock
            recovery={false}
            returning={started}
            manualCode={view === "code"}
            busy={busy}
            run={run}
            linkToken={linkToken}
            clearLink={clearLink}
          />
          {view === "code" && (
            <Button variant="ghost" disabled={busy} onClick={leaveInstaller}>
              Back to setup
            </Button>
          )}
        </>
      ) : view === "email" ? (
        <>
          <Login
            info={info}
            busy={busy}
            run={run}
            after={() => {}}
            resumeSetup
          />
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => showHelp("hosting")}
          >
            Can’t receive a code?
          </Button>
        </>
      ) : view === "guided" ? (
        <GuidedClaim busy={busy} run={run} after={afterClaim} />
      ) : (
        <HostingSetupHelp
          reason={
            hasPassword ? "password" : mode === "waiting" ? "email" : "missing"
          }
          busy={busy}
          check={() => void run(refresh, "Connection checked.")}
        />
      )}
      {help !== "none" && hasPassword && !linkToken && !installerCode && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => showHelp("none")}
        >
          Back to setup password
        </Button>
      )}
      {help === "hosting" &&
        mode === "resume" &&
        !linkToken &&
        !installerCode && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => showHelp("none")}
          >
            Back to email verification
          </Button>
        )}
    </div>
  );
}
