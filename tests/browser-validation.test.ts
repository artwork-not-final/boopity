import { afterEach, expect, it, vi } from "vitest";

// Exercise the real entry's import order without mounting the application or
// making requests. Configuring Zod in an effect would be too late.
vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => ({ render: vi.fn() })),
}));

afterEach(() => vi.unstubAllGlobals());

it("loads the browser entry and validates data without attempting dynamic code generation", async () => {
  const blocked = vi.fn(() => {
    throw new EvalError(
      "Code generation is forbidden by Content Security Policy",
    );
  });
  vi.stubGlobal(
    "Function",
    new Proxy(Function, { apply: blocked, construct: blocked }),
  );
  vi.stubGlobal("document", { getElementById: () => ({}) });

  await import("../src/client/main");
  const { z } = await import("zod");
  const { ownerSchema } = await import("../src/shared/setup");
  const { sessionResponse } = await import("../src/shared/api-responses");
  expect(z.config().jitless).toBe(true);
  expect(
    ownerSchema.parse({ name: " Jamie ", email: "OWNER@example.test" }),
  ).toEqual({ name: "Jamie", email: "owner@example.test" });
  expect(ownerSchema.safeParse({ name: "", email: "invalid" }).success).toBe(
    false,
  );
  expect(
    sessionResponse.safeParse({
      user: { name: "Jamie", email: "owner@example.test" },
      role: "owner",
    }).success,
  ).toBe(true);
  expect(sessionResponse.safeParse({ user: {}, role: "admin" }).success).toBe(
    false,
  );
  expect(blocked).not.toHaveBeenCalled();
});
