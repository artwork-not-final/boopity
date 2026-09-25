import type { SetupStep as Step } from "../../lib/navigation/setup-flow";

export const steps: { id: Step; label: string }[] = [
  {
    id: "identity",
    label: "Your account",
  },
  {
    id: "email",
    label: "Email delivery",
  },
  {
    id: "appearance",
    label: "Business",
  },
  {
    id: "verify",
    label: "Verify your inbox",
  },
  {
    id: "google",
    label: "Google sign-in",
  },
  {
    id: "review",
    label: "Review & finish",
  },
];
