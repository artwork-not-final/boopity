import { useState } from "react";
import type { IntegrationView } from "../../shared/payments";
import { Field } from "./PaymentFields";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "../components/ui/card";
import { workspaceApi as api } from "../workspace-api";
import type { RunWorkspaceAction as Run } from "../workspace-types";

export function IntegrationSettings({
  integration: i,
  run,
  busy,
}: {
  integration: IntegrationView;
  run: Run;
  busy: boolean;
}) {
  const [key, setKey] = useState(""),
    [hook, setHook] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stripe · {i.mode === "test" ? "sandbox" : "live"}</CardTitle>
        <CardDescription>
          {i.enabled ? "Checkout enabled" : "Checkout disabled"} ·{" "}
          {i.managed
            ? "Host-managed credentials"
            : "Installation-managed credentials"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer font-medium">
            Connection instructions
          </summary>
          <div className="mt-3 space-y-3 [overflow-wrap:anywhere]">
            <p>
              Use your host’s secrets vault when available. Never put keys in
              source code or support messages.
            </p>
            <ol className="list-decimal space-y-3 pl-5">
              <li>
                Create a restricted key in your{" "}
                {i.mode === "test" ? "sandbox" : "live"} Stripe account using
                the self-hosting guide’s permissions. Do not use a full-access
                key.
              </li>
              <li>
                Register the webhook below in that same mode with API{" "}
                {i.apiVersion}. Subscribe to checkout.session.completed,
                checkout.session.async_payment_succeeded,
                checkout.session.async_payment_failed, checkout.session.expired,
                refund.created, refund.updated, refund.failed, charge.refunded
                and charge.dispute events.
              </li>
            </ol>
            <p>
              Public webhooks require HTTPS. For local tests, use Stripe CLI
              forwarding. Each destination has its own signing secret; do not
              mix local and hosted secrets.
            </p>
          </div>
        </details>
        <Field label={`Stripe ${i.mode} webhook URL`}>
          {(id) => <Input id={id} readOnly value={i.webhookUrl} />}
        </Field>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api(`/payments/integrations/stripe/${i.mode}`, "PUT", {
                version: i.version,
                key,
                webhookSecret: hook,
              });
              setKey("");
              setHook("");
            }, "Credentials saved locally. No payment was made.");
          }}
        >
          <Field label={`Stripe ${i.mode} restricted API key`}>
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="off"
                value={key}
                disabled={i.managed}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  i.keyPresent
                    ? "Saved — blank keeps it"
                    : "Enter a restricted API key"
                }
              />
            )}
          </Field>
          <Field label={`Stripe ${i.mode} webhook signing secret`}>
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="off"
                value={hook}
                disabled={i.managed}
                onChange={(e) => setHook(e.target.value)}
                placeholder={
                  i.webhookSecretPresent
                    ? "Saved — blank keeps it"
                    : "Enter the signing secret"
                }
              />
            )}
          </Field>
          <Button variant="outline" disabled={busy}>
            {i.managed
              ? "Initialize host-managed integration"
              : "Save Stripe credentials"}
          </Button>
        </form>
        <p>
          Account verification:{" "}
          {i.verified ? `Passed · ${i.accountId}` : "Not verified"}
          <br />
          Signed webhook: {i.webhookVerified ? "Received" : "Not received yet"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy || !i.id}
            onClick={() =>
              void run(
                () =>
                  api(
                    `/payments/integrations/stripe/${i.mode}/verify`,
                    "POST",
                    {},
                  ),
                "Stripe account and mode checked. No money moved.",
              )
            }
          >
            Verify account (read-only)
          </Button>
          <Button
            variant="outline"
            disabled={
              busy ||
              !i.id ||
              (!i.enabled && (!i.verified || !i.webhookVerified))
            }
            onClick={() =>
              void run(
                () =>
                  api(
                    `/payments/integrations/stripe/${i.mode}/enabled`,
                    "PUT",
                    { enabled: !i.enabled, version: i.version },
                  ),
                i.enabled
                  ? "New checkout disabled. Existing payment outcomes still reconcile."
                  : "Checkout enabled for this mode.",
              )
            }
          >
            {i.enabled ? "Disable checkout" : "Enable checkout"}
          </Button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Refresh after receiving a signed Stripe event. Checkout uses your
          Stripe branding. Boopity does not calculate tax, create recurring
          charges or store card details.
        </p>
      </CardContent>
    </Card>
  );
}
