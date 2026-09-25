import { describe, expect, it } from "vitest";
import { sanitizeFileName } from "../../worker/uploads";

describe("sanitizeFileName", () => {
  it("removes path traversal and unsafe characters", () => {
    expect(sanitizeFileName("../../client contract (signed).pdf")).toBe(
      "client-contract-signed-.pdf",
    );
  });

  it("decodes browser-encoded names", () => {
    expect(sanitizeFileName("vaccination%20record.png")).toBe(
      "vaccination-record.png",
    );
  });
});
