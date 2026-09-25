import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("session_token_unique").on(table.token),
    index("idx_session_user_id").on(table.userId),
    index("idx_session_expires").on(table.expiresAt),
  ],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("account_issuer_account_id_unique").on(
      table.issuer,
      table.accountId,
    ),
    index("idx_account_user_id").on(table.userId),
  ],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("idx_verification_identifier").on(table.identifier),
    index("idx_verification_expires").on(table.expiresAt),
  ],
);

export const rateLimit = sqliteTable(
  "rate_limit",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),
    count: integer("count").notNull(),
    lastRequest: integer("last_request").notNull(),
  },
  (table) => [index("idx_rate_limit_last_request").on(table.lastRequest)],
);

export const sitterProfiles = sqliteTable(
  "sitter_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    businessName: text("business_name").notNull(),
    timeZone: text("time_zone").notNull().default("America/New_York"),
    subscriptionTier: text("subscription_tier", { enum: ["free", "pro"] })
      .notNull()
      .default("free"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("sitter_profiles_user_id_unique").on(table.userId)],
);

export const clients = sqliteTable(
  "clients",
  {
    id: text("id").primaryKey(),
    sitterId: text("sitter_id")
      .notNull()
      .references(() => sitterProfiles.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    address: text("address").notNull().default(""),
    emergencyContactName: text("emergency_contact_name").notNull().default(""),
    emergencyContactPhone: text("emergency_contact_phone")
      .notNull()
      .default(""),
    notes: text("notes").notNull().default(""),
    status: text("status", { enum: ["lead", "active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_clients_sitter_created_at").on(table.sitterId, table.createdAt),
    index("idx_clients_sitter_status").on(table.sitterId, table.status),
  ],
);

export const pets = sqliteTable(
  "pets",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    species: text("species", {
      enum: ["dog", "cat", "bird", "rabbit", "reptile", "fish", "other"],
    })
      .notNull()
      .default("dog"),
    breed: text("breed"),
    color: text("color"),
    dateOfBirth: text("date_of_birth"),
    weight: real("weight"),
    spayedNeutered: integer("spayed_neutered", { mode: "boolean" })
      .notNull()
      .default(false),
    microchipped: integer("microchipped", { mode: "boolean" })
      .notNull()
      .default(false),
    microchipId: text("microchip_id"),
    photoObjectKey: text("photo_object_key"),
    vaccinationsCurrent: integer("vaccinations_current", { mode: "boolean" })
      .notNull()
      .default(false),
    medicalConditions: text("medical_conditions"),
    medications: text("medications"),
    allergies: text("allergies"),
    behaviorNotes: text("behavior_notes"),
    feedingInstructions: text("feeding_instructions"),
    specialInstructions: text("special_instructions"),
    vetName: text("vet_name"),
    vetPhone: text("vet_phone"),
    vetClinic: text("vet_clinic"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_pets_client_active_name").on(
      table.clientId,
      table.isActive,
      table.name,
    ),
  ],
);

export const sitterPetNotes = sqliteTable(
  "sitter_pet_notes",
  {
    id: text("id").primaryKey(),
    sitterId: text("sitter_id")
      .notNull()
      .references(() => sitterProfiles.id, { onDelete: "cascade" }),
    petId: text("pet_id")
      .notNull()
      .references(() => pets.id, { onDelete: "cascade" }),
    notes: text("notes").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("sitter_pet_notes_sitter_pet_unique").on(
      table.sitterId,
      table.petId,
    ),
  ],
);

export const services = sqliteTable(
  "services",
  {
    id: text("id").primaryKey(),
    sitterId: text("sitter_id")
      .notNull()
      .references(() => sitterProfiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    durationMinutes: integer("duration_minutes"),
    priceCents: integer("price_cents").notNull(),
    additionalPetPriceCents: integer("additional_pet_price_cents")
      .notNull()
      .default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_services_sitter_active_name").on(
      table.sitterId,
      table.isActive,
      table.name,
    ),
  ],
);

export const availability = sqliteTable(
  "availability",
  {
    id: text("id").primaryKey(),
    sitterId: text("sitter_id")
      .notNull()
      .references(() => sitterProfiles.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(),
    startTime: text("start_time").notNull().default("09:00"),
    endTime: text("end_time").notNull().default("17:00"),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    uniqueIndex("availability_sitter_day_unique").on(
      table.sitterId,
      table.dayOfWeek,
    ),
  ],
);

export const blockedDates = sqliteTable(
  "blocked_dates",
  {
    id: text("id").primaryKey(),
    sitterId: text("sitter_id")
      .notNull()
      .references(() => sitterProfiles.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    reason: text("reason"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("blocked_dates_sitter_date_unique").on(
      table.sitterId,
      table.date,
    ),
  ],
);

export const bookings = sqliteTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    sitterId: text("sitter_id")
      .notNull()
      .references(() => sitterProfiles.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    serviceId: text("service_id").references(() => services.id, {
      onDelete: "set null",
    }),
    serviceName: text("service_name").notNull(),
    serviceDurationMinutes: integer("service_duration_minutes"),
    status: text("status", { enum: ["active", "cancelled"] })
      .notNull()
      .default("active"),
    startAt: integer("start_at").notNull(),
    endAt: integer("end_at").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    startTime: text("start_time"),
    endTime: text("end_time"),
    notes: text("notes").notNull().default(""),
    postServiceNotes: text("post_service_notes").notNull().default(""),
    totalAmountCents: integer("total_amount_cents").notNull(),
    paymentStatus: text("payment_status", {
      enum: ["pending", "paid", "failed", "refunded", "voided"],
    })
      .notNull()
      .default("pending"),
    recurrenceRule: text("recurrence_rule"),
    parentBookingId: text("parent_booking_id"),
    reminderSentAt: integer("reminder_sent_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_bookings_sitter_start_date").on(table.sitterId, table.startDate),
    index("idx_bookings_client_start_date").on(table.clientId, table.startDate),
    index("idx_bookings_parent_id").on(table.parentBookingId),
    index("idx_bookings_reminders").on(
      table.sitterId,
      table.status,
      table.startAt,
    ),
    index("idx_bookings_reminder_due").on(
      table.status,
      table.reminderSentAt,
      table.startAt,
    ),
  ],
);

export const bookingPets = sqliteTable(
  "booking_pets",
  {
    bookingId: text("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    petId: text("pet_id")
      .notNull()
      .references(() => pets.id),
  },
  (table) => [
    uniqueIndex("booking_pets_booking_pet_unique").on(
      table.bookingId,
      table.petId,
    ),
    index("idx_booking_pets_pet_id").on(table.petId),
  ],
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    sitterId: text("sitter_id")
      .notNull()
      .references(() => sitterProfiles.id),
    bookingId: text("booking_id")
      .notNull()
      .references(() => bookings.id),
    requestId: text("request_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    method: text("method").notNull(),
    status: text("status").notNull().default("paid"),
    description: text("description").notNull().default(""),
    notes: text("notes").notNull().default(""),
    paidAt: integer("paid_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("payments_sitter_request_unique").on(t.sitterId, t.requestId),
    index("idx_payments_sitter_created").on(t.sitterId, t.createdAt),
    index("idx_payments_sitter_status_paid").on(t.sitterId, t.status, t.paidAt),
    index("idx_payments_booking_status").on(t.bookingId, t.status),
  ],
);

export const billingAccounts = sqliteTable(
  "billing_accounts",
  {
    sitterId: text("sitter_id")
      .primaryKey()
      .references(() => sitterProfiles.id),
    customerId: text("customer_id"),
    subscriptionId: text("subscription_id"),
    status: text("status"),
    amountCents: integer("amount_cents"),
    currency: text("currency"),
    interval: text("interval"),
    currentPeriodEnd: integer("current_period_end"),
    cancelAtPeriodEnd: integer("cancel_at_period_end").notNull().default(0),
    cancelAt: integer("cancel_at"),
    syncedAt: integer("synced_at"),
    checkoutAttempt: text("checkout_attempt"),
    checkoutId: text("checkout_id"),
    checkoutUrl: text("checkout_url"),
    checkoutExpiresAt: integer("checkout_expires_at"),
    lockToken: text("lock_token"),
    lockUntil: integer("lock_until").notNull().default(0),
  },
  (t) => [
    uniqueIndex("billing_customer_unique").on(t.customerId),
    index("idx_billing_synced").on(t.syncedAt),
  ],
);

export const stripeInvoices = sqliteTable(
  "stripe_invoices",
  {
    id: text("id").primaryKey(),
    sitterId: text("sitter_id")
      .notNull()
      .references(() => sitterProfiles.id),
    invoiceDate: integer("invoice_date").notNull(),
    amountPaidCents: integer("amount_paid_cents").notNull(),
    amountDueCents: integer("amount_due_cents").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull(),
    invoiceUrl: text("invoice_url"),
    pdfUrl: text("pdf_url"),
    description: text("description").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_stripe_invoices_sitter_date").on(t.sitterId, t.invoiceDate),
  ],
);

export const uploadObjects = sqliteTable(
  "upload_objects",
  {
    id: text("id").primaryKey(),
    sitterId: text("sitter_id")
      .notNull()
      .references(() => sitterProfiles.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    category: text("category").notNull().default("other"),
    clientId: text("client_id").references(() => clients.id),
    petId: text("pet_id").references(() => pets.id),
    uploadStatus: text("upload_status").notNull().default("ready"),
    archivedAt: integer("archived_at"),
    updatedAt: integer("updated_at").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("upload_objects_object_key_unique").on(table.objectKey),
    index("idx_upload_objects_sitter_created_at").on(
      table.sitterId,
      table.createdAt,
    ),
    index("idx_documents_sitter_state_created").on(
      table.sitterId,
      table.uploadStatus,
      table.archivedAt,
      table.createdAt,
    ),
    index("idx_documents_client_pet").on(table.clientId, table.petId),
    index("idx_documents_upload_cleanup").on(
      table.uploadStatus,
      table.createdAt,
    ),
  ],
);

export const notificationOutbox = sqliteTable(
  "notification_outbox",
  {
    id: text("id").primaryKey(),
    sitterId: text("sitter_id")
      .notNull()
      .references(() => sitterProfiles.id),
    bookingId: text("booking_id").references(() => bookings.id),
    kind: text("kind").notNull(),
    recipientRole: text("recipient_role").notNull().default("sitter"),
    payload: text("payload"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    firstAttemptAt: integer("first_attempt_at"),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseUntil: integer("lease_until").notNull().default(0),
    providerId: text("provider_id"),
    lastError: text("last_error"),
    expiresAt: integer("expires_at").notNull(),
    sentAt: integer("sent_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_notifications_due").on(t.status, t.nextAttemptAt),
    index("idx_notifications_sitter_created").on(t.sitterId, t.createdAt),
    index("idx_notifications_booking_kind").on(t.bookingId, t.kind, t.status),
  ],
);

export const stripeEvents = sqliteTable(
  "stripe_events",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    processedAt: integer("processed_at").notNull(),
  },
  (table) => [uniqueIndex("stripe_events_event_id_unique").on(table.eventId)],
);

export const cronRuns = sqliteTable(
  "cron_runs",
  {
    id: text("id").primaryKey(),
    job: text("job", {
      enum: ["booking-reminders", "stripe-reconciliation"],
    }).notNull(),
    scheduledAt: integer("scheduled_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_cron_runs_job_scheduled_at").on(table.job, table.scheduledAt),
    index("idx_cron_runs_created").on(table.createdAt),
  ],
);

// Better Auth's Drizzle adapter expects plural keys for one-to-many relations.
export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));
export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));
export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));
export const authSchema = {
  user,
  session,
  account,
  verification,
  rateLimit,
  userRelations,
  sessionRelations,
  accountRelations,
};
