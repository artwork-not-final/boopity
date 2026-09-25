import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  availabilityPath,
  usesDirectTime,
  type ScheduleInput,
} from "../src/client/booking-availability";
import { BookingAvailabilityNotice } from "../src/client/BookingAvailabilityNotice";

const now = Date.UTC(2026, 8, 14, 2); // Still September 13 in New York.
const input: ScheduleInput = {
  owner: true,
  serviceId: "walk",
  durationMinutes: 30,
  date: "2026-09-13",
  endDate: "",
  time: "13:07",
  timeZone: "America/New_York",
  revision: 1,
};

describe("past-booking availability selection", () => {
  it("uses the business date, not UTC or the browser zone, for direct entry", () => {
    expect(usesDirectTime(input, now)).toBe(true);
    expect(usesDirectTime({ ...input, date: "2026-09-14" }, now)).toBe(false);
    expect(
      usesDirectTime(
        { ...input, date: "2026-09-14", timeZone: "Asia/Tokyo" },
        now,
      ),
    ).toBe(true);
  });
  it("lets sitters enter exact past/today times but keeps client slot selection", () => {
    expect(availabilityPath(input, now)).toContain("startTime=13%3A07");
    expect(usesDirectTime({ ...input, owner: false }, now)).toBe(false);
    expect(availabilityPath({ ...input, owner: false }, now)).not.toContain(
      "startTime",
    );
  });
  it("waits for complete direct-time and all-day selections before requesting", () => {
    expect(availabilityPath({ ...input, time: "" }, now)).toBeNull();
    expect(availabilityPath({ ...input, date: "" }, now)).toBeNull();
    expect(availabilityPath({ ...input, serviceId: "" }, now)).toBeNull();
    expect(
      availabilityPath({ ...input, durationMinutes: null }, now),
    ).toBeNull();
    const path = availabilityPath(
      { ...input, durationMinutes: null, endDate: "2026-09-13" },
      now,
    );
    expect(path).toContain("endDate=2026-09-13");
    expect(path).not.toContain("startTime");
  });
  it("drops stale direct times when returning to a future date", () => {
    const path = availabilityPath({ ...input, date: "2026-09-21" }, now);
    expect(path).toContain("startDate=2026-09-21");
    expect(path).not.toContain("startTime");
  });
  it("does not send a client-controlled historical bypass flag", () => {
    expect(availabilityPath(input, now)).not.toContain("historical");
    expect(availabilityPath({ ...input, owner: false }, now)).not.toContain(
      "owner",
    );
  });
  it("warns without blocking completed historical records, and removes notices for future dates", () => {
    const html = renderToStaticMarkup(
      createElement(BookingAvailabilityNotice, {
        historical: true,
        overlaps: true,
      }),
    );
    expect(html).toContain("recorded as completed");
    expect(html).toContain("payment tracked separately");
    expect(html).toContain("check that it isn’t a duplicate");
    expect(html).not.toContain("<button");
    expect(
      renderToStaticMarkup(
        createElement(BookingAvailabilityNotice, {
          historical: false,
          overlaps: true,
        }),
      ),
    ).toBe("");
  });
});
