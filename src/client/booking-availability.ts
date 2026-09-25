import { useEffect, useState } from "react";
import { businessToday } from "./booking-calendar";
import { workspaceApi } from "./workspace-api";

export type BookingAvailability = {
  slots: { startTime: string | null }[];
  historical?: boolean;
  overlaps?: boolean;
};
export type ScheduleInput = {
  owner: boolean;
  serviceId: string;
  durationMinutes: number | null | undefined;
  date: string;
  endDate: string;
  time: string;
  timeZone: string;
  revision: number;
};
export function usesDirectTime(input: ScheduleInput, now: number) {
  return Boolean(
    input.owner &&
    input.serviceId &&
    input.durationMinutes !== null &&
    input.date &&
    input.date <= businessToday(input.timeZone, new Date(now)),
  );
}
export function availabilityPath(input: ScheduleInput, now: number) {
  if (
    !input.serviceId ||
    !input.date ||
    (input.durationMinutes === null && !input.endDate) ||
    (usesDirectTime(input, now) && !input.time)
  )
    return null;
  return `/availability?${new URLSearchParams({
    serviceId: input.serviceId,
    startDate: input.date,
    ...(input.durationMinutes === null ? { endDate: input.endDate } : {}),
    ...(usesDirectTime(input, now) ? { startTime: input.time } : {}),
  })}`;
}

export function useBookingAvailability(input: ScheduleInput) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, []);
  const path = availabilityPath(input, now);
  const key = `${path}:${input.revision}:${input.timeZone}:${now}`;
  const [state, setState] = useState<{
    key: string;
    data?: BookingAvailability;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void workspaceApi<BookingAvailability>(
      path,
      "GET",
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            key,
            error:
              error instanceof Error
                ? error.message
                : "Unable to check this visit. Try again.",
          });
      });
    return () => controller.abort();
  }, [path, key]);
  // Never enable submission or show a historical warning for an earlier selection.
  const current = path && state?.key === key ? state : null;
  return {
    directTime: usesDirectTime(input, now),
    slots: current?.data?.slots,
    historical: current?.data?.historical === true,
    overlaps: current?.data?.overlaps === true,
    error: current?.error,
    loading: Boolean(path && !current),
  };
}
