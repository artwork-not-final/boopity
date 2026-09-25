export type FirstBookingProgress = {
  service: boolean;
  client: boolean;
  pet: boolean;
  booking: boolean;
  /** Direct pet entry is safe when there is exactly one active client. */
  clientId: string | null;
};

export type FirstBookingStep = "service" | "client" | "pet" | "booking";
