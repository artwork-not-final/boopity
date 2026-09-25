export function SkipLink({ targetId }: { targetId: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="fixed -top-4 left-4 z-50 -translate-y-full rounded-md border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-sm focus:top-4 focus:translate-y-0"
      onClick={(event) => {
        const target = document.getElementById(targetId);
        if (target) {
          event.preventDefault();
          target.focus();
        }
      }}
    >
      Skip to content
    </a>
  );
}
