import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CancellationList,
  CancellationReview,
  CancellationEmpty,
  type Cancellation,
} from "../src/client/features/bookings/Cancellations";

const item: Cancellation = {
  bookingId: "booking-a",
  bookingStatus: "cancelled",
  reason: "Review payment and cancellation terms.",
  clientName: "Alex River",
  serviceName: "Dog walking",
  startDate: "2030-01-07",
  endDate: "2030-01-07",
  startTime: "14:30",
  timeZone: "America/New_York",
  createdAt: Date.UTC(2029, 11, 15, 18),
  resolvedAt: null,
  resolution: "",
};
const renderList = (changes: Partial<Cancellation> = {}, busy = false) =>
  renderToStaticMarkup(
    createElement(CancellationList, {
      cancellations: [{ ...item, ...changes }],
      busy,
      timeZone: "America/New_York",
      onSelect: vi.fn(),
    }),
  );
const renderReview = (changes: Partial<Cancellation> = {}, busy = false) =>
  renderToStaticMarkup(
    createElement(CancellationReview, {
      item: { ...item, ...changes },
      timeZone: "America/New_York",
      busy,
      onResolve: vi.fn(),
    }),
  );
afterEach(() => vi.unstubAllGlobals());
describe("cancellation review queue", () => {
  it("uses flat keyboard-accessible rows without nested actions or inline forms", () => {
    const html = renderList();
    expect(html).toContain('aria-label="Cancellations"');
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toContain("rounded-none");
    expect(html).toContain("hover:bg-muted");
    expect(html).not.toMatch(/<form|<input|<textarea|<details|<summary/);
    expect(html).toContain("Review cancellation:");
    expect(html).toContain("Needs review");
  });
  it("shows readable booking dates and times", () => {
    const html = renderList({ endDate: "2030-01-09" });
    expect(html).toContain("Jan 7, 2030 – Jan 9, 2030");
    expect(html).toContain("2:30 PM");
    expect(renderList({ startTime: null })).toContain("All day");
    expect(renderList({ timeZone: "America/Los_Angeles" })).toContain(
      "Pacific Time (Los Angeles)",
    );
    expect(html).not.toContain("America/New_York");
  });
  it("distinguishes reviewed rows and disables navigation while saving", () => {
    expect(renderList({ resolvedAt: 0 })).toContain("View cancellation:");
    expect(renderList({ resolvedAt: 0 })).toContain("Reviewed");
    expect(renderList({}, true)).toContain('disabled=""');
  });
  it("opens the selected cancellation", () => {
    const onSelect = vi.fn();
    const tree = CancellationList({
      cancellations: [item],
      busy: false,
      timeZone: "America/New_York",
      onSelect,
    })!;
    tree.props.children[0].props.children.props.onClick();
    expect(onSelect).toHaveBeenCalledWith("booking-a");
  });
  it("does not render an empty list outline", () => {
    expect(
      CancellationList({
        cancellations: [],
        busy: false,
        timeZone: "America/New_York",
        onSelect: vi.fn(),
      }),
    ).toBeNull();
  });
  it.each([
    ["open", false, "No cancellations need review"],
    ["resolved", false, "No reviewed cancellations yet"],
    ["all", false, "No cancellations yet"],
    ["open", true, "No matching cancellations"],
  ] as const)(
    "explains the %s empty state (search: %s)",
    (status, searching, message) => {
      expect(
        renderToStaticMarkup(
          createElement(CancellationEmpty, { status, searching }),
        ),
      ).toContain(message);
    },
  );
});
describe("focused cancellation review", () => {
  it("shows the financial warning without claiming an active booking was cancelled", () => {
    const html = renderReview({
      bookingStatus: "active",
      reason: "Payment needs reconciliation.\nDo not issue another refund.",
    });
    expect(html).toContain("Payment needs reconciliation.");
    expect(html).toContain("Do not issue another refund.");
    expect(html).toContain("Reason for review");
    expect(html).toContain("Flagged on");
    expect(html).not.toMatch(/Cancelled booking|Cancelled on/);
  });
  it("keeps booking details and the review open with a private bounded note", () => {
    const html = renderReview();
    expect(html).toContain("Cancelled booking");
    expect(html).toContain("Review details");
    expect(html).toContain("Eastern Time (New York)");
    expect(html).toContain("Dec 15, 2029");
    expect(html).toContain("Private to your business");
    expect(html).toContain('maxLength="1000"');
    expect(html).toMatch(/<textarea[^>]*required=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Mark reviewed/);
    expect(html).not.toMatch(/<details|<summary|America\/New_York/);
  });
  it("keeps the no-money-movement notice next to the review action", () => {
    expect(renderReview()).toContain(
      "Marking reviewed does not refund payments or change charges.",
    );
    expect(renderReview()).toContain("View booking");
    expect(renderReview()).toContain("View payments");
  });
  it("shows saved review notes as read-only text, including line breaks and escaped markup", () => {
    const html = renderReview({
      resolvedAt: Date.UTC(2029, 11, 16, 18),
      resolution: "Reviewed separately.\n<script>example</script>",
    });
    expect(html).toContain("Review recorded");
    expect(html).toContain("Reviewed Dec 16, 2029");
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/<textarea|<form|Mark reviewed|<script>/);
  });
  it("uses the business time zone when no booking snapshot is available", () => {
    expect(renderReview({ timeZone: null })).toContain(
      "Eastern Time (New York)",
    );
  });
  it("disables the note and all actions during a save", () => {
    const html = renderReview({}, true);
    expect(html.match(/<button\b[^>]*disabled=""/g)).toHaveLength(3);
    expect(html).toMatch(/<textarea\b[^>]*disabled=""/);
  });
});
