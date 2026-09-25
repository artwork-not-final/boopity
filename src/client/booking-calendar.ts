import { workspaceApi } from "./workspace-api";
import type { Pagination } from "../shared/pagination";

export type CalendarBooking = {
  id: string;
  serviceName: string;
  clientName?: string;
  pets: { id: string; name: string }[];
  status: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
};
export type CalendarView = "week" | "month";
const utcDate = (date: string) => new Date(`${date}T12:00:00Z`);
export const dateLabel = (
  date: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
) =>
  new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
    utcDate(date),
  );
export function businessToday(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function addCalendarDays(date: string, count: number) {
  const value = utcDate(date);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}
export function moveCalendar(
  anchor: string,
  view: CalendarView,
  direction: number,
) {
  if (view === "week") return addCalendarDays(anchor, direction * 7);
  const value = utcDate(`${anchor.slice(0, 7)}-01`);
  value.setUTCMonth(value.getUTCMonth() + direction);
  return value.toISOString().slice(0, 10);
}
export function calendarDays(anchor: string, view: CalendarView) {
  const first = view === "month" ? `${anchor.slice(0, 7)}-01` : anchor;
  const from = addCalendarDays(first, -utcDate(first).getUTCDay());
  const last =
    view === "month"
      ? addCalendarDays(moveCalendar(first, "month", 1), -1)
      : addCalendarDays(from, 6);
  const to = addCalendarDays(last, 6 - utcDate(last).getUTCDay());
  const result: string[] = [];
  for (let date = from; date <= to; date = addCalendarDays(date, 1))
    result.push(date);
  return result;
}
export function bookingsForDay<T extends CalendarBooking>(
  bookings: T[],
  date: string,
) {
  return bookings
    .filter((b) => b.startDate <= date && b.endDate >= date)
    .sort(
      (a, b) =>
        (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
        a.id.localeCompare(b.id),
    );
}
export function bookingStatus(status: string) {
  return status === "active"
    ? "Confirmed"
    : status.charAt(0).toUpperCase() + status.slice(1);
}
export function bookingTime(time: string | null) {
  if (!time) return "All day";
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

type CalendarPage = { bookings: CalendarBooking[]; pagination: Pagination };
// Use the existing household-scoped API, not the older SaaS calendar endpoint.
// Read every page before displaying a calendar: a page limit must never imply a
// day is free. The safety bound fails explicitly rather than showing partial data.
export async function loadCalendarBookings(
  params: URLSearchParams,
  signal: AbortSignal,
  read: (path: string, signal: AbortSignal) => Promise<CalendarPage> = (
    path,
    signal,
  ) => workspaceApi<CalendarPage>(path, "GET", undefined, signal),
) {
  const bookings = new Map<string, CalendarBooking>();
  let offset = 0;
  for (let page = 0; page < 100; page++) {
    signal.throwIfAborted();
    const query = new URLSearchParams(params);
    query.set("offset", String(offset));
    const result = await read(`/bookings?${query}`, signal);
    for (const booking of result.bookings) bookings.set(booking.id, booking);
    if (!result.pagination.hasMore) return [...bookings.values()];
    if (result.pagination.limit <= 0 || !result.bookings.length) break;
    offset += result.pagination.limit;
  }
  throw new Error(
    "Too many bookings to show at once. Choose Week or narrow your search.",
  );
}
