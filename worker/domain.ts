import { z } from "zod";

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => trimmed(max).optional().default("");
const optionalNullableText = (max: number) =>
  z
    .union([trimmed(max), z.null()])
    .optional()
    .default(null);

export const clientInputSchema = z.object({
  firstName: trimmed(100).min(1, "First name is required"),
  lastName: trimmed(100).min(1, "Last name is required"),
  email: z
    .union([z.email("Enter a valid email address"), z.literal("")])
    .optional()
    .default(""),
  phone: optionalText(40),
  address: optionalText(500),
  emergencyContactName: optionalText(200),
  emergencyContactPhone: optionalText(40),
  notes: optionalText(500),
  status: z.enum(["lead", "active"]).optional().default("active"),
});

export const petInputSchema = z.object({
  name: trimmed(100).min(1, "Pet name is required"),
  species: z.enum(["dog", "cat", "bird", "rabbit", "reptile", "fish", "other"]),
  breed: optionalNullableText(100),
  color: optionalNullableText(100),
  dateOfBirth: z
    .union([z.iso.date(), z.literal(""), z.null()])
    .optional()
    .default(null)
    .transform((value) => value || null),
  weight: z.number().positive().max(500).nullable().optional().default(null),
  spayedNeutered: z.boolean().optional().default(false),
  microchipped: z.boolean().optional().default(false),
  microchipId: optionalNullableText(100),
  vaccinationsCurrent: z.boolean().optional().default(false),
  medicalConditions: optionalNullableText(2000),
  medications: optionalNullableText(1000),
  allergies: optionalNullableText(1000),
  behaviorNotes: optionalNullableText(2000),
  feedingInstructions: optionalNullableText(2000),
  specialInstructions: optionalNullableText(2000),
  vetName: optionalNullableText(200),
  vetPhone: optionalNullableText(40),
  vetClinic: optionalNullableText(500),
});

export const petNoteSchema = z.object({
  notes: trimmed(4000),
});

const dateText = z.iso.date();
const timeText = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time");

export const serviceInputSchema = z.object({
  name: trimmed(200).min(1, "Template name is required"),
  description: optionalText(1000),
  durationMinutes: z
    .number()
    .int()
    .min(5)
    .max(720)
    .nullable()
    .optional()
    .default(null),
  price: z.number().positive().max(999999),
  additionalPetPrice: z.number().min(0).max(999999).optional().default(0),
});

export const availabilityInputSchema = z
  .object({
    slots: z
      .array(
        z.object({
          dayOfWeek: z.number().int().min(0).max(6),
          startTime: timeText,
          endTime: timeText,
          isActive: z.boolean(),
        }),
      )
      .length(7),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.slots.map((slot) => slot.dayOfWeek)).size !== 7) {
      ctx.addIssue({
        code: "custom",
        message: "Include each day of the week once",
      });
    }
    for (const slot of value.slots) {
      if (slot.isActive && slot.startTime >= slot.endTime) {
        ctx.addIssue({
          code: "custom",
          message: "Schedule end times must be after start times",
        });
        break;
      }
    }
  });

export const blockedDateInputSchema = z.object({
  date: dateText,
  reason: optionalNullableText(200),
});

const recurrenceSchema = z
  .object({
    frequency: z.enum(["weekly", "biweekly", "monthly"]),
    endType: z.enum(["afterOccurrences", "onDate"]),
    additionalOccurrences: z.number().int().min(1).max(52).optional(),
    endDate: dateText.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.endType === "afterOccurrences" &&
      value.additionalOccurrences === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Choose how many additional bookings to create",
      });
    }
    if (value.endType === "onDate" && !value.endDate) {
      ctx.addIssue({
        code: "custom",
        message: "Choose an end date for the series",
      });
    }
  });

export const bookingInputSchema = z.object({
  clientId: z.string().min(1),
  serviceId: z.string().min(1),
  petIds: z.array(z.string().min(1)).min(1, "Select at least one pet").max(20),
  startDate: dateText,
  endDate: dateText.optional(),
  startTime: timeText.optional(),
  notes: optionalText(2000),
  recurrence: recurrenceSchema.nullable().optional().default(null),
});

export const postServiceNoteSchema = z.object({
  notes: trimmed(2000),
});

export const paymentMethods = [
  "cash",
  "check",
  "venmo",
  "zelle",
  "paypal",
  "cashApp",
  "applePay",
  "googlePay",
  "bankTransfer",
  "other",
] as const;
export const paymentInputSchema = z.object({
  amountCents: z.number().int().positive().max(99_999_999),
  method: z.enum(paymentMethods),
  description: optionalText(500),
  notes: optionalText(500),
  paidAt: z
    .number()
    .int()
    .min(0)
    .max(8_640_000_000_000_000)
    .nullable()
    .optional()
    .default(null),
});
export const recordPaymentSchema = paymentInputSchema.extend({
  bookingId: z.string().min(1),
  requestId: z.uuid(),
});
export const editPaymentSchema = paymentInputSchema.extend({
  status: z.enum(["paid", "pending", "failed", "refunded"]),
  version: z.number().int().positive(),
});

export type ClientInput = z.infer<typeof clientInputSchema>;
export type PetInput = z.infer<typeof petInputSchema>;
export type ServiceInput = z.infer<typeof serviceInputSchema>;
export type BookingInput = z.infer<typeof bookingInputSchema>;

export function normalizePhone(value: string | null | undefined): string {
  const trimmedValue = value?.trim() ?? "";
  const digits = trimmedValue.replace(/\D/g, "");
  if (!digits) return "";
  return trimmedValue.startsWith("+") ? `+${digits}` : digits;
}

export function validationMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the submitted fields";
}
