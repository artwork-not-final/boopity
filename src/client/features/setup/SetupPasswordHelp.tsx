import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";

export function SetupPasswordHelp({
  busy,
  onResetHelp,
}: {
  busy: boolean;
  onResetHelp: () => void;
}) {
  return (
    <Card className="gap-0 rounded-2xl py-0">
      <CardContent className="space-y-5 p-6 sm:p-8">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Let’s find your password</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            This is the password chosen when Boopity was installed, unless you
            changed it during setup.
          </p>
        </div>
        <ul className="list-disc space-y-3 pl-5 text-sm leading-6">
          <li>
            Check your browser’s saved passwords or your password manager. Look
            for Boopity or your website address.
          </li>
          <li>
            If someone set it up for you, ask them for the setup password.
          </li>
        </ul>
        <p className="text-sm leading-6 text-muted-foreground">
          Email recovery isn’t available for this installation yet.
        </p>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-11 w-full whitespace-normal"
          disabled={busy}
          onClick={onResetHelp}
        >
          I still can’t find it
        </Button>
      </CardContent>
    </Card>
  );
}
