import { describe, expect, it } from "vitest";
import {
  availabilityInputSchema,
  bookingInputSchema,
  clientInputSchema,
  normalizePhone,
  petInputSchema,
  serviceInputSchema,
} from "../../worker/domain";

describe("client and pet validation", () => {
  it("normalizes North American and international phone input", () => {
    expect(normalizePhone("(555) 867-5309")).toBe("5558675309");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("rejects incomplete clients and future-proof invalid pet values", () => {
    expect(
      clientInputSchema.safeParse({ firstName: "", lastName: "Rivera" })
        .success,
    ).toBe(false);
    expect(
      petInputSchema.safeParse({ name: "Mochi", species: "unicorn" }).success,
    ).toBe(false);
    expect(
      petInputSchema.safeParse({ name: "Mochi", species: "dog", weight: 27.5 })
        .success,
    ).toBe(true);
  });

  it("validates rates, booking selections, and weekly time windows", () => {
    expect(
      serviceInputSchema.safeParse({
        name: "Dog walk",
        durationMinutes: 30,
        price: 24,
        additionalPetPrice: 6,
      }).success,
    ).toBe(true);
    expect(
      serviceInputSchema.safeParse({ name: "", durationMinutes: 1, price: 0 })
        .success,
    ).toBe(false);
    expect(
      bookingInputSchema.safeParse({
        clientId: "c1",
        serviceId: "s1",
        petIds: [],
        startDate: "2026-09-10",
      }).success,
    ).toBe(false);
    expect(
      availabilityInputSchema.safeParse({
        slots: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          startTime: "17:00",
          endTime: "09:00",
          isActive: dayOfWeek === 1,
        })),
      }).success,
    ).toBe(false);
  });
});
