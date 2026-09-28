import type { SetupState } from "../../../shared/api-responses";
import type { ActionFeedback } from "./action-feedback";

/** Save, refresh server-confirmed state, then optionally advance the wizard. */
export type RunInstallationAction = (
  run: () => Promise<unknown>,
  success?: ActionFeedback,
  afterSave?: () => void,
) => Promise<void>;

export type InstallationFormProps = {
  state: SetupState;
  busy: boolean;
  run: RunInstallationAction;
  onContinue?: () => void;
};
