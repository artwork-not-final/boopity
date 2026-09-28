import { HTTPException } from "hono/http-exception";
import {
  addDays,
  addMinutes,
  currentDateInZone,
  dateRange,
  dayOfWeek,
  zonedDateTimeToEpoch,
} from "./scheduling";
import {
  policySchema,
  type BookingPolicy,
  type BookingRequest,
} from "../../src/shared/portal";
import type { SqlDatabase } from "../core/contracts";

export type ServiceRate = {
  id: string;
  name: string;
  durationMinutes: number | null;
  priceCents: number;
  additionalPetPriceCents: number;
};
export async function readPolicy(db: SqlDatabase) {
  const row = (await db
    .prepare("SELECT config,version FROM booking_policy WHERE id=1")
    .first<{ config: string; version: number }>())!;
  return {
    ...policySchema.parse(JSON.parse(row.config)),
    version: row.version,
  };
}
/** Reject clock gaps and repeated wall times rather than silently choosing one occurrence. */
export function unambiguousTime(date: string, time: string, zone: string) {
  let epoch: number;
  try {
    epoch = zonedDateTimeToEpoch(date, time, zone);
  } catch {
    throw new HTTPException(400, {
      message:
        "That local time does not exist because the clocks change. Choose another time.",
    });
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const expected = formatter.format(epoch);
  for (let minutes = -180; minutes <= 180; minutes += 15) {
    if (minutes && formatter.format(epoch + minutes * 60_000) === expected)
      throw new HTTPException(400, {
        message:
          "That local time occurs twice when the clocks change. Choose an unambiguous time.",
      });
  }
  return epoch;
}
export function bookingWindow(
  input: BookingRequest,
  service: ServiceRate,
  policy: BookingPolicy,
  zone: string,
  client: boolean,
  now = Date.now(),
) {
  if (client && input.overrides !== undefined)
    throw new HTTPException(403, {
      message: "Only the sitter can make a booking exception.",
    });
  const overrides = { outsideHours: false, waiveNotice: false };
  let endDate = input.endDate ?? input.startDate;
  let startTime: string | null = null,
    endTime: string | null = null;
  if (service.durationMinutes !== null) {
    if (!input.startTime)
      throw new HTTPException(400, { message: "Choose a start time." });
    startTime = input.startTime;
    const end = addMinutes(input.startDate, startTime, service.durationMinutes);
    if (
      end.date !== input.startDate ||
      (input.endDate && input.endDate !== input.startDate)
    )
      throw new HTTPException(400, {
        message: "Timed visits must start and finish on the same local date.",
      });
    endDate = input.startDate;
    endTime = end.time;
  } else if (input.startTime)
    throw new HTTPException(400, {
      message: "All-day services do not take a start time.",
    });
  const days = dateRange(input.startDate, endDate);
  if (!days.length || days.length > 31 || days.at(-1) !== endDate)
    throw new HTTPException(400, { message: "Choose a stay of 1 to 31 days." });
  const startAt = unambiguousTime(input.startDate, startTime ?? "00:00", zone);
  const endAt = unambiguousTime(
    endTime ? endDate : addDays(endDate, 1),
    endTime ?? "00:00",
    zone,
  );
  if (
    endAt <= startAt ||
    (service.durationMinutes !== null &&
      endAt - startAt !== service.durationMinutes * 60_000)
  )
    throw new HTTPException(400, {
      message: "This visit crosses a clock change. Choose another time.",
    });
  const historical = !client && endAt <= now;
  if (!historical && startAt <= now)
    throw new HTTPException(409, {
      message: client
        ? `Allow at least ${policy.leadHours} hours of booking notice.`
        : "Choose a future visit or a past visit that has already ended.",
    });
  if (!historical && startAt < now + policy.leadHours * 3_600_000) {
    if (!input.overrides?.waiveNotice)
      throw new HTTPException(409, {
        message: `Allow at least ${policy.leadHours} hours of booking notice.`,
      });
    overrides.waiveNotice = true;
  }
  if (endDate > addDays(currentDateInZone(zone, now), policy.horizonDays))
    throw new HTTPException(409, {
      message: `Choose dates within the next ${policy.horizonDays} calendar days.`,
    });
  // Current opening hours and blocked dates do not describe work already done.
  for (const day of historical ? [] : days) {
    if (policy.blockedDates.includes(day))
      throw new HTTPException(409, {
        message: "The business is unavailable on one of these dates.",
      });
    const slot = policy.weekly.find((slot) => slot.day === dayOfWeek(day));
    if (
      !slot ||
      (startTime && (startTime < slot.start || endTime! > slot.end))
    ) {
      if (!input.overrides?.outsideHours)
        throw new HTTPException(409, {
          message:
            !client && !policy.weekly.length
              ? "Set your booking hours in Portal & rules, or choose to book outside opening hours."
              : "Choose a visit within the business's opening days and hours.",
        });
      overrides.outsideHours = true;
    }
  }
  const petCount = input.petIds.length;
  const perDay =
    service.additionalPetPriceCents > 0
      ? service.priceCents + (petCount - 1) * service.additionalPetPriceCents
      : service.priceCents * petCount;
  const total = perDay * days.length;
  if (!Number.isSafeInteger(total) || total <= 0 || total > 99_999_999)
    throw new HTTPException(400, {
      message: "This booking exceeds the supported amount. Contact the sitter.",
    });
  return {
    historical,
    overrides,
    startAt,
    endAt,
    startDate: input.startDate,
    endDate,
    startTime,
    endTime,
    total,
    days: days.length,
  };
}
