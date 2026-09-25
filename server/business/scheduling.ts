const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

function dateParts(date: string): [number, number, number] {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new Error("Invalid calendar date");
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function timeParts(time: string): [number, number] {
  const match = TIME_PATTERN.exec(time);
  if (!match) throw new Error("Invalid time");
  return [Number(match[1]), Number(match[2])];
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const [year, month, day] = dateParts(date);
  const targetMonth = month - 1 + months;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(targetYear, normalizedMonth + 1, 0),
  ).getUTCDate();
  return new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

export function dayOfWeek(date: string): number {
  const [year, month, day] = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function dateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (
    let date = startDate, safety = 0;
    date <= endDate && safety < 400;
    date = addDays(date, 1), safety++
  ) {
    dates.push(date);
  }
  return dates;
}

export function addMinutes(
  date: string,
  time: string,
  minutes: number,
): { date: string; time: string } {
  const [year, month, day] = dateParts(date);
  const [hour, minute] = timeParts(time);
  const value = new Date(
    Date.UTC(year, month - 1, day, hour, minute + minutes),
  );
  return {
    date: value.toISOString().slice(0, 10),
    time: value.toISOString().slice(11, 16),
  };
}

function zonedParts(epoch: number, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(new Date(epoch))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

export function zonedDateTimeToEpoch(
  date: string,
  time: string,
  timeZone: string,
): number {
  const [year, month, day] = dateParts(date);
  const [hour, minute] = timeParts(time);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let epoch = desired;
  for (let attempt = 0; attempt < 3; attempt++) {
    const observed = zonedParts(epoch, timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    epoch += desired - observedAsUtc;
  }
  const roundTrip = zonedParts(epoch, timeZone);
  if (
    roundTrip.year !== year ||
    roundTrip.month !== month ||
    roundTrip.day !== day ||
    roundTrip.hour !== hour ||
    roundTrip.minute !== minute
  ) {
    throw new Error(
      "The selected time does not exist in your configured time zone",
    );
  }
  return epoch;
}

export function currentDateInZone(timeZone: string, now = Date.now()): string {
  const value = zonedParts(now, timeZone);
  return `${value.year.toString().padStart(4, "0")}-${value.month.toString().padStart(2, "0")}-${value.day.toString().padStart(2, "0")}`;
}

export function generateRecurrenceDates(
  firstDate: string,
  frequency: "weekly" | "biweekly" | "monthly",
  endType: "afterOccurrences" | "onDate",
  additionalOccurrences: number | undefined,
  endDate: string | undefined,
): string[] {
  const dates: string[] = [];
  const wanted =
    endType === "afterOccurrences" ? (additionalOccurrences ?? 0) : 52;
  let candidate = firstDate;
  for (let attempt = 0; attempt < 200 && dates.length < wanted; attempt++) {
    candidate =
      frequency === "monthly"
        ? addMonths(candidate, 1)
        : addDays(candidate, frequency === "biweekly" ? 14 : 7);
    if (endType === "onDate" && (!endDate || candidate > endDate)) break;
    dates.push(candidate);
  }
  return dates;
}

export function nextRecurrenceDate(
  date: string,
  frequency: "weekly" | "biweekly" | "monthly",
): string {
  return frequency === "monthly"
    ? addMonths(date, 1)
    : addDays(date, frequency === "biweekly" ? 14 : 7);
}
