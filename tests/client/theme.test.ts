import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  brandingVariables,
  contrastRatio,
  defaultBranding,
  themeColors,
  themePresets,
} from "../../src/shared/branding";

const css = readFileSync(
  new URL("../../src/client/styles/theme.css", import.meta.url),
  "utf8",
);

describe("shared theme contrast", () => {
  it("keeps CSS defaults and contrast calculations aligned, with white fields and distinct neutral surfaces", () => {
    for (const [name, color] of Object.entries(themeColors))
      expect(css).toContain(`--${name}: ${color};`);
    expect(themeColors.card).toBe("#ffffff");
    expect(
      contrastRatio(themeColors.background, themeColors.card),
    ).toBeGreaterThan(1.1);
    expect(
      contrastRatio(themeColors.input, themeColors.card),
    ).toBeGreaterThanOrEqual(3);
    for (const surface of [
      themeColors.background,
      themeColors.card,
      themeColors.muted,
    ]) {
      expect(
        contrastRatio(themeColors["muted-foreground"], surface),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(themeColors.foreground, surface),
      ).toBeGreaterThanOrEqual(7);
    }
  });

  it.each([
    ...themePresets.map((theme) => theme.primaryColor),
    "#ffffff",
    "#ffff00",
    "#00ffff",
    "#00ff00",
    "#ff00ff",
    "#ff0000",
    "#0000ff",
    "#000000",
    "#fef3c7",
    "#c5dec8",
    "#777777",
  ])(
    "keeps selected navigation and booking accents readable with %s branding",
    (primaryColor) => {
      const vars = brandingVariables({ ...defaultBranding, primaryColor });
      expect(vars["--primary"]).toBe(primaryColor);
      expect(vars["--accent"]).toBe(defaultBranding.accentColor);
      expect(vars["--secondary"]).not.toBe(themeColors.card);
      expect(
        contrastRatio(vars["--secondary"], themeColors.card),
      ).toBeGreaterThan(
        contrastRatio(vars["--brand-soft-hover"], themeColors.card),
      );
      expect(
        contrastRatio(vars["--brand-soft-hover"], themeColors.card),
      ).toBeGreaterThan(contrastRatio(vars["--brand-soft"], themeColors.card));
      for (const surface of [
        themeColors.card,
        themeColors.background,
        vars["--brand-soft"],
        vars["--brand-soft-hover"],
        vars["--secondary"],
      ]) {
        expect(
          contrastRatio(vars["--brand-ink"], surface),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(themeColors["muted-foreground"], surface),
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(vars["--secondary-foreground"]).toBe(vars["--brand-ink"]);
      expect(
        contrastRatio(primaryColor, vars["--primary-foreground"]),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("uses each sitter's own color for selection and hover, without a fixed lavender tint", () => {
    const palettes = themePresets.map(({ primaryColor, accentColor }) =>
      brandingVariables({ ...defaultBranding, primaryColor, accentColor }),
    );
    expect(
      new Set(palettes.map((palette) => palette["--secondary"])).size,
    ).toBe(themePresets.length);
    expect(css).not.toContain("#f0edf1");
  });

  it("keeps list and menu colors while removing obsolete filled-tab colors", () => {
    const vars = brandingVariables({
      ...defaultBranding,
      primaryColor: "#285943",
    });
    expect(vars["--brand-soft-hover"]).toBe("#eaeeec");
    expect(vars["--secondary"]).toBe("#e1e8e5");
    expect(vars["--brand-ink"]).toBe("#285943");
    expect(vars).not.toHaveProperty("--tab-hover");
    expect(vars).not.toHaveProperty("--tab-hover-foreground");
    expect(css).not.toContain("--tab-hover");
  });
});
