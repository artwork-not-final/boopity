import { useState } from "react";
import { Choice } from "../../components/forms/Choice";
import { EmailSetupGuide } from "./EmailSetupGuide";
import { providersPayload } from "./providers-payload";
import { api } from "../../lib/http/installation-api";
import { Field } from "../../components/forms/Field";
import { Notice } from "../../components/feedback/Notice";
import type { InstallationFormProps as FormProps } from "../../lib/types/installation-types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

export function EmailSettings({ state, busy, run, onContinue }: FormProps) {
  const [email, setEmail] = useState(state.providers.email);
  const managed = state.providers.managed.email;
  const field = <K extends keyof typeof email>(
    key: K,
    value: (typeof email)[K],
  ) => setEmail((previous) => ({ ...previous, [key]: value }));
  return (
    <>
      <EmailSetupGuide
        verificationLabel={
          state.actor === "owner" && state.state === "ready"
            ? "Test email delivery"
            : "Verify your inbox"
        }
      />
      {managed ? (
        <Notice>
          Email is managed in your hosting settings and can’t be changed here.
        </Notice>
      ) : (
        <p className="text-sm text-muted-foreground">
          Saving does not send email.
        </p>
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
                providersPayload(state, email),
              ),
            "Email settings saved.",
            onContinue,
          );
        }}
      >
        <fieldset disabled={busy || managed} className="space-y-5">
          <Field appearance="emphasized" label="Email provider">
            <Choice
              disabled={busy || managed}
              value={email.provider}
              onValueChange={(value) =>
                field("provider", value as typeof email.provider)
              }
              options={[
                { value: "none", label: "Not configured" },
                { value: "smtp", label: "SMTP" },
                { value: "resend", label: "Resend" },
              ]}
            />
          </Field>
          {email.provider !== "none" && (
            <Field
              label="Sender email"
              hint="Use an address your email provider has approved."
            >
              <Input
                type="email"
                required
                value={email.from}
                onChange={(e) => field("from", e.target.value)}
              />
            </Field>
          )}
          {email.provider === "smtp" && (
            <>
              <div className="grid gap-4 sm:grid-cols-[1fr_110px]">
                <Field appearance="emphasized" label="SMTP host">
                  <Input
                    required
                    value={email.host}
                    onChange={(e) => field("host", e.target.value)}
                    placeholder="smtp.example.com"
                  />
                </Field>
                <Field appearance="emphasized" label="Port">
                  <Input
                    type="number"
                    required
                    min={1}
                    max={65535}
                    value={email.port}
                    onChange={(e) => field("port", Number(e.target.value))}
                  />
                </Field>
              </div>
              <Field appearance="emphasized" label="Connection security">
                <Choice
                  disabled={busy || managed}
                  value={String(email.secure)}
                  onValueChange={(value) => field("secure", value === "true")}
                  options={[
                    { value: "false", label: "STARTTLS (usually port 587)" },
                    { value: "true", label: "Direct TLS (usually port 465)" },
                  ]}
                />
              </Field>
              <Field appearance="emphasized" label="SMTP username">
                <Input
                  autoComplete="off"
                  value={email.username}
                  onChange={(e) => field("username", e.target.value)}
                />
              </Field>
              <Field
                label="SMTP password"
                hint={
                  email.hasPassword
                    ? "Leave blank to keep your saved password."
                    : "Use your provider’s SMTP or app password, if required."
                }
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={email.password}
                  onChange={(e) => field("password", e.target.value)}
                />
              </Field>
            </>
          )}
          {email.provider === "resend" && (
            <Field
              label="Resend API key"
              hint={
                email.hasApiKey
                  ? "Leave blank to keep your saved key."
                  : "Paste a sending-only key from your Resend account."
              }
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={email.apiKey}
                onChange={(e) => field("apiKey", e.target.value)}
              />
            </Field>
          )}
        </fieldset>
        {!managed && (
          <Button disabled={busy}>
            {onContinue ? "Save and continue" : "Save changes"}
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
