export type Pet = {
  id: string;
  name: string;
  species: string;
  breed?: string | null;
  isActive: boolean | number;
  clientId?: string;
  medicalConditions?: string | null;
  feedingInstructions?: string | null;
};
export type Client = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  status: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};
export type ClientSummary = Pick<
  Client,
  "id" | "firstName" | "lastName" | "email" | "status"
> & {
  petCount: number;
  members: number;
  invitationExpiresAt: number | null;
};

export type ClientDraft = Omit<Client, "id">;
export type ClientInvitation = { clientId: string; url: string };

// Optional/nullable details stay attached to the draft, including fields the
// care editor does not expose, so saving does not reset veterinary information.
export type PetDetails = Pet & {
  clientName?: string;
  clientFirstName?: string;
  clientLastName?: string;
  color?: string | null;
  dateOfBirth?: string | null;
  weight?: number | null;
  spayedNeutered?: boolean;
  microchipped?: boolean;
  microchipId?: string | null;
  vaccinationsCurrent?: boolean;
  medications?: string | null;
  allergies?: string | null;
  behaviorNotes?: string | null;
  specialInstructions?: string | null;
  vetName?: string | null;
  vetPhone?: string | null;
  vetClinic?: string | null;
  photoUrl?: string | null;
  sitterNotes?: string;
  createdAt?: number;
  updatedAt?: number;
};
export type PetCareField =
  | "medicalConditions"
  | "medications"
  | "allergies"
  | "feedingInstructions"
  | "specialInstructions"
  | "sitterNotes";
