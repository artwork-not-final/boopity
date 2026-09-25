import { useState } from "react";
import { setupPasswordError } from "../setup-flow";
import { api } from "../installation-api";
import { Field, Notice } from "../InstallationFields";
import type { InstallationFormProps as FormProps } from "../installation-types";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

export function Identity({ state, busy, run, onContinue }: FormProps) {
  const [name, setName] = useState(state.pending.name ?? ""),
    [email, setEmail] = useState(state.pending.email ?? "");
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const needsPassword = !state.setupPasswordSet;
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
  const passwordFields = (
    <div className="space-y-5">
      <Field
        label="Setup password"
        hint="Use at least 15 characters. This lets you return before email is connected."
      >
        <Input
          type="password"
          autoComplete="new-password"
          minLength={15}
          maxLength={128}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field label="Confirm setup password">
        <Input
          type="password"
          autoComplete="new-password"
          minLength={15}
          maxLength={128}
          required
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </Field>
    </div>
  );
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          async () => {
            if (needsPassword) {
              const problem = setupPasswordError(password, confirmation, true);
              if (problem) throw new Error(problem);
            }
            await api("/api/setup/identity", "POST", {
              name,
              email,
              ...(needsPassword ? { setupPassword: password } : {}),
            });
            setPassword("");
            setConfirmation("");
          },
          "Your details saved.",
          onContinue,
        );
      }}
    >
      <fieldset disabled={busy} className="space-y-5">
        <Field label="Your name">
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
        {needsPassword && passwordFields}
        <Button disabled={busy}>
          {onContinue ? "Save and continue" : "Save changes"}
        </Button>
      </fieldset>
    </form>
  );
}
