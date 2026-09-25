// Refresh on return, not on a timer. Check again after the request so a form
// opened (or a save started) while offline data is loading cannot be replaced.
export function watchWorkspaceResume<T>({
  windowTarget,
  documentTarget,
  isVisible,
  isOnline,
  canRefresh,
  getKey,
  read,
  apply,
  onError,
  now = Date.now,
}: {
  windowTarget: EventTarget;
  documentTarget: EventTarget;
  isVisible: () => boolean;
  isOnline: () => boolean;
  canRefresh: () => boolean;
  getKey: () => string;
  read: (signal: AbortSignal) => Promise<T>;
  apply: (value: T) => void;
  onError: (error: unknown) => void;
  now?: () => number;
}) {
  let disposed = false;
  let request: AbortController | null = null;
  let lastAttempt = -Infinity;
  const ready = () => !disposed && isVisible() && isOnline() && canRefresh();
  const resume = (event: Event) => {
    if (
      request ||
      !ready() ||
      (event.type !== "online" && now() - lastAttempt < 30_000)
    )
      return;
    lastAttempt = now();
    const key = getKey();
    const controller = new AbortController();
    request = controller;
    void read(controller.signal)
      .then((value) => {
        if (ready() && getKey() === key) apply(value);
      })
      .catch((error: unknown) => {
        if (ready() && getKey() === key) onError(error);
      })
      .finally(() => {
        request = null;
      });
  };
  windowTarget.addEventListener("focus", resume);
  windowTarget.addEventListener("online", resume);
  windowTarget.addEventListener("pageshow", resume);
  documentTarget.addEventListener("visibilitychange", resume);
  return () => {
    disposed = true;
    request?.abort();
    windowTarget.removeEventListener("focus", resume);
    windowTarget.removeEventListener("online", resume);
    windowTarget.removeEventListener("pageshow", resume);
    documentTarget.removeEventListener("visibilitychange", resume);
  };
}

export function hasWorkspaceEditor(root: HTMLElement | null) {
  // Hidden tab forms count too: their drafts must survive while browsing pets.
  return (
    !root ||
    Boolean(root.querySelector("form, [data-refresh-paused]")) ||
    Boolean(
      root.contains(root.ownerDocument.activeElement) &&
      root.ownerDocument.activeElement?.matches(
        "input, textarea, select, [contenteditable=true]",
      ),
    )
  );
}
