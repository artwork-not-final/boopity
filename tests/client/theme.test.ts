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
    for (const [name, color] of Object.entries(
      brandingVariables(defaultBranding),
    ))
      expect(css).toContain(`${name}: ${color};`);
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

  it("uses each preset's accent for selection and hover, without a fixed lavender tint", () => {
    const palettes = themePresets.map(({ primaryColor, accentColor }) =>
      brandingVariables({ ...defaultBranding, primaryColor, accentColor }),
    );
    expect(
      new Set(palettes.map((palette) => palette["--secondary"])).size,
    ).toBe(themePresets.length);
    expect(css).not.toContain("#f0edf1");
  });

  it.each(themePresets)(
    "uses both colors from $name outside the preview",
    ({ primaryColor, accentColor }) => {
      const vars = brandingVariables({
        ...defaultBranding,
        primaryColor,
        accentColor,
      });
      expect(vars["--primary"]).toBe(primaryColor);
      expect(vars["--accent"]).toBe(accentColor);
      expect(vars["--brand-ink"]).toBe(primaryColor);
      const alternate = brandingVariables({
        ...defaultBranding,
        primaryColor,
        accentColor: "#c0dcf5",
      });
      for (const key of ["--secondary", "--brand-soft", "--brand-soft-hover"])
        expect(vars[key]).not.toBe(alternate[key]);
      expect(vars["--primary"]).toBe(alternate["--primary"]);
      expect(
        contrastRatio(accentColor, vars["--accent-foreground"]),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each([
    "#ffffff",
    "#fffffe",
    "#ffff00",
    "#000000",
    "#0000ff",
    "#ff0000",
    "#00ff00",
    "#777777",
    ...themePresets.map((theme) => theme.accentColor),
  ])("keeps custom %s accent surfaces readable and distinct", (accentColor) => {
    for (const primaryColor of [
      "#ffffff",
      "#ffff00",
      "#000000",
      ...themePresets.map((theme) => theme.primaryColor),
    ]) {
      const vars = brandingVariables({
        ...defaultBranding,
        primaryColor,
        accentColor,
      });
      expect(vars["--accent"]).toBe(accentColor);
      expect(
        contrastRatio(vars["--secondary"], themeColors.card),
      ).toBeGreaterThan(1.1);
      expect(
        contrastRatio(vars["--secondary"], themeColors.card),
      ).toBeGreaterThan(
        contrastRatio(vars["--brand-soft-hover"], themeColors.card),
      );
      expect(
        contrastRatio(vars["--brand-soft-hover"], themeColors.card),
      ).toBeGreaterThan(contrastRatio(vars["--brand-soft"], themeColors.card));
      for (const surface of [
        vars["--secondary"],
        vars["--brand-soft"],
        vars["--brand-soft-hover"],
      ]) {
        expect(
          contrastRatio(themeColors["muted-foreground"], surface),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(themeColors.foreground, surface),
        ).toBeGreaterThanOrEqual(7);
        expect(
          contrastRatio(vars["--brand-ink"], surface),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps Ocean & sand visibly warm on secondary surfaces, with blue primary ink", () => {
    const vars = brandingVariables({
      ...defaultBranding,
      primaryColor: "#215b79",
      accentColor: "#eddbba",
    });
    expect(vars["--brand-soft-hover"]).toBe("#f7f0e2");
    expect(vars["--secondary"]).toBe("#f3e8d2");
    expect(vars["--brand-ink"]).toBe("#215b79");
    expect(vars).not.toHaveProperty("--tab-hover");
    expect(vars).not.toHaveProperty("--tab-hover-foreground");
    expect(css).not.toContain("--tab-hover");
  });
});
