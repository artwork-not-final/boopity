import { Component, type ReactNode } from "react";
import { Button } from "./components/ui/button";

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-5 py-12 text-foreground">
        <section
          role="alert"
          className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-8 text-center shadow-sm"
        >
          <h1 className="text-xl font-semibold">This page couldn’t load</h1>
          <p className="text-sm text-muted-foreground">
            Reload to try again. If it keeps happening, contact your site
            administrator.
          </p>
          <Button onClick={() => window.location.reload()}>Reload page</Button>
        </section>
      </main>
    );
  }
}
