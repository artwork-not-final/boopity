import { LoaderCircle } from "lucide-react";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex min-h-40 w-full items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <LoaderCircle
        className="size-4 motion-safe:animate-spin"
        aria-hidden="true"
      />
      <span>{label}</span>
    </div>
  );
}
