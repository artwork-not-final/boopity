import { describe, expect, it } from "vitest";
import { compactPage } from "../src/client/compact-page";

describe("compact presentation pagination", () => {
  it("keeps loading undefined", () =>
    expect(compactPage(undefined, 0)).toBeUndefined());
  it("advances by visible rows, including a final server batch", () => {
    expect(compactPage({ offset: 0, limit: 50, hasMore: false }, 25)).toEqual({
      offset: 0,
      limit: 10,
      hasMore: true,
    });
    expect(compactPage({ offset: 20, limit: 50, hasMore: false }, 5)).toEqual({
      offset: 20,
      limit: 10,
      hasMore: false,
    });
  });
  it("does not show a next page for exactly ten remaining rows or an empty search", () => {
    for (const count of [0, 10])
      expect(
        compactPage({ offset: 0, limit: 50, hasMore: false }, count)?.hasMore,
      ).toBe(false);
  });
  it("preserves the server's next-page signal", () => {
    expect(compactPage({ offset: 10, limit: 50, hasMore: true }, 50)).toEqual({
      offset: 10,
      limit: 10,
      hasMore: true,
    });
  });
});
