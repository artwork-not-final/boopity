import type { ReactNode } from "react";
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-muted p-4 text-sm leading-6 text-muted-foreground">
      {children}
    </div>
  );
}
