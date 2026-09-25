import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api-response";

type Operation = "send" | "verify";

export function retryLabel(seconds: number) {
  return `Try again in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// A convenience for the current form, not a security boundary. The server
// still enforces every limit, including after a refresh or in another browser.
export function useEmailCodeCooldown(email: string) {
  const deadlines = useRef(new Map<string, number>());
  const [{ now }, setClock] = useState(() => ({ now: Date.now() }));
  const recipient = email.trim().toLowerCase();
  useEffect(() => setClock({ now: Date.now() }), [recipient]);
  const remaining = (operation: Operation) =>
    Math.max(
      0,
      Math.ceil(
        ((deadlines.current.get(`${operation}:${recipient}`) ?? 0) - now) /
          1000,
      ),
    );
  const sendSeconds = remaining("send");
  const verifySeconds = remaining("verify");
  const waiting = sendSeconds > 0 || verifySeconds > 0;
  useEffect(() => {
    if (!waiting) return;
    // Use wall-clock deadlines so sleeping/background tabs don't prolong waits.
    const update = () => setClock({ now: Date.now() });
    const timer = window.setInterval(update, 1000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [waiting]);

  async function attempt<T>(operation: Operation, work: () => Promise<T>) {
    const key = `${operation}:${recipient}`;
    const message =
      operation === "send"
        ? "Please wait before requesting another code."
        : "Please wait before trying this code again.";
    if ((deadlines.current.get(key) ?? 0) > Date.now())
      throw new Error(message);
    try {
      const result = await work();
      if (operation === "send") {
        deadlines.current.set(key, Date.now() + 60_000);
        setClock({ now: Date.now() });
      }
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        // A missing/invalid header gets a short UI pause; a later request must
        // still pass the server's limit. Never automatically send another code.
        const seconds = error.retryAfterSeconds ?? 60;
        deadlines.current.set(key, Date.now() + seconds * 1000);
        setClock({ now: Date.now() });
        throw new ApiError(message, error.status, error.requestId, seconds);
      }
      throw error;
    }
  }

  return { attempt, sendSeconds, verifySeconds };
}
