import { ArrowRight, MailOpen } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";

export function InvitationWelcome({
  businessName,
  signedInEmail,
  invitedEmail,
  busy,
  error,
  onAccept,
  onSwitchAccount,
}: {
  businessName: string;
  signedInEmail: string;
  invitedEmail: string | null;
  busy: boolean;
  error?: string;
  onAccept: () => void;
  onSwitchAccount: () => void;
}) {
  // Presentation only; accepting still requires server-side invitation checks.
  const matches =
    invitedEmail !== null &&
    invitedEmail.toLowerCase() === signedInEmail.toLowerCase();
  return (
    <Card
      className="mx-auto w-full max-w-md gap-0 rounded-2xl py-0"
      aria-busy={busy}
    >
      <CardContent className="p-6 text-center sm:p-8">
        <span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-muted text-foreground">
          <MailOpen className="size-6" aria-hidden="true" />
        </span>
        <div className="space-y-3">
          <h1 className="break-words text-2xl font-semibold leading-tight tracking-tight">
            {matches
              ? `Welcome to ${businessName}`
              : invitedEmail
                ? "Use your invited email"
                : "Open your invitation"}
          </h1>
          {matches ? (
            <p className="text-sm leading-6 text-muted-foreground">
              View your pets and manage bookings with your sitter.
            </p>
          ) : invitedEmail ? (
            <div className="space-y-3 text-sm leading-6 text-muted-foreground">
              <p>
                This invitation is for{" "}
                <span className="break-all font-medium text-foreground">
                  {invitedEmail}
                </span>
                .
              </p>
              <p>
                You’re signed in as{" "}
                <span className="break-all">{signedInEmail}</span>. Switch
                accounts to continue.
              </p>
            </div>
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">
              Open the invitation link from your sitter. If it has expired, ask
              them for a new one.
            </p>
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="mt-5 break-words rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-left text-sm leading-6 text-destructive"
          >
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2">
          {matches && (
            <Button
              type="button"
              className="h-auto min-h-11 w-full whitespace-normal"
              disabled={busy}
              onClick={onAccept}
            >
              Accept invitation
              <ArrowRight aria-hidden="true" />
            </Button>
          )}
          <Button
            type="button"
            variant={matches ? "link" : invitedEmail ? "default" : "outline"}
            className={
              matches
                ? "h-auto min-h-11 w-full whitespace-normal font-normal text-muted-foreground hover:text-foreground"
                : "h-auto min-h-11 w-full whitespace-normal"
            }
            disabled={busy}
            onClick={onSwitchAccount}
          >
            Use another email
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
