import { useState } from "react";
import { api } from "../../lib/http/installation-api";
import { Field } from "../../components/forms/Field";
import type { RunInstallationAction as Run } from "../../lib/types/installation-types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent } from "../../components/ui/card";

export function SetupPasswordLogin({
  returning,
  emailRecovery = false,
  busy,
  run,
  onForgot,
}: {
  returning: boolean;
  emailRecovery?: boolean;
  busy: boolean;
  run: Run;
  onForgot?: () => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <Card
      className="mx-auto w-full max-w-md gap-0 rounded-2xl py-0"
      aria-busy={busy}
    >
      <CardContent className="p-6 text-center sm:p-8">
        <div className="mb-6 space-y-2">
          <h2 className="text-lg font-semibold">
            {returning ? "Welcome back!" : "Welcome to Boopity!"}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {returning
              ? "Your progress is saved. Enter your setup password to pick up where you left off."
              : "Let’s get your pet-care business set up. Your setup password makes sure only you can make these first changes."}
          </p>
        </div>
        <form
          className="space-y-5 text-left"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              async () => {
                await api("/api/setup/password/unlock", "POST", { password });
                setPassword("");
              },
              returning ? "Continue where you left off." : "Let’s get started.",
            );
          }}
        >
          <Field appearance="emphasized" label="Setup password">
            <Input
              required
              type="password"
              className="min-h-11"
              autoComplete="current-password"
              maxLength={128}
              disabled={busy}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button
            className="h-auto min-h-11 w-full whitespace-normal"
            disabled={busy || !password}
          >
            {returning ? "Continue setup" : "Start setup"}
          </Button>
        </form>
        {onForgot && (
          <Button
            type="button"
            variant="link"
            className="mt-3 h-auto min-h-11 w-full whitespace-normal px-0"
            disabled={busy}
            onClick={onForgot}
          >
            {emailRecovery
              ? "Email me a sign-in code"
              : "Help me find my setup password"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
