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

type InstallationSnapshot = {
  access: WorkspaceSession | null;
  invitedEmail: string | null;
  info: PublicInfo | null;
  setup: SetupState | null;
  entry: EntryMode | null;
  setupStarted: boolean;
};

async function readInstallation(): Promise<InstallationSnapshot> {
  const info = parseResponse(
    publicInfoResponse,
    await api("/api/installation"),
  );
  const setupEntry = info.ownerClaimed
    ? { mode: "owner" as const, started: true }
    : parseResponse(setupEntryResponse, await api("/api/setup/entry"));
  const snapshot: InstallationSnapshot = {
    info,
    entry: setupEntry.mode,
    setupStarted: setupEntry.started,
    access: null,
    invitedEmail: null,
    setup: null,
  };
  if (info.ownerClaimed) {
    const [identity, invite] = await Promise.all([
      fetch("/api/portal/session", { cache: "no-store" }),
      api("/api/portal/invitation").then((value) =>
        parseResponse(invitationResponse, value),
      ),
    ]);
    snapshot.invitedEmail = invite.invitation?.email ?? null;
    if (identity.ok) {
      snapshot.access = await decodeResponse(identity, sessionResponse);
      if (snapshot.access.role !== "owner") return snapshot;
    } else if (![401, 403].includes(identity.status))
      throw new Error("Your session could not be checked. Please retry.");
  }
  const response = await fetch("/api/setup/status", { cache: "no-store" });
  if (response.status === 401) return snapshot;
  if (!response.ok)
    throw new Error(
      "Your settings could not be loaded. Check the server and try again.",
    );
  snapshot.setup = await decodeResponse(response, setupStateResponse);
  return snapshot;
}

// The installation snapshot is separate from rendering and mutation feedback.
// Loading this state must not resend verification codes or accept invitations.
export function useInstallationState(setFallbackStep: (step: Step) => void) {
  const [installation, setInstallation] = useState<InstallationSnapshot>({
    info: null,
    setup: null,
    access: null,
    invitedEmail: null,
    entry: null,
    setupStarted: false,
  });
  const restoredStep = useRef(false);
  const generation = useRef(0);
  const latestLoad = useRef<Promise<boolean> | null>(null);

  function loadInstallation(): Promise<boolean> {
    const request = ++generation.current;
    async function load() {
      let snapshot: InstallationSnapshot;
      try {
        snapshot = await readInstallation();
      } catch (error) {
        if (request === generation.current) throw error;
        // A save awaiting this refresh must still wait for the newer snapshot.
        // Only that latest request's failure should reach the caller.
        await latestLoad.current;
        return false;
      }
      if (request !== generation.current) {
        await latestLoad.current;
        return false;
      }
      const current = snapshot.setup;
      if (current?.state === "ready") rememberSetupStep(null);
      else if (
        current &&
        current.actor !== "recovery" &&
        !restoredStep.current
      ) {
        const next =
          setupStepFromPath(window.location.pathname) ??
          restoredSetupStep(current, readSetupStep());
        setFallbackStep(next);
        rememberSetupStep(next);
        restoredStep.current = true;
      }
      setInstallation(snapshot);
      return true;
    }
    latestLoad.current = load();
    return latestLoad.current;
  }

  function clearAccess() {
    // Signing out must also invalidate reads started under the old session.
    generation.current += 1;
    latestLoad.current = null;
    setInstallation((current) => ({
      ...current,
      setup: null,
      access: null,
      invitedEmail: null,
    }));
  }

  return {
    ...installation,
    clearAccess,
    loadInstallation,
  };
}
