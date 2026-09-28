import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { Check, CircleCheck, X } from "lucide-react";
import { Button } from "../ui/button";
import type {
  ActionFeedback,
  SavedFeedback,
} from "../../lib/types/action-feedback";

const FeedbackContext = createContext<{
  feedback: ActionFeedback;
  dismiss: () => void;
  busy: boolean;
}>({ feedback: "", dismiss: () => {}, busy: false });

export function ActionFeedbackProvider({
  feedback,
  dismiss,
  busy = false,
  children,
}: {
  feedback: ActionFeedback;
  dismiss: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <FeedbackContext value={{ feedback, dismiss, busy }}>
      {children}
    </FeedbackContext>
  );
}

/** Keep a confirmed save through server-driven form remounts, but clear it
 * when this form's draft changes. Never clear errors or another form's result.
 */
export function useSaveFeedback(
  target: string,
  draft: readonly unknown[] = [],
): SavedFeedback {
  const { feedback, dismiss, busy } = useContext(FeedbackContext);
  const previous = useRef(draft);
  const wasBusy = useRef(busy);
  const editedDuringSave = useRef(false);
  useEffect(() => {
    const changed =
      previous.current.length !== draft.length ||
      draft.some((value, index) => !Object.is(value, previous.current[index]));
    previous.current = draft;
    if (busy && !wasBusy.current) editedDuringSave.current = false;
    if (busy && changed) editedDuringSave.current = true;
    wasBusy.current = busy;
    if (!changed && !editedDuringSave.current) return;
    if (
      typeof feedback === "object" &&
      "saved" in feedback &&
      feedback.saved === target
    ) {
      editedDuringSave.current = false;
      dismiss();
    }
  }, [draft, target, feedback, dismiss, busy]);
  return { saved: target };
}

export function SavedStatus({ feedback: target }: { feedback: SavedFeedback }) {
  const { feedback } = useContext(FeedbackContext);
  const saved =
    typeof feedback === "object" &&
    "saved" in feedback &&
    feedback.saved === target.saved;
  return (
    <span
      role="status"
      aria-atomic="true"
      className="inline-flex items-center gap-1.5 text-sm text-foreground"
    >
      {saved && (
        <>
          <Check aria-hidden="true" className="size-4" />
          Saved
        </>
      )}
    </span>
  );
}

export function ActionConfirmation({
  feedback,
  dismiss,
}: {
  feedback: ActionFeedback;
  dismiss?: () => void;
}) {
  if (typeof feedback !== "string") {
    return "announcement" in feedback ? (
      <span role="status" className="sr-only">
        {feedback.announcement}
      </span>
    ) : null;
  }
  if (!feedback) return null;
  return (
    <div className="flex w-fit max-w-full items-start gap-2 rounded-md border-l-4 border-primary bg-secondary px-3 py-2 text-sm text-foreground">
      <p
        role="status"
        className="flex min-w-0 items-start gap-2 break-words leading-6"
      >
        <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <span className="min-w-0 break-words">{feedback}</span>
      </p>
      {dismiss && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Dismiss confirmation"
          onClick={dismiss}
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
