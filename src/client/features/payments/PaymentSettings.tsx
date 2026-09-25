import { useState, useRef, useEffect } from "react";
import {
  paymentSettingsResponse,
  type PaymentSettingsData,
} from "../../../shared/api-responses";
import { IntegrationSettings } from "./IntegrationSettings";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "../../components/ui/card";
import { workspaceApi as api } from "../../lib/http/workspace-api";
import type { RunWorkspaceAction as Run } from "../../lib/types/workspace-types";

export function PaymentSettings({
  run,
  busy,
  onError,
}: {
  run: Run;
  busy: boolean;
  onError: (e: unknown) => Promise<void>;
}) {
  const [data, setData] = useState<PaymentSettingsData | null>(null),
    [confirmLive, setConfirmLive] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const reportError = useRef(onError);
  useEffect(() => {
    reportError.current = onError;
  }, [onError]);
  async function refresh() {
    if (!mounted.current) return false;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await api(
        "/payments/integrations",
        "GET",
        undefined,
        controller.signal,
        paymentSettingsResponse,
      );
      if (controller.signal.aborted) return false;
      setData(result);
      return true;
    } catch (failure) {
      if (controller.signal.aborted) return false;
      setError(
        failure instanceof Error
          ? failure.message
          : "Payment setup couldn't load.",
      );
      // Keep this local retry available even if the parent's access check fails.
      await reportError.current(failure).catch(() => {});
      return false;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  const work: Run = (task, message) =>
    run(async () => {
      await task();
      if (!(await refresh()) && mounted.current)
        throw new Error(
          "Your change was saved, but payment setup couldn't refresh. Retry loading payment setup.",
        );
    }, message);
  const unavailable = busy || loading || Boolean(error);
  return (
    <section
      aria-label="Payment setup"
      aria-busy={loading}
      className="space-y-6"
    >
      {loading && <p role="status">Loading payment setup…</p>}
      {error && (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy || loading}
            onClick={() => void refresh()}
          >
            Retry payment setup
          </Button>
        </div>
      )}
      {data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
              <CardDescription>
                Record payments manually or accept them through your Stripe
                account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p>
                Online payments:{" "}
                <strong>
                  {data.settings.mode === "test"
                    ? "Sandbox · no real money"
                    : "Live · real payments"}
                </strong>
                . Test and actual balances stay separate.
              </p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={confirmLive}
                  disabled={unavailable}
                  onChange={(e) => setConfirmLive(e.target.checked)}
                />
                I understand live mode lets clients make real payments.
              </label>
              <div className="flex flex-wrap gap-3">
                {(["test", "live"] as const).map((mode) => (
                  <Button
                    key={mode}
                    variant="outline"
                    disabled={
                      unavailable ||
                      mode === data.settings.mode ||
                      (mode === "live" && !confirmLive)
                    }
                    onClick={() =>
                      void work(
                        () =>
                          api("/payments/mode", "PUT", {
                            mode,
                            version: data.settings.version,
                            confirmLive,
                          }),
                        `Online payment mode changed to ${mode}.`,
                      )
                    }
                  >
                    Use {mode === "test" ? "sandbox" : "live"} mode
                  </Button>
                ))}
              </div>
              <p>
                Saved credentials are encrypted. Blank fields keep saved values.
                Saving credentials disables new checkout until you re-enable it.
              </p>
              <Button
                variant="outline"
                disabled={busy || loading}
                onClick={() => void refresh()}
              >
                Refresh payment setup
              </Button>
            </CardContent>
          </Card>
          <div className="grid items-start gap-6 xl:grid-cols-2">
            {data.integrations.map((i) => (
              <IntegrationSettings
                key={`${i.mode}:${i.version}`}
                integration={i}
                run={work}
                busy={unavailable}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
