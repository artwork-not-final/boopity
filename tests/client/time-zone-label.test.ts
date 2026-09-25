import { describe, expect, it, vi } from "vitest";
import { timeZoneLabel } from "../../src/client/lib/format/time-zone-label";

describe("booking time zone labels", () => {
  it("uses the same readable name in standard and daylight saving time", () => {
    vi.useFakeTimers();
    try {
      for (const date of ["2026-01-15T12:00:00Z", "2026-07-15T12:00:00Z"]) {
        vi.setSystemTime(new Date(date));
        expect(timeZoneLabel("America/New_York")).toBe(
          "Eastern Time (New York)",
        );
        expect(timeZoneLabel("America/Los_Angeles")).toBe(
          "Pacific Time (Los Angeles)",
        );
      }
    } finally {
      vi.useRealTimers();
    }
  });
  it("handles other regions, UTC and saved aliases", () => {
    expect(timeZoneLabel("Asia/Tokyo")).toBe("Japan Standard Time (Tokyo)");
    expect(timeZoneLabel("Europe/London")).toContain("London");
    expect(timeZoneLabel("UTC")).toBe("UTC");
    expect(timeZoneLabel("Etc/UTC")).toBe("UTC");
    expect(timeZoneLabel("US/Eastern")).toBe(timeZoneLabel("America/New_York"));
  });
  it("preserves unrecognized values without breaking the booking view", () => {
    expect(timeZoneLabel("Unknown/Zone")).toBe("Unknown/Zone");
  });
});
