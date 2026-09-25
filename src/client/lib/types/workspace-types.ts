// The workspace shell owns busy state, error reporting, and refresh after a mutation.
export type RunWorkspaceAction = (
  work: () => Promise<unknown>,
  message?: string,
) => Promise<void>;

import type { BookingPolicy } from "../../../shared/portal";
import type { FirstBookingStep } from "../../../shared/first-booking";
export type Policy = BookingPolicy & { version: number };
export type Data = {
  policy: Policy;
  regional: { timeZone: string; currency: string };
  revision: number;
};
export type FormProps = { data: Data; busy: boolean; run: RunWorkspaceAction };
export type FirstBookingTarget = {
  step: Exclude<FirstBookingStep, "booking">;
  clientId: string | null;
};
