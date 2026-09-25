import { useState, useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { api } from "../installation-api";
import { Field } from "../InstallationFields";
import type { RunInstallationAction as Run } from "../installation-types";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { retryLabel, useEmailCodeCooldown } from "../auth/useEmailCodeCooldown";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";

export function GuidedClaim({
  busy,
  run,
  after,
}: {
  busy: boolean;
  run: Run;
  after: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [sent, setSent] = useState(false);
  const [otp, setOtp] = useState("");
  const cooldown = useEmailCodeCooldown(email);
  const codeInput = useRef<HTMLInputElement>(null);
  const focusCode = useRef(false);
  useEffect(() => {
    if (!busy && sent && focusCode.current) {
      codeInput.current?.focus();
      focusCode.current = false;
    }
  }, [busy, sent]);
  async function send() {
    await cooldown.attempt("send", () =>
      api("/api/auth/email-otp/send-verification-otp", "POST", {
        email,
        type: "sign-in",
      }),
    );
    focusCode.current = true;
    setOtp("");
    setSent(true);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{sent ? "Check your inbox" : "Verify your email"}</CardTitle>
        <CardDescription>
          {sent
            ? "Enter the six-digit code from your email."
            : "We’ll send a code to verify your email."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              async () => {
                if (!sent) return send();
                try {
                  await cooldown.attempt("verify", () =>
                    api("/api/auth/sign-in/email-otp", "POST", {
                      email,
                      otp,
                      name,
                    }),
                  );
                  await api("/api/setup/owner", "POST", { name });
                  after();
                } finally {
                  setOtp("");
                }
              },
              sent
                ? "Email verified."
                : "Code sent. Check your inbox or spam folder.",
            );
          }}
        >
          <Field label="Your name">
            <Input
              required
              maxLength={100}
              autoComplete="name"
              value={name}
              readOnly={sent}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field
            label="Your email"
            hint="Use the address chosen during hosting setup."
          >
            <Input
              required
              type="email"
              maxLength={254}
              autoComplete="email"
              value={email}
              readOnly={sent}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          {sent && (
            <Field
              label="Six-digit email code"
              hint="Expires in five minutes. Keep it private."
            >
              <Input
                ref={codeInput}
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otp}
                disabled={busy}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          )}
          <Button
            disabled={
              busy ||
              (sent
                ? otp.length !== 6 || cooldown.verifySeconds > 0
                : cooldown.sendSeconds > 0)
            }
          >
            {(sent ? cooldown.verifySeconds : cooldown.sendSeconds) > 0
              ? retryLabel(sent ? cooldown.verifySeconds : cooldown.sendSeconds)
              : sent
                ? "Verify & set up my business"
                : "Send my verification code"}
            <ArrowRight aria-hidden="true" />
          </Button>
          {sent && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy || cooldown.sendSeconds > 0}
                onClick={() =>
                  void run(
                    send,
                    "Your email service accepted a new code. Use the most recent email.",
                  )
                }
              >
                {cooldown.sendSeconds > 0
                  ? retryLabel(cooldown.sendSeconds)
                  : "Send a new code"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setSent(false);
                  setOtp("");
                }}
              >
                Change email
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
