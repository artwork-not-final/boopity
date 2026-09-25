import { defaultBranding } from "../../../shared/branding";
import { setupPasswordSchema } from "../../../shared/setup";

export type SetupEntryMode =
  | "email"
  | "waiting"
  | "token"
  | "owner"
  | "resume"
  | "paused"
  | "password"
  | "password-email";
export type SetupHelp = "none" | "forgot" | "hosting";

/** Presentation only. Every credential still requires server-side authorization. */
export function installerAccess(pathname: string) {
  if (pathname === "/setup/code" || pathname === "/setup/code/")
    return "setup-code";
  if (pathname === "/setup/recovery" || pathname.startsWith("/setup/recovery/"))
    return "recovery";
  return null;
}

export function setupAccessView(
  mode: SetupEntryMode,
  help: SetupHelp,
  privateLink: boolean,
  installerCode: boolean,
) {
  if (mode === "owner") return "owner";
  if (privateLink) return "link";
  if (installerCode) return "code";
  if (mode === "password" || mode === "password-email") {
    if (help === "none") return "password";
    if (help === "hosting") return "hosting";
    return mode === "password-email" ? "email" : "password-help";
  }
  if (help === "hosting") return "hosting";
  if (mode === "resume") return "email";
  if (mode === "email") return "guided";
  return "hosting";
}

export function setupPasswordError(
  password: string,
  confirmation: string,
  required: boolean,
) {
  if (!required && !password && !confirmation) return null;
  if (!setupPasswordSchema.safeParse(password).success)
    return "Use a setup password with 15 to 128 characters.";
  return password === confirmation ? null : "The passwords don’t match.";
}

const setupSteps = [
  "identity",
  "email",
  "appearance",
  "verify",
  "google",
  "review",
] as const;
export type SetupStep = (typeof setupSteps)[number];
const stepPaths: Record<SetupStep, string> = {
  identity: "account",
  email: "email",
  appearance: "business",
  verify: "verify",
  google: "google",
  review: "review",
};
export function setupStepPath(step: SetupStep, recovery = false) {
  return `/setup/${recovery ? "recovery/" : ""}${stepPaths[step]}`;
}
export function setupStepFromPath(pathname: string): SetupStep | null {
  const match = /^\/setup\/(?:recovery\/)?([^/]+)\/?$/.exec(pathname);
  return setupSteps.find((step) => stepPaths[step] === match?.[1]) ?? null;
}
export function setupHelpFromPath(pathname: string): SetupHelp {
  if (pathname === "/setup/password-help") return "forgot";
  return pathname === "/setup/hosting-help" ? "hosting" : "none";
}
export function setupHelpPath(help: SetupHelp) {
  return help === "forgot"
    ? "/setup/password-help"
    : help === "hosting"
      ? "/setup/hosting-help"
      : "/setup";
}
const stepKey = "boopity.setup.step";

/** Device-local navigation only: never store form values, tokens or credentials. */
export function readSetupStep(
  storage?: Pick<Storage, "getItem">,
): SetupStep | null {
  try {
    const value = (storage ?? window.localStorage).getItem(stepKey);
    return setupSteps.includes(value as SetupStep)
      ? (value as SetupStep)
      : null;
  } catch {
    return null;
  }
}
export function rememberSetupStep(
  step: SetupStep | null,
  storage?: Pick<Storage, "setItem" | "removeItem">,
) {
  try {
    const target = storage ?? window.localStorage;
    if (step) target.setItem(stepKey, step);
    else target.removeItem(stepKey);
  } catch {
    /* Storage may be disabled; saved settings still live on the server. */
  }
}
export function restoredSetupStep(
  state: {
    pending: { email: string | null };
    owner: { verified: boolean } | null;
    readiness: { email: boolean };
    branding: { businessName: string };
    setupPasswordSet?: boolean;
  },
  remembered: SetupStep | null,
): SetupStep {
  // Ignore a previous installation's navigation on a fresh database.
  if (!state.pending.email && !state.owner) return "identity";
  // Older installations may already have saved details but no return password.
  if (!state.owner && state.setupPasswordSet === false) return "identity";
  if (remembered) return remembered;
  if (!state.readiness.email) return "email";
  if (state.branding.businessName === defaultBranding.businessName)
    return "appearance";
  return state.owner?.verified ? "google" : "verify";
}

/** Display the installation placeholder as Boopity without renaming saved data. */
export function savedSiteName(name?: string) {
  return name && name !== defaultBranding.businessName ? name : "Boopity";
}

/** Advance only after the save and the refreshed server state both succeed. */
export async function saveAndRefresh(
  save: () => Promise<unknown>,
  refresh: () => Promise<unknown>,
  afterSave?: () => void,
) {
  await save();
  await refresh();
  afterSave?.();
}

/** Both appearance endpoints increment the checked revision once on success.
 * Retain confirmed progress if a logo fails, so retrying does not use a stale
 * revision or discard the form. Conflicts/ambiguous failures still fail closed.
 */
export async function saveAppearanceDraft(
  revision: { current: number },
  saveAppearance: (version: number) => Promise<unknown>,
  saveLogo?: (version: number) => Promise<unknown>,
) {
  await saveAppearance(revision.current);
  revision.current += 1;
  if (saveLogo) {
    await saveLogo(revision.current);
    revision.current += 1;
  }
}

export function adjacentSetupStep<T extends string>(
  steps: readonly { id: T }[],
  current: T,
  direction: -1 | 1,
) {
  const index = steps.findIndex(({ id }) => id === current);
  return index < 0 ? undefined : steps[index + direction]?.id;
}
