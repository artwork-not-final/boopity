import type { CSSProperties, ReactNode } from "react";
import { LogOut, PawPrint } from "lucide-react";
import { Button } from "./components/ui/button";
import { SkipLink } from "./SkipLink";
import { brandingVariables, type Branding } from "../shared/branding";

export function BrandLayout({
  active,
  siteName,
  version,
  centeredEntryPage,
  skipTarget,
  showSignOut,
  busy,
  onSignOut,
  children,
}: {
  active: Branding;
  siteName: string;
  version?: number;
  centeredEntryPage: boolean;
  skipTarget: string;
  showSignOut: boolean;
  busy: boolean;
  onSignOut: () => Promise<unknown>;
  children: ReactNode;
}) {
  return (
    <div
      data-boopity-theme
      className={centeredEntryPage ? "flex min-h-svh flex-col" : "min-h-screen"}
      style={brandingVariables(active) as CSSProperties}
    >
      <SkipLink targetId={skipTarget} />
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {active.logoUrl ? (
              <img
                key={version}
                src={active.logoUrl}
                alt={`${siteName} logo`}
                className="size-9 shrink-0 rounded-lg object-contain"
              />
            ) : (
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <PawPrint className="size-5" aria-hidden="true" />
              </span>
            )}
            <span className="truncate font-semibold tracking-tight">
              {siteName}
            </span>
          </div>
          {showSignOut ? (
            <Button
              aria-label="Sign out"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void onSignOut()}
            >
              <LogOut aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          ) : null}
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        data-skip-target
        className={
          centeredEntryPage
            ? "mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6 sm:py-14"
            : "mx-auto max-w-7xl px-4 py-6 sm:px-6"
        }
      >
        {children}
      </main>
      <footer
        className={
          centeredEntryPage
            ? "mx-auto flex w-full max-w-7xl justify-center px-4 py-5 text-xs text-muted-foreground sm:px-6"
            : "mx-auto flex max-w-7xl justify-end px-4 py-4 text-xs text-muted-foreground sm:px-6"
        }
      >
        <span>
          Powered by{" "}
          <strong className="font-semibold text-foreground">Boopity</strong>
        </span>
      </footer>
    </div>
  );
}
