import { useState, useEffect, useRef, type FormEvent } from "react";
import { ArrowRight, LogIn } from "lucide-react";
import type { PublicInfo, SetupState } from "../../shared/api-responses";
import { ownerDestination } from "../SettingsLayout";
import { api } from "../installation-api";
import { Field, Notice } from "../InstallationFields";
import type { RunInstallationAction as Run } from "../installation-types";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { retryLabel, useEmailCodeCooldown } from "./useEmailCodeCooldown";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";

export function Login({
  info,
  state,
  busy,
  run,
  after,
  suggestedEmail,
  verifyEmail = false,
  resumeSetup = false,
  standalone = false,
  error,
  message,
}: {
  info: PublicInfo;
  state?: SetupState;
  busy: boolean;
  run: Run;
  after: () => void;
  suggestedEmail?: string;
  verifyEmail?: boolean;
  resumeSetup?: boolean;
  standalone?: boolean;
  error?: string;
  message?: string;
}) {
  const fixed = state?.owner?.email ?? state?.pending.email ?? suggestedEmail;
  const [email, setEmail] = useState(fixed ?? ""),
    [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const cooldown = useEmailCodeCooldown(email);
  const codeInput = useRef<HTMLInputElement>(null);
  const focusCode = useRef(false);
  useEffect(() => {
    // The action keeps inputs disabled through the session refresh. Wait until
    // the code field can receive focus, and only move it after a successful send.
    if (!busy && sent && focusCode.current) {
      codeInput.current?.focus();
      focusCode.current = false;
    }
  }, [busy, sent]);
  useEffect(() => {
    if (fixed) setEmail(fixed);
  }, [fixed]);
  const send = () =>
    run(
      async () => {
        await cooldown.attempt("send", () =>
          api("/api/auth/email-otp/send-verification-otp", "POST", {
            email,
            type: "sign-in",
          }),
        );
        focusCode.current = true;
        setSent(true);
      },
      standalone
        ? "Check your email. Code expires in 5 minutes."
        : "Check your inbox for a code. It expires in five minutes.",
    );
  const verify = (event: FormEvent) => {
    event.preventDefault();
    void run(
      async () => {
        await cooldown.attempt("verify", () =>
          api("/api/auth/sign-in/email-otp", "POST", {
            email,
            otp,
            name: state?.pending.name ?? "Client",
          }),
        );
        if (state && !state.owner) await api("/api/setup/owner", "POST", {});
        setOtp("");
      },
      state && !state.owner
        ? "Inbox verified. Your owner account is now established."
        : verifyEmail
          ? "Email delivery verified."
          : resumeSetup
            ? "Welcome back. Continue where you left off."
            : "Signed in successfully.",
      after,
    );
  };
  const content = (
    <div className={standalone ? "space-y-5 text-left" : "space-y-5"}>
      {state?.actor === "recovery" && (
        <Notice>
          Repair email settings here, then verify the existing owner inbox.
          Recovery access alone cannot finish setup.
        </Notice>
      )}
      <Field label={standalone ? "Email" : "Email address"}>
        <Input
          type="email"
          className={standalone ? "min-h-11" : undefined}
          autoComplete="email"
          value={email}
          readOnly={Boolean(fixed)}
          disabled={busy}
          onChange={(e) => {
            setEmail(e.target.value);
            if (resumeSetup) {
              setSent(false);
              setOtp("");
            }
          }}
        />
      </Field>
      <Button
        className={
          standalone ? "h-auto min-h-11 w-full whitespace-normal" : undefined
        }
        variant={resumeSetup && !sent ? "default" : "outline"}
        disabled={
          busy || !email || !info.login.email || cooldown.sendSeconds > 0
        }
        onClick={() => void send()}
      >
        {cooldown.sendSeconds > 0
          ? retryLabel(cooldown.sendSeconds)
          : verifyEmail
            ? "Send test code"
            : resumeSetup
              ? sent
                ? "Send another code"
                : "Send sign-in code"
              : standalone
                ? sent
                  ? "Resend code"
                  : "Send code"
                : "Send sign-in code"}
      </Button>
      {!info.login.email && (
        <p className="text-sm text-muted-foreground">
          {standalone ? (
            "Email sign-in is unavailable."
          ) : (
            <>
              Email delivery is not configured.{" "}
              {verifyEmail
                ? "Save an email provider above first."
                : "Complete the Email delivery step or use server recovery."}
            </>
          )}
        </p>
      )}
      {(!resumeSetup || sent) && (
        <form className="space-y-5" onSubmit={verify}>
          <Field
            label={standalone ? "6-digit code" : "Six-digit code"}
            hint={
              standalone
                ? undefined
                : "Use the latest email code. Keep it private."
            }
          >
            <Input
              ref={codeInput}
              required
              className={standalone ? "min-h-11" : undefined}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={otp}
              disabled={busy}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Button
            className={
              standalone
                ? "h-auto min-h-11 w-full whitespace-normal"
                : undefined
            }
            disabled={
              busy || !email || otp.length !== 6 || cooldown.verifySeconds > 0
            }
          >
            {cooldown.verifySeconds > 0
              ? retryLabel(cooldown.verifySeconds)
              : state && !state.owner
                ? "Verify inbox & create owner"
                : verifyEmail
                  ? "Verify email delivery"
                  : resumeSetup
                    ? "Verify & continue"
                    : standalone
                      ? "Sign in"
                      : "Verify & sign in"}
            <ArrowRight aria-hidden="true" />
          </Button>
        </form>
      )}
      {!verifyEmail && info.ownerClaimed && info.login.google && (
        <Button
          className={
            standalone ? "h-auto min-h-11 w-full whitespace-normal" : "w-full"
          }
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await api<{ url: string }>(
                "/api/auth/sign-in/social",
                "POST",
                {
                  provider: "google",
                  callbackURL: ownerDestination(
                    window.location.pathname,
                    window.location.search,
                  ).path,
                  errorCallbackURL: "/login",
                },
              );
              const destination = new URL(result.url);
              if (destination.origin !== "https://accounts.google.com")
                throw new Error("Unexpected Google sign-in address.");
              window.location.assign(destination.href);
            }, "Opening Google…")
          }
        >
          Continue with Google
        </Button>
      )}
      {!standalone && !verifyEmail && !fixed && !resumeSetup && (
        <p className="text-xs leading-5 text-muted-foreground">
          Use your owner email or the address your sitter invited.
        </p>
      )}
    </div>
  );
  return state ? (
    content
  ) : standalone ? (
    <Card
      className="mx-auto w-full max-w-md gap-0 rounded-2xl py-0"
      aria-busy={busy}
    >
      <CardContent className="p-6 text-center sm:p-8">
        <span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-muted text-foreground">
          <LogIn className="size-6" aria-hidden="true" />
        </span>
        <h1 className="break-words text-2xl font-semibold leading-tight tracking-tight">
          Sign in
        </h1>
        {error && (
          <p
            role="alert"
            className="mt-5 break-words rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-left text-sm leading-6 text-destructive"
          >
            {error}
          </p>
        )}
        {message && (
          <p
            role="status"
            className="mt-5 break-words rounded-lg bg-muted p-3 text-left text-sm leading-6"
          >
            {message}
          </p>
        )}
        <div className="mt-6">{content}</div>
      </CardContent>
    </Card>
  ) : (
    <Card>
      <CardHeader>
        <CardTitle>{resumeSetup ? "Welcome back" : "Email sign-in"}</CardTitle>
        <CardDescription>
          {resumeSetup
            ? "Enter the email you saved during setup. We’ll send a code so you can continue."
            : "We'll email you a sign-in code."}
        </CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
