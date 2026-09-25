import { z } from "zod";
import { brandingSchema } from "./branding";

export const setupPasswordSchema = z
  .string()
  .min(15)
  .max(128)
  .refine((value) => value.trim().length > 0);

export const ownerSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
  })
  .strict();
export const appearanceSchema = brandingSchema.omit({ logoUrl: true }).extend({
  version: z.number().int().positive(),
  timeZone: z
    .string()
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid timezone"),
  currency: z.enum(["USD", "CAD", "GBP", "EUR", "AUD", "NZD"]),
});
export const providerSchema = z
  .object({
    email: z
      .object({
        provider: z.enum(["none", "smtp", "resend"]),
        from: z.string().trim().max(254),
        host: z.string().trim().max(253),
        port: z.number().int().min(1).max(65535),
        secure: z.boolean(),
        username: z.string().max(254),
        password: z.string().max(4096),
        apiKey: z.string().max(4096),
      })
      .strict(),
    google: z
      .object({
        enabled: z.boolean(),
        clientId: z.string().trim().max(512),
        clientSecret: z.string().max(4096),
      })
      .strict(),
  })
  .strict();
export type ProviderConfig = z.infer<typeof providerSchema>;
export const emptyProviders: ProviderConfig = {
  email: {
    provider: "none",
    from: "",
    host: "",
    port: 587,
    secure: false,
    username: "",
    password: "",
    apiKey: "",
  },
  google: { enabled: false, clientId: "", clientSecret: "" },
};
