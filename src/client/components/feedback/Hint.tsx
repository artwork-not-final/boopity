import type { ReactNode } from "react";
export function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg bg-muted px-3 py-2 text-sm leading-6 text-muted-foreground">
      {children}
    </p>
  );
}
