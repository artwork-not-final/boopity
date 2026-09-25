import { useState } from "react";
import { providersPayload } from "./providers-payload";
import { api } from "../../lib/http/installation-api";
import { Field } from "../../components/forms/Field";
import { Notice } from "../../components/feedback/Notice";
import type { InstallationFormProps as FormProps } from "../../lib/types/installation-types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

export function GoogleSettings({ state, busy, run, onContinue }: FormProps) {
  const [google, setGoogle] = useState(state.providers.google),
    managed = state.providers.managed.google;
  return (
    <>
      {(google.enabled || managed) && (
        <>
          <Notice>
            Create a Google OAuth client of type{" "}
            <strong>Web application</strong>. Add the exact origin and redirect
            URI below. If the Google app is in testing mode, add the owner as a
            test user. Never paste the secret into chat.
          </Notice>
          <Field appearance="emphasized" label="Authorized JavaScript origin">
            <Input readOnly value={state.readiness.origin} />
          </Field>
          <Field appearance="emphasized" label="Authorized redirect URI">
            <Input readOnly value={state.readiness.googleCallback} />
          </Field>
        </>
      )}
      <p className="text-sm leading-6 text-muted-foreground">
        Use your verified owner email or an invited client email. Google does
        not grant new access. Email codes remain available.
      </p>
      {managed && (
        <Notice>
          Managed by your host. Update its environment variables and restart.
        </Notice>
      )}
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              api(
                "/api/setup/providers",
                "PUT",
                providersPayload(state, state.providers.email, google),
              ),
            "Google settings saved.",
            onContinue,
          );
        }}
      >
        <fieldset disabled={busy || managed} className="space-y-5">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={google.enabled}
              onChange={(e) =>
                setGoogle({ ...google, enabled: e.target.checked })
              }
            />
            Enable Google sign-in
          </label>
          {google.enabled && (
            <>
              <Field appearance="emphasized" label="Google client ID">
                <Input
                  required
                  autoComplete="off"
                  value={google.clientId}
                  onChange={(e) =>
                    setGoogle({ ...google, clientId: e.target.value })
                  }
                />
              </Field>
              <Field
                label="Google client secret"
                hint={
                  google.hasSecret
                    ? "A secret is saved. Leave blank to keep it."
                    : "Stored encrypted on your server and never returned to the browser."
                }
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={google.clientSecret}
                  onChange={(e) =>
                    setGoogle({ ...google, clientSecret: e.target.value })
                  }
                />
              </Field>
            </>
          )}
        </fieldset>
        {!managed && (
          <Button disabled={busy}>
            {onContinue
              ? google.enabled
                ? "Save and continue"
                : "Continue without Google"
              : "Save changes"}
          </Button>
        )}
      </form>
      {managed && onContinue && (
        <Button disabled={busy} onClick={onContinue}>
          Continue
        </Button>
      )}
    </>
  );
}
