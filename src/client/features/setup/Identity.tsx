import { useState } from "react";
import { api } from "../../lib/http/installation-api";
import { Field } from "../../components/forms/Field";
import { Notice } from "../../components/feedback/Notice";
import type { InstallationFormProps as FormProps } from "../../lib/types/installation-types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

export function Identity({ state, busy, run, onContinue }: FormProps) {
  const [name, setName] = useState(state.pending.name ?? ""),
    [email, setEmail] = useState(state.pending.email ?? "");
  if (state.owner)
    return (
      <>
        <Notice>
          Owner: <strong>{state.owner.name}</strong>
          <br />
          {state.owner.email}
          <br />
          {state.owner.verified
            ? "Email verified."
            : "Verify the recovered email address before continuing."}
        </Notice>
        <p className="text-sm leading-6 text-muted-foreground">
          Lost access to this inbox? Use server recovery to change the owner
          email.
        </p>
        {onContinue && (
          <Button disabled={busy} onClick={onContinue}>
            Continue
          </Button>
        )}
      </>
    );
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          async () => {
            await api("/api/setup/identity", "POST", {
              name,
              email,
            });
          },
          "Your details saved.",
          onContinue,
        );
      }}
    >
      <fieldset disabled={busy} className="space-y-5">
        <Field appearance="emphasized" label="Your name">
          <Input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </Field>
        <Field
          label="Your email"
          hint="You’ll verify this email to finish setting up your account."
        >
          <Input
            required
            type="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </Field>
        <Button disabled={busy}>
          {onContinue ? "Save and continue" : "Save changes"}
        </Button>
      </fieldset>
    </form>
  );
}
