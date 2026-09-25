import { useState } from "react";
import { KeyRound, LockKeyhole } from "lucide-react";
import { HostingSetupHelp } from "./HostingSetupHelp";
import { api } from "../../lib/http/installation-api";
import { Field } from "../../components/forms/Field";
import type { RunInstallationAction as Run } from "../../lib/types/installation-types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";

export function Unlock({
  recovery,
  returning = false,
  manualCode = false,
  busy,
  run,
  linkToken,
  clearLink,
}: {
  recovery: boolean;
  returning?: boolean;
  manualCode?: boolean;
  busy: boolean;
  run: Run;
  linkToken: string | null;
  clearLink: () => void;
}) {
  const [token, setToken] = useState("");
  if (!recovery && !manualCode && !linkToken) {
    return (
      <HostingSetupHelp
        reason="missing"
        busy={busy}
        check={() => void run(async () => {}, "Connection checked.")}
      />
    );
  }
  return (
    <Card>
      <CardHeader>
        <KeyRound className="mb-2 size-6" aria-hidden="true" />
        <CardTitle>
          {recovery
            ? "Repair your installation"
            : manualCode
              ? "Installer access"
              : returning
                ? "Your progress is saved"
                : "Welcome to Boopity"}
        </CardTitle>
        <CardDescription>
          {recovery
            ? "Enter the recovery code from your installer."
            : manualCode
              ? "Enter the setup code supplied with this installation."
              : returning
                ? "Continue where you left off."
                : "Add your business details and connect email."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              async () => {
                try {
                  await api("/api/setup/unlock", "POST", {
                    token: linkToken ?? token.trim(),
                    kind: recovery ? "recovery" : "setup",
                  });
                  setToken("");
                } finally {
                  clearLink();
                }
              },
              returning ? "Welcome back." : "Setup unlocked.",
            );
          }}
        >
          {!linkToken && (
            <Field
              appearance="emphasized"
              label={recovery ? "Recovery code" : "Setup code"}
            >
              <Input
                type="password"
                autoComplete="off"
                required
                minLength={32}
                maxLength={256}
                disabled={busy}
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </Field>
          )}
          <Button disabled={busy}>
            {recovery
              ? "Unlock recovery"
              : returning
                ? "Continue setup"
                : "Start setup"}
            <LockKeyhole aria-hidden="true" />
          </Button>
        </form>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Keep this {recovery || manualCode ? "code" : "link"} private. It works
          once and expires after 30 minutes.
        </p>
        {recovery && (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Recovery can repair settings but cannot access client records or
            sign in as the owner.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
