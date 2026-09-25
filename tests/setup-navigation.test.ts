import { describe, expect, it } from "vitest";
import {
  installerAccess,
  setupStepPath,
  setupStepFromPath,
  setupHelpFromPath,
  setupHelpPath,
  restoredSetupStep,
  type SetupStep,
} from "../src/client/lib/navigation/setup-flow";
import { defaultBranding } from "../src/shared/branding";
describe("setup page URLs", () => {
  it.each<[SetupStep, string]>([
    ["identity", "account"],
    ["email", "email"],
    ["appearance", "business"],
    ["verify", "verify"],
    ["google", "google"],
    ["review", "review"],
  ])("round-trips the %s step and recovery equivalent", (step, slug) => {
    expect(setupStepPath(step)).toBe(`/setup/${slug}`);
    expect(setupStepFromPath(`/setup/${slug}`)).toBe(step);
    expect(setupStepFromPath(`/setup/${slug}/`)).toBe(step);
    expect(setupStepPath(step, true)).toBe(`/setup/recovery/${slug}`);
    expect(setupStepFromPath(`/setup/recovery/${slug}`)).toBe(step);
    expect(installerAccess(`/setup/recovery/${slug}`)).toBe("recovery");
  });
  it.each([
    "/setup",
    "/setup/code",
    "/setup/recovery",
    "/setup/unknown",
    "/setup/email/extra",
  ])("does not interpret %s as a wizard step", (path) => {
    expect(setupStepFromPath(path)).toBeNull();
  });
  it("selects installer forms by path only", () => {
    expect(installerAccess("/setup/code")).toBe("setup-code");
    expect(installerAccess("/setup/code/")).toBe("setup-code");
    expect(installerAccess("/setup/recovery")).toBe("recovery");
    for (const search of ["?installer=setup-code", "?installer=recovery"]) {
      const url = new URL(`/setup${search}`, "https://sitter.test");
      expect(installerAccess(url.pathname)).toBeNull();
    }
  });
  it.each(["none", "forgot", "hosting"] as const)(
    "round-trips %s setup help",
    (help) => {
      expect(setupHelpFromPath(setupHelpPath(help))).toBe(help);
    },
  );
  it("starts fresh installations at the account step when only stale browser memory exists", () => {
    expect(
      restoredSetupStep(
        {
          pending: { email: null },
          owner: null,
          readiness: { email: false },
          branding: defaultBranding,
        },
        setupStepFromPath("/setup/review"),
      ),
    ).toBe("identity");
  });
});
