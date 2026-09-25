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
export function brandingVariables(input: Branding): Record<string, string> {
  const brand = brandingSchema.parse(input);
  return {
    "--primary": brand.primaryColor,
    "--primary-foreground": readableForeground(brand.primaryColor),
    "--accent": brand.accentColor,
    "--accent-foreground": readableForeground(brand.accentColor),
    "--ring":
      contrastRatio(brand.primaryColor, "#faf8f5") >= 3
        ? brand.primaryColor
        : "#272329",
  };
}
