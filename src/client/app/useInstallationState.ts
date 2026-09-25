import { useState, useRef } from "react";

import type { WorkspaceSession } from "../../shared/portal";

import {
  readSetupStep,
  rememberSetupStep,
  restoredSetupStep,
  setupStepFromPath,
  type SetupEntryMode as EntryMode,
  type SetupStep as Step,
} from "../lib/navigation/setup-flow";
import { api } from "../lib/http/installation-api";

import { decodeResponse, parseResponse } from "../lib/http/api-response";
import {
  publicInfoResponse,
  sessionResponse,
  setupStateResponse,
  setupEntryResponse,
  invitationResponse,
  type PublicInfo,
  type SetupState,
} from "../../shared/api-responses";

// The installation snapshot is separate from rendering and mutation feedback.
// Loading this state must not resend verification codes or accept invitations.
export function useInstallationState(setFallbackStep: (step: Step) => void) {
  const [access, setAccess] = useState<WorkspaceSession | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [info, setInfo] = useState<PublicInfo | null>(null),
    [setup, setSetup] = useState<SetupState | null>(null);
  const [entry, setEntry] = useState<EntryMode | null>(null);
  const [setupStarted, setSetupStarted] = useState(false);
  const restoredStep = useRef(false);
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

  return {
    info,
    setup,
    access,
    invitedEmail,
    entry,
    setupStarted,
    setSetup,
    setAccess,
    loadInstallation,
  };
}
