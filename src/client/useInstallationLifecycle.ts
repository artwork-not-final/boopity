import { useEffect, useEffectEvent, useRef } from "react";
import { readSetupLink } from "../shared/setup-link";
import { api } from "./installation-api";

// Initial invitation/setup credentials are consumed only from memory. Resuming
// a tab refreshes server state; it never replays a mutation or login action.
export function useInstallationLifecycle({
  inviteToken,
  hasSetupLink,
  invalidSetupLink,
  refresh,
  reportRefreshError,
  setHasSetupLink,
  setSetupLinkToken,
  setMessage,
  setError,
}: {
  inviteToken: string | null;
  hasSetupLink: boolean;
  invalidSetupLink: boolean;
  refresh: () => Promise<void>;
  reportRefreshError: (error: unknown) => void;
  setHasSetupLink: (value: boolean) => void;
  setSetupLinkToken: (value: string | null) => void;
  setMessage: (value: string) => void;
  setError: (value: string) => void;
}) {
  const initialized = useRef(false);
  const refreshLatest = useEffectEvent(refresh);
  const reportLatest = useEffectEvent(reportRefreshError);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const providerError = new URLSearchParams(window.location.search).get(
      "error",
    );
    if (providerError)
      setError(
        providerError === "account_not_linked"
          ? "Sign in with an email code, then try Google with the same owner or invited client email."
          : "Google sign-in failed. Try an email code or contact the sitter.",
      );
    // Remove private fragments before any requests. Keep setup credentials only
    // in memory until explicit confirmation, never in storage or callback URLs.
    if (inviteToken || hasSetupLink)
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    if (invalidSetupLink)
      setError(
        "This setup link is incomplete. Use your setup password, or ask your installer for a new link.",
      );
    void (async () => {
      try {
        if (inviteToken && !hasSetupLink)
          await api("/api/portal/invitation/open", "POST", {
            token: inviteToken,
          });
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Unable to open this invitation.",
        );
      }
      await refreshLatest();
    })().catch(reportLatest);
  }, [hasSetupLink, invalidSetupLink, inviteToken, setError]);
  useEffect(() => {
    // Opening a new fragment on this same page does not remount React. Handle
    // that navigation too, removing the credential before updating the UI.
    const openSetupLink = () => {
      const link = readSetupLink(window.location.hash);
      if (!link.present) return;
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      setHasSetupLink(true);
      setSetupLinkToken(link.token);
      setMessage("");
      setError(
        link.token
          ? ""
          : "This setup link is incomplete. Use your setup password, or ask your installer for a new link.",
      );
    };
    window.addEventListener("hashchange", openSetupLink);
    return () => window.removeEventListener("hashchange", openSetupLink);
  }, [setHasSetupLink, setSetupLinkToken, setMessage, setError]);
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible")
        void refreshLatest().catch(reportLatest);
    };
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    return () => {
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
    };
  }, []);
}
