import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";

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
            : "Finish your installation"}
        </CardTitle>
        <CardDescription>
          {reason === "password"
            ? "You’ll do this in the account you used to put Boopity online."
            : reason === "email"
              ? "Finish connecting email in your hosting dashboard, then try again."
              : "Choose a setup password in your hosting dashboard, then restart Boopity."}
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
            <p className="text-sm leading-6 text-muted-foreground">
              If someone installed Boopity for you, ask them to help with this
              step.
            </p>
            <Button variant="outline" disabled={busy} onClick={check}>
              Try again
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
