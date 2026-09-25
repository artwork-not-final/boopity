import { describe, expect, it } from "vitest";
import {
  addMinutes,
  addMonths,
  currentDateInZone,
  dateRange,
  nextRecurrenceDate,
  zonedDateTimeToEpoch,
} from "../worker/scheduling";

describe("booking calendar helpers", () => {
  it("keeps calendar arithmetic stable across month ends and date ranges", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(nextRecurrenceDate("2028-02-29", "monthly")).toBe("2028-03-29");
    expect(dateRange("2026-09-04", "2026-09-06")).toEqual([
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
    expect(addMinutes("2026-09-04", "09:45", 30)).toEqual({
      date: "2026-09-04",
      time: "10:15",
    });
  });

  it("converts sitter-local booking times to UTC across daylight-saving offsets", () => {
    expect(
      new Date(
        zonedDateTimeToEpoch("2026-01-15", "09:00", "America/New_York"),
      ).toISOString(),
    ).toBe("2026-01-15T14:00:00.000Z");
    expect(
      new Date(
        zonedDateTimeToEpoch("2026-07-15", "09:00", "America/New_York"),
      ).toISOString(),
    ).toBe("2026-07-15T13:00:00.000Z");
    expect(
      currentDateInZone("America/Los_Angeles", Date.UTC(2026, 0, 1, 2)),
    ).toBe("2025-12-31");
  });

  it("rejects a nonexistent local time during the spring DST jump", () => {
    expect(() =>
      zonedDateTimeToEpoch("2027-03-14", "02:30", "America/New_York"),
    ).toThrow("does not exist");
  });
});
