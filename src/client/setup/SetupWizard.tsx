import type { RefObject } from "react";
import type { Branding } from "../../shared/branding";
import type { PublicInfo, SetupState } from "../../shared/api-responses";
import type { RunInstallationAction } from "../installation-types";
import type { SetupStep as Step } from "../setup-flow";
import { ArrowRight } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Notice } from "../InstallationFields";
import { api } from "../installation-api";
import { Login } from "../auth/Login";
import { Appearance } from "../settings/Appearance";
import { EmailSettings } from "../settings/EmailSettings";
import { GoogleSettings } from "../settings/GoogleSettings";
import { Identity } from "./Identity";
import { SetupNavigation } from "./SetupNavigation";
import { steps } from "./steps";

export function SetupWizard({
  setup,
  info,
  busy,
  action,
  step,
  visibleSteps,
  changeSetupStep,
  continueSetup,
  previousStep,
  wizardHeading,
  setPreview,
  navigate,
}: {
  setup: SetupState;
  info: PublicInfo;
  busy: boolean;
  action: RunInstallationAction;
  step: Step;
  visibleSteps: readonly { id: Step; label: string }[];
  changeSetupStep: (step: Step) => void;
  continueSetup: () => void;
  previousStep: Step | undefined;
  wizardHeading: RefObject<HTMLHeadingElement | null>;
  setPreview: (value: Branding | null) => void;
  navigate: (path: string) => void;
}) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
      <SetupNavigation
        steps={visibleSteps}
        current={step}
        busy={busy}
        onSelect={changeSetupStep}
      />
      <Card className="min-w-0">
        <CardHeader>
          {(setup.actor === "recovery" || setup.state === "ready") && (
            <Badge variant="secondary" className="mb-2 w-fit">
              {setup.actor === "recovery"
                ? "Recovery access"
                : "Business settings"}
            </Badge>
          )}
          <CardTitle>
            <h1
              ref={wizardHeading}
              id="setup-content"
              tabIndex={-1}
              data-skip-target
              className="text-2xl tracking-tight"
            >
              {steps.find((item) => item.id === step)!.label}
            </h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {step === "identity" && (
            <Identity
              key={`${setup.pending.email}:${setup.owner?.email}`}
              state={setup}
              busy={busy}
              run={action}
              onContinue={continueSetup}
            />
          )}
          {step === "email" && (
            <EmailSettings
              key={setup.providers.version}
              state={setup}
              busy={busy}
              run={action}
              onContinue={continueSetup}
            />
          )}
          {step === "appearance" && (
            <Appearance
              key={setup.version}
              state={setup}
              busy={busy}
              run={action}
              preview={setPreview}
              onContinue={continueSetup}
            />
          )}
          {step === "verify" &&
            (setup.owner?.verified && setup.pending.mailVerifiedAt ? (
              <>
                <Notice>Email verified.</Notice>
                <Button disabled={busy} onClick={continueSetup}>
                  Continue
                </Button>
              </>
            ) : !setup.owner && setup.canClaimOwner ? (
              <>
                <Notice>Email verified.</Notice>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void action(
                      () => api("/api/setup/owner", "POST", {}),
                      "Owner account confirmed.",
                      continueSetup,
                    )
                  }
                >
                  Confirm owner & continue
                </Button>
              </>
            ) : (
              <Login
                info={info}
                state={setup}
                busy={busy}
                run={action}
                after={() => changeSetupStep("google")}
              />
            ))}
          {step === "google" && (
            <GoogleSettings
              key={setup.providers.version}
              state={setup}
              busy={busy}
              run={action}
              onContinue={continueSetup}
            />
          )}
          {step === "review" && (
            <>
              <div className="space-y-3">
                {[
                  ["Private database", true],
                  ["Private uploads writable", setup.readiness.privateStorage],
                  [
                    "Owner inbox verified",
                    Boolean(
                      setup.owner?.verified && setup.pending.mailVerifiedAt,
                    ),
                  ],
                  ["Email configured", setup.readiness.email],
                  ["Google (optional)", setup.readiness.google],
                ].map(([label, good]) => (
                  <div
                    key={String(label)}
                    className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm"
                  >
                    <span>{label}</span>
                    <Badge variant={good ? "secondary" : "outline"}>
                      {good ? "Ready" : "Not configured"}
                    </Badge>
                  </div>
                ))}
              </div>
              <Notice>
                {setup.readiness.https
                  ? "HTTPS origin configured."
                  : "Local HTTP preview. Use an HTTPS origin and trusted reverse proxy before hosting publicly."}{" "}
                Enable the portal and invite clients to give them access.
              </Notice>
              <Button
                disabled={
                  busy ||
                  setup.actor !== "owner" ||
                  !setup.pending.mailVerifiedAt ||
                  !setup.readiness.email ||
                  !setup.readiness.privateStorage
                }
                onClick={() =>
                  void action(async () => {
                    await api("/api/setup/complete", "POST", {});
                    navigate("/app/bookings");
                  }, "Your setup is saved.")
                }
              >
                Finish setup
                <ArrowRight aria-hidden="true" />
              </Button>
              {setup.actor !== "owner" && (
                <p className="text-sm text-muted-foreground">
                  The verified owner must sign in to finish setup.
                </p>
              )}
            </>
          )}
          {previousStep && (
            <div className="flex border-t pt-5">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => changeSetupStep(previousStep)}
              >
                Back
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
