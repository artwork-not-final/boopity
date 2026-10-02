import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";

export function HostingSetupHelp({
  reason,
  busy,
  check,
}: {
  reason: "password" | "missing" | "email";
  busy: boolean;
  check: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {reason === "password"
            ? "Reset through your hosting account"
            : reason === "email"
              ? "Finish your installation"
              : "Open Boopity from your installer"}
        </CardTitle>
        <CardDescription>
          {reason === "password"
            ? "You’ll do this in the account you used to put Boopity online."
            : reason === "email"
              ? "Finish connecting email in your hosting dashboard, then try again."
              : "Your installer opens a private link so only you can set up your business."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {reason === "password" ? (
          <>
            <ol className="list-decimal space-y-3 pl-5 text-sm leading-6">
              <li>
                Sign in to your hosting account and open your Boopity app.
              </li>
              <li>
                Open its environment settings. Find{" "}
                <code className="break-all font-medium">
                  BOOPITY_SETUP_PASSWORD
                </code>{" "}
                and replace it with a new password of 15–128 characters. Save it
                in your password manager too.
              </li>
              <li>
                Save the change and use your host’s restart or redeploy option.
                Then come back here and enter your new password.
              </li>
            </ol>
            <p className="text-sm leading-6 text-muted-foreground">
              Your saved setup details will stay. Don’t delete the app or its
              storage.
            </p>
          </>
        ) : (
          <>
            {reason === "missing" && (
              <p className="text-sm leading-6">
                Run the Boopity launcher again to open setup. Your saved details
                will stay.
              </p>
            )}
            <p className="text-sm leading-6 text-muted-foreground">
              {reason === "email"
                ? "If someone installed Boopity for you, ask them to help connect email."
                : "If someone installed Boopity for you, ask them for your private setup link."}
            </p>
            {reason === "missing" && (
              <a
                href="https://github.com/artwork-not-final/boopity/blob/main/docs/development/installer-access.md"
                target="_blank"
                rel="noreferrer"
                className="block text-sm text-primary underline underline-offset-4"
              >
                Installing on your own host?
              </a>
            )}
            <Button variant="outline" disabled={busy} onClick={check}>
              Try again
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
