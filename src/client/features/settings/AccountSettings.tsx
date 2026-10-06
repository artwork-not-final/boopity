import { useEffect, useState } from "react";
import type { PendingEmailChange } from "../../../shared/account";
import { api } from "../../lib/http/installation-api";
import { Field } from "../../components/forms/Field";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { retryLabel, useEmailCodeCooldown } from "../auth/useEmailCodeCooldown";

export function AccountSettings({
  owner,
  onEmailChanged,
}: {
  owner: { name: string; email: string };
  onEmailChanged: () => void;
}) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<PendingEmailChange | null>(null);
  const [currentCode, setCurrentCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Changing the draft address must not reset the owner's resend cooldown.
  const cooldown = useEmailCodeCooldown(owner.email);
  useEffect(() => {
    let active = true;
    void api<{ pending: PendingEmailChange | null }>("/api/account/email")
      .then((result) => {
        if (active) setPending(result.pending);
      })
      .catch(() => {
        if (active)
          setError(
            "Couldn’t load your account. Refresh the page to try again.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function send(address: string) {
    const result = await cooldown.attempt("send", () =>
      api<PendingEmailChange>("/api/account/email", "POST", { email: address }),
    );
    setPending(result);
    setCurrentCode("");
    setNewCode("");
  }
  return (
    <div className="max-w-lg space-y-6" aria-busy={busy || loading}>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Name</dt>
          <dd className="mt-1 font-medium">{owner.name}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="mt-1 break-all font-medium">{owner.email}</dd>
        </div>
      </dl>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading your account…</p>
      ) : pending ? (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              await cooldown.attempt("verify", () =>
                api("/api/account/email/confirm", "POST", {
                  id: pending.id,
                  currentCode,
                  newCode,
                }),
              );
              onEmailChanged();
            });
          }}
        >
          <div className="space-y-2">
            <h3 className="font-semibold">Check both inboxes</h3>
            <p role="status" className="text-sm leading-6">
              We sent a different code to each address. Both expire after 5
              minutes.
            </p>
          </div>
          <fieldset disabled={busy} className="space-y-5">
            <Field label="Code from your current email" hint={owner.email}>
              <Input
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="off"
                value={currentCode}
                onChange={(event) => setCurrentCode(event.target.value)}
              />
            </Field>
            <Field label="Code from your new email" hint={pending.newEmail}>
              <Input
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="off"
                value={newCode}
                onChange={(event) => setNewCode(event.target.value)}
              />
            </Field>
            <p className="text-sm leading-6 text-muted-foreground">
              You’ll be signed out on all devices. Sign back in with your new
              email. Your old Google connection will be removed; your business
              records won’t change.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={
                  currentCode.length !== 6 ||
                  newCode.length !== 6 ||
                  cooldown.verifySeconds > 0
                }
              >
                {cooldown.verifySeconds
                  ? retryLabel(cooldown.verifySeconds)
                  : "Confirm email change"}
              </Button>
              <Button
                variant="outline"
                type="button"
                onClick={() =>
                  void perform(async () => {
                    await api("/api/account/email", "DELETE");
                    setPending(null);
                    setCurrentCode("");
                    setNewCode("");
                  })
                }
              >
                Cancel change
              </Button>
            </div>
            <Button
              variant="ghost"
              type="button"
              disabled={cooldown.sendSeconds > 0}
              onClick={() => void perform(() => send(pending.newEmail))}
            >
              {cooldown.sendSeconds
                ? retryLabel(cooldown.sendSeconds)
                : "Resend both codes"}
            </Button>
          </fieldset>
        </form>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(() => send(email));
          }}
        >
          <h3 className="font-semibold">Change your email</h3>
          <p className="text-sm leading-6">
            We’ll send a code to your current inbox and your new one to make
            sure they’re both yours.
          </p>
          <fieldset disabled={busy} className="space-y-5">
            <Field label="New email">
              <Input
                required
                type="email"
                maxLength={254}
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Button
              disabled={
                cooldown.sendSeconds > 0 ||
                !email.trim() ||
                email.trim().toLowerCase() === owner.email.toLowerCase()
              }
            >
              {cooldown.sendSeconds
                ? retryLabel(cooldown.sendSeconds)
                : "Send verification codes"}
            </Button>
          </fieldset>
          <p className="text-sm text-muted-foreground">
            Can’t access your current inbox? Ask your installer for account
            recovery.
          </p>
        </form>
      )}
    </div>
  );
}
