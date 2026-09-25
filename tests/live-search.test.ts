import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveSearch, showSearchInput } from "../src/client/live-search";
import { SearchBox } from "../src/client/Pagination";
import { bookingSearchTarget } from "../src/client/booking-search";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("live search timing", () => {
  it("waits for a 300 ms pause and submits only the latest text", () => {
    const send = vi.fn();
    const search = createLiveSearch(send);
    search.change("C");
    vi.advanceTimersByTime(200);
    search.change("Clover");
    vi.advanceTimersByTime(299);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send.mock.calls).toEqual([["Clover"]]);
  });
  it("Enter submits immediately without a duplicate delayed search", () => {
    const send = vi.fn();
    const search = createLiveSearch(send);
    search.change("Clover");
    search.flush("Clover");
    expect(send.mock.calls).toEqual([["Clover"]]);
    vi.runAllTimers();
    expect(send).toHaveBeenCalledOnce();
  });
  it("clearing restores the unsearched list immediately and cancels pending text", () => {
    const send = vi.fn();
    const search = createLiveSearch(send, "Clover");
    search.change("Nori");
    search.change("");
    expect(send.mock.calls).toEqual([[""]]);
    vi.runAllTimers();
    expect(send).toHaveBeenCalledOnce();
  });
  it("typing and clearing before the delay does not issue a needless request", () => {
    const send = vi.fn();
    const search = createLiveSearch(send);
    search.change("C");
    search.change("");
    vi.runAllTimers();
    expect(send).not.toHaveBeenCalled();
  });
  it("trims text and avoids duplicate searches from whitespace or Enter", () => {
    const send = vi.fn();
    const search = createLiveSearch(send);
    search.change(" Clover ");
    vi.runAllTimers();
    search.change("Clover  ");
    search.flush("Clover");
    vi.runAllTimers();
    expect(send.mock.calls).toEqual([["Clover"]]);
  });
  it("does not submit the initial saved query just by mounting", () => {
    const send = vi.fn();
    createLiveSearch(send, "Clover");
    vi.runAllTimers();
    expect(send).not.toHaveBeenCalled();
  });
  it("returning to the current query cancels an obsolete pending search", () => {
    const send = vi.fn();
    const search = createLiveSearch(send, "Clover");
    search.change("Nori");
    search.change("Clover");
    vi.runAllTimers();
    expect(send).not.toHaveBeenCalled();
  });
  it("cancels delayed work when the field unmounts", () => {
    const send = vi.fn();
    const search = createLiveSearch(send);
    search.change("Clover");
    search.cancel();
    vi.runAllTimers();
    expect(send).not.toHaveBeenCalled();
  });
  it("remains usable after an effect cleanup/setup cycle", () => {
    const send = vi.fn();
    const search = createLiveSearch(send);
    search.cancel();
    search.change("Clover");
    vi.runAllTimers();
    expect(send.mock.calls).toEqual([["Clover"]]);
  });
  it("waits until an input-method composition finishes", () => {
    const send = vi.fn();
    const search = createLiveSearch(send);
    search.change("n");
    search.startComposition();
    search.change("ね");
    search.flush("ね");
    vi.runAllTimers();
    expect(send).not.toHaveBeenCalled();
    search.endComposition("ねこ");
    search.change("ねこ");
    vi.advanceTimersByTime(300);
    expect(send.mock.calls).toEqual([["ねこ"]]);
  });
  it("uses the current consumer callback when the timer fires", () => {
    const previous = vi.fn(),
      latest = vi.fn();
    let callback = previous;
    const search = createLiveSearch((text) => callback(text));
    search.change("Clover");
    callback = latest;
    vi.runAllTimers();
    expect(previous).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith("Clover");
  });
  it("live booking searches still open List across dates", () => {
    let target = {
      view: "week" as "week" | "month" | "list",
      from: "2026-09-06",
      to: "2026-09-12",
      search: "",
    };
    const search = createLiveSearch((text) => {
      target = bookingSearchTarget(text, target);
    });
    search.change("Clover");
    vi.runAllTimers();
    expect(target).toEqual({
      view: "list",
      from: "",
      to: "",
      search: "Clover",
    });
    search.change("");
    expect(target).toEqual({ view: "list", from: "", to: "", search: "" });
  });
});

describe("live search presentation", () => {
  it("uses a consistent surface and control height inside and outside cards", () => {
    const html = renderToStaticMarkup(
      createElement(SearchBox, {
        label: "Search by name, email, or phone",
        onSearch: vi.fn(),
      }),
    );
    const classes = html.match(/<input\b[^>]*class="([^"]*)"/)![1].split(" ");
    expect(classes).toContain("bg-card");
    expect(classes).toContain("min-h-11");
    expect(classes).toContain("rounded-md");
    expect(classes).toContain("border-input");
    expect(classes).not.toContain("bg-transparent");
  });
  it("keeps the labelled input and mobile Search key, without a Search button", () => {
    const html = renderToStaticMarkup(
      createElement(SearchBox, {
        label: "Find a client",
        initialValue: "Clover",
        onSearch: vi.fn(),
      }),
    );
    expect(html).toContain("Find a client");
    expect(html).toContain('type="search"');
    expect(html).toContain('enterKeyHint="search"');
    expect(html).toContain('value="Clover"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
  });
  it("keeps a focused search visible while the result list shrinks or reloads", () => {
    expect(showSearchInput(false, true, "")).toBe(true);
    expect(showSearchInput(false, false, "Clover")).toBe(true);
    expect(showSearchInput(true, false, "")).toBe(true);
    expect(showSearchInput(false, false, "")).toBe(false);
  });
  it("does not add an empty control to a small list", () => {
    expect(
      renderToStaticMarkup(
        createElement(SearchBox, {
          label: "Find a pet",
          showWhen: false,
          onSearch: vi.fn(),
        }),
      ),
    ).toBe("");
  });
});
