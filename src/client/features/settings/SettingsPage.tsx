import type { Branding } from "../../../shared/branding";
import type { PublicInfo, SetupState } from "../../../shared/api-responses";
import type { RunInstallationAction } from "../../lib/types/installation-types";
import { SettingsLayout } from "./SettingsLayout";
import { type SettingsSection } from "../../lib/navigation/settings-location";
import { PaymentSettings } from "../payments/PaymentSettings";
import { Login } from "../auth/Login";
import { Appearance } from "./Appearance";
import { EmailSettings } from "./EmailSettings";
import { GoogleSettings } from "./GoogleSettings";

export function SettingsPage({
  section,
  setup,
  info,
  busy,
  action,
  navigate,
  message,
  error,
  setPreview,
  setError,
}: {
  section: SettingsSection;
  setup: SetupState;
  info: PublicInfo;
  busy: boolean;
  action: RunInstallationAction;
  navigate: (path: string) => void;
  message: string;
  error: string;
  setPreview: (value: Branding | null) => void;
  setError: (message: string) => void;
}) {
  return (
    <SettingsLayout
      section={section}
      busy={busy}
      navigate={navigate}
      message={message}
      error={error}
    >
      {section === "appearance" && (
        <Appearance
          key={setup.version}
          state={setup}
          busy={busy}
          run={action}
          preview={setPreview}
        />
      )}
      {section === "email" && (
        <>
          <EmailSettings
            key={setup.providers.version}
            state={setup}
            busy={busy}
            run={action}
          />
          <details className="rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Test email delivery
            </summary>
            <div className="mt-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                {setup.pending.mailVerifiedAt
                  ? "Email delivery verified. Send a code to test again."
                  : "Send a code to test delivery to your owner email."}
              </p>
              <Login
                info={info}
                state={setup}
                busy={busy}
                run={action}
                after={() => {}}
                verifyEmail
              />
            </div>
          </details>
        </>
      )}
      {section === "google" && (
        <GoogleSettings
          key={setup.providers.version}
          state={setup}
          busy={busy}
          run={action}
        />
      )}
      {section === "payments" && (
        <PaymentSettings
          busy={busy}
          run={action}
          onError={async (error) => {
            setError(
              error instanceof Error
                ? error.message
                : "Unable to load payment settings.",
            );
          }}
        />
      )}
    </SettingsLayout>
  );
}
