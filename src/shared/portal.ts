import { z } from "zod";

export const calendarDate = z.iso
  .date()
  .refine(
    (value) => value >= "2020-01-01" && value <= "2100-12-31",
    "Choose a date from 2020 to 2100",
  );
export const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const policySchema = z
  .object({
    portalEnabled: z.boolean(),
    approvalMode: z.enum(["request", "instant"]),
    leadHours: z.number().int().min(0).max(720),
    horizonDays: z.number().int().min(1).max(365),
    cancelHours: z.number().int().min(0).max(720),
    requestHoldHours: z.number().int().min(1).max(168),
    weekly: z
      .array(
        z
          .object({
            day: z.number().int().min(0).max(6),
            start: clockTime,
            end: clockTime,
          })
          .strict()
          .refine(
            (slot) => slot.start < slot.end,
            "Closing time must follow opening time",
          ),
      )
      .max(7),
    blockedDates: z.array(calendarDate).max(366),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.weekly.map((slot) => slot.day)).size ===
      value.weekly.length,
    "Use one opening window per day",
  );
export type BookingPolicy = z.infer<typeof policySchema>;
export const bookingRequestSchema = z
  .object({
    requestId: z.uuid(),
    clientId: z.string().min(1).max(100).optional(),
    serviceId: z.string().min(1).max(100),
    petIds: z
      .array(z.string().min(1).max(100))
      .min(1)
      .max(20)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Select each pet once",
      ),
    startDate: calendarDate,
    startTime: clockTime.optional(),
    endDate: calendarDate.optional(),
    overrides: z
      .object({
        outsideHours: z.boolean().optional(),
        waiveNotice: z.boolean().optional(),
      })
      .strict()
      .optional(),
    message: z.string().trim().max(2000).default(""),
  })
  .strict();
export type BookingRequest = z.infer<typeof bookingRequestSchema>;
export const transitionSchema = z
  .object({
    version: z.number().int().positive(),
    action: z.enum(["approve", "decline", "cancel", "complete"]),
    reason: z.string().trim().max(1000).default(""),
  })
  .strict();
export type WorkspaceSession = {
  user: { name: string; email: string };
  role: "owner" | "client" | "pending";
  clientId?: string;
};
