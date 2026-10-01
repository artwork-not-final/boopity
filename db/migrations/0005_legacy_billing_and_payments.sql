CREATE TABLE `billing_accounts` (
	`sitter_id` text PRIMARY KEY NOT NULL,
	`customer_id` text,
	`subscription_id` text,
	`status` text,
	`amount_cents` integer,
	`currency` text,
	`interval` text,
	`current_period_end` integer,
	`cancel_at_period_end` integer DEFAULT 0 NOT NULL,
	`cancel_at` integer,
	`synced_at` integer,
	`checkout_attempt` text,
	`checkout_id` text,
	`checkout_url` text,
	`checkout_expires_at` integer,
	`lock_token` text,
	`lock_until` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`sitter_id`) REFERENCES `sitter_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_customer_unique` ON `billing_accounts` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_billing_synced` ON `billing_accounts` (`synced_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`sitter_id` text NOT NULL,
	`booking_id` text NOT NULL,
	`request_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`method` text NOT NULL,
	`status` text DEFAULT 'paid' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`paid_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`sitter_id`) REFERENCES `sitter_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_sitter_request_unique` ON `payments` (`sitter_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_sitter_created` ON `payments` (`sitter_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_payments_sitter_status_paid` ON `payments` (`sitter_id`,`status`,`paid_at`);--> statement-breakpoint
CREATE INDEX `idx_payments_booking_status` ON `payments` (`booking_id`,`status`);--> statement-breakpoint
CREATE TABLE `stripe_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`sitter_id` text NOT NULL,
	`invoice_date` integer NOT NULL,
	`amount_paid_cents` integer NOT NULL,
	`amount_due_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`invoice_url` text,
	`pdf_url` text,
	`description` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sitter_id`) REFERENCES `sitter_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_stripe_invoices_sitter_date` ON `stripe_invoices` (`sitter_id`,`invoice_date`);
--> statement-breakpoint
PRAGMA optimize;
