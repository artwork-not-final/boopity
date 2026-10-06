import { z } from "zod";

export const changeEmailRequest = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  })
  .strict();
export const changeEmailConfirmation = z
  .object({
    id: z.uuid(),
    currentCode: z.string().regex(/^\d{6}$/),
    newCode: z.string().regex(/^\d{6}$/),
  })
  .strict();
export type PendingEmailChange = {
  id: string;
  newEmail: string;
  expiresAt: number;
};
