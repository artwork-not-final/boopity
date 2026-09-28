import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color");
export const brandingSchema = z
  .object({
    businessName: z.string().trim().min(1).max(100),
    primaryColor: hex,
    accentColor: hex,
    logoUrl: z
      .string()
      .regex(/^\/api\/branding\/logo$/)
      .nullable()
      .default(null),
  })
  .strict();
export type Branding = z.infer<typeof brandingSchema>;
export const defaultBranding: Branding = {
  businessName: "Your pet-care business",
  primaryColor: "#68407a",
  accentColor: "#f5bb62",
  logoUrl: null,
};
export const themePresets = [
  { name: "Plum & honey", primaryColor: "#68407a", accentColor: "#f5bb62" },
  { name: "Forest & sage", primaryColor: "#285943", accentColor: "#c5dec8" },
  { name: "Ocean & sand", primaryColor: "#215b79", accentColor: "#eddbba" },
] as const;

// Shared neutral surfaces stay consistent across sitter-selected brand colors.
// Keep the no-JavaScript defaults in styles/theme.css in sync (covered by tests).
export const themeColors = {
  background: "#f1f3f5",
  foreground: "#242a32",
  card: "#ffffff",
  muted: "#e7ebef",
  "muted-foreground": "#535d69",
  border: "#d3d9e0",
  input: "#8793a1",
} as const;

function luminance(hex: string) {
  const rgb = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
export function contrastRatio(a: string, b: string) {
  hex.parse(a);
  hex.parse(b);
  const first = luminance(a),
    second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
export function readableForeground(color: string) {
  return contrastRatio(color, "#ffffff") >= contrastRatio(color, "#000000")
    ? "#ffffff"
    : "#000000";
}
function mix(color: string, target: string, amount: number) {
  return (
    "#" +
    [1, 3, 5]
      .map((index) => {
        const from = parseInt(color.slice(index, index + 2), 16);
        const to = parseInt(target.slice(index, index + 2), 16);
        return Math.round(from + (to - from) * amount)
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}
function readableBrandInk(color: string, surfaces: string[]) {
  // Preserve the chosen hue, darkening pale colors only as much as needed.
  for (let step = 0; step <= 20; step++) {
    const ink = mix(color, "#000000", step / 20);
    if (surfaces.every((surface) => contrastRatio(ink, surface) >= 4.5))
      return ink;
  }
  return themeColors.foreground;
}
export function brandingVariables(input: Branding): Record<string, string> {
  const brand = brandingSchema.parse(input);
  const tintSource = readableBrandInk(brand.primaryColor, [
    themeColors.background,
  ]);
  const soft = mix(tintSource, themeColors.card, 0.95);
  const hover = mix(tintSource, themeColors.card, 0.9);
  const selected = mix(tintSource, themeColors.card, 0.86);
  const ink = readableBrandInk(tintSource, [
    themeColors.background,
    themeColors.card,
    soft,
    hover,
    selected,
  ]);
  return {
    "--primary": brand.primaryColor,
    "--primary-foreground": readableForeground(brand.primaryColor),
    "--accent": brand.accentColor,
    "--accent-foreground": readableForeground(brand.accentColor),
    "--secondary": selected,
    "--secondary-foreground": ink,
    "--brand-soft": soft,
    "--brand-soft-hover": hover,
    "--brand-ink": ink,
    "--ring":
      contrastRatio(brand.primaryColor, themeColors.background) >= 3
        ? brand.primaryColor
        : themeColors.foreground,
  };
}
