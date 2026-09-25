import { z } from "zod";
import { brandingSchema } from "./branding";
import { providerSchema } from "./setup";
import {
  paymentMode,
  type PaymentView,
  type IntegrationView,
  type RefundPage,
} from "./payments";
import type { WorkspaceSession } from "./portal";

export const publicInfoResponse = z.object({
  branding: brandingSchema,
  version: z.number().int().positive(),
  setupRequired: z.boolean(),
  ownerClaimed: z.boolean(),
  login: z.object({ email: z.boolean(), google: z.boolean() }),
});
export type PublicInfo = z.infer<typeof publicInfoResponse>;

export const setupEntryResponse = z.object({
  started: z.boolean(),
  mode: z.enum([
    "email",
    "waiting",
    "token",
    "owner",
    "resume",
    "paused",
    "password",
    "password-email",
  ]),
});
export const invitationResponse = z.object({
  invitation: z.object({ email: z.string() }).nullable(),
});

export const sessionResponse: z.ZodType<WorkspaceSession> = z.object({
  user: z.object({ name: z.string(), email: z.string() }),
  role: z.enum(["owner", "client", "pending"]),
  clientId: z.string().optional(),
});

export const setupStateResponse = z.object({
  actor: z.enum(["owner", "setup", "recovery"]),
  canClaimOwner: z.boolean().optional(),
  setupPasswordSet: z.boolean().optional(),
  owner: z
    .object({ email: z.string(), name: z.string(), verified: z.boolean() })
    .nullable(),
  pending: z.object({
    email: z.string().nullable(),
    name: z.string().nullable(),
    mailVerifiedAt: z.number().nullable(),
  }),
  state: z.string(),
  branding: brandingSchema,
  version: z.number().int().positive(),
  timeZone: z.string(),
  currency: z.string(),
  providers: z.object({
    version: z.number().int().nonnegative(),
    managed: z.object({ email: z.boolean(), google: z.boolean() }),
    email: providerSchema.shape.email.extend({
      hasPassword: z.boolean(),
      hasApiKey: z.boolean(),
    }),
    google: providerSchema.shape.google.extend({ hasSecret: z.boolean() }),
  }),
  readiness: z.object({
    database: z.boolean(),
    privateStorage: z.boolean(),
    email: z.boolean(),
    google: z.boolean(),
    https: z.boolean(),
    origin: z.string(),
    googleCallback: z.string(),
  }),
});
export type SetupState = z.infer<typeof setupStateResponse>;

const pagination = z.object({
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
});
const refund = z.object({
  id: z.string(),
  amountCents: z.number().int(),
  status: z.string(),
  note: z.string().optional(),
});
export const refundPageResponse: z.ZodType<RefundPage> = z.object({
  refunds: z.array(refund),
  pagination,
});
export const paymentViewResponse: z.ZodType<PaymentView> = z
  .object({
    bookingId: z.string(),
    bookingStatus: z.string(),
    activeMode: paymentMode,
    balances: z.array(
      z.object({
        mode: paymentMode,
        currency: z.string().regex(/^[A-Z]{3}$/),
        chargeCents: z.number().int(),
        creditCents: z.number().int(),
        receivedCents: z.number().int(),
        refundedCents: z.number().int(),
        netCents: z.number().int(),
        outstandingCents: z.number().int(),
        overpaymentCents: z.number().int(),
        status: z.enum([
          "unpaid",
          "partial",
          "paid",
          "refunded",
          "overpaid",
          "waived",
        ]),
      }),
    ),
    onlineAvailable: z.boolean(),
    pagination: z.object({ attempts: pagination, history: pagination }),
    attempts: z.array(
      z.object({
        id: z.string(),
        provider: z.string(),
        mode: paymentMode,
        amountCents: z.number().int(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        status: z.string(),
        method: z.string(),
        createdAt: z.number(),
        note: z.string().optional(),
        refunds: z.array(refund),
        refundCount: z.number().int().nonnegative(),
        refundPagination: pagination,
      }),
    ),
    history: z.array(
      z.object({
        id: z.string(),
        reversible: z.boolean(),
        kind: z.string(),
        cents: z.number().int(),
        mode: paymentMode,
        createdAt: z.number(),
        note: z.string().optional(),
      }),
    ),
  })
  .refine((view) =>
    view.balances.some((balance) => balance.mode === view.activeMode),
  );

const integrationResponse: z.ZodType<IntegrationView> = z.object({
  id: z.string(),
  provider: z.string(),
  mode: paymentMode,
  version: z.number().int().nonnegative(),
  enabled: z.boolean(),
  managed: z.boolean(),
  keyPresent: z.boolean(),
  webhookSecretPresent: z.boolean(),
  verified: z.boolean(),
  webhookVerified: z.boolean(),
  accountId: z.string().nullable(),
  webhookUrl: z.string(),
  apiVersion: z.string(),
  capabilities: z.object({
    checkout: z.boolean(),
    refunds: z.boolean(),
    expire: z.boolean(),
  }),
});
export const paymentSettingsResponse = z.object({
  integrations: z.array(integrationResponse),
  settings: z.object({
    mode: paymentMode,
    version: z.number().int().positive(),
  }),
});
export type PaymentSettingsData = z.infer<typeof paymentSettingsResponse>;
