import type { Pet } from "./clients/types";
export type Booking = {
  id: string;
  clientId: string;
  clientName?: string;
  serviceName: string;
  status: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  startAt: number;
  endAt: number;
  totalAmountCents: number;
  requestExpiresAt: number | null;
  version: number;
  canCancel: boolean;
  clientRequest: string;
  clientUpdate: string;
  privateNotes?: string;
  postServiceNotes?: string;
  pets: Pet[];
  policy: {
    cancelHours: number;
    timeZone: string;
    approvalMode: string;
  } | null;
  price: {
    currency: string;
    baseCents: number;
    additionalPetCents: number;
    petCount: number;
    days: number;
    pricingRule: string;
  } | null;
};
