CREATE TABLE `availability` (
	`id` text PRIMARY KEY NOT NULL,
	`sitter_id` text NOT NULL,
	`day_of_week` integer NOT NULL,
	`start_time` text DEFAULT '09:00' NOT NULL,
	`end_time` text DEFAULT '17:00' NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`sitter_id`) REFERENCES `sitter_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `availability_sitter_day_unique` ON `availability` (`sitter_id`,`day_of_week`);--> statement-breakpoint
CREATE TABLE `blocked_dates` (
	`id` text PRIMARY KEY NOT NULL,
	`sitter_id` text NOT NULL,
	`date` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`sitter_id`) REFERENCES `sitter_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blocked_dates_sitter_date_unique` ON `blocked_dates` (`sitter_id`,`date`);--> statement-breakpoint
CREATE TABLE `booking_pets` (
	`booking_id` text NOT NULL,
	`pet_id` text NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_pets_booking_pet_unique` ON `booking_pets` (`booking_id`,`pet_id`);--> statement-breakpoint
CREATE INDEX `idx_booking_pets_pet_id` ON `booking_pets` (`pet_id`);--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`sitter_id` text NOT NULL,
	`client_id` text NOT NULL,
	`service_id` text,
	`service_name` text NOT NULL,
	`service_duration_minutes` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`notes` text DEFAULT '' NOT NULL,
	`post_service_notes` text DEFAULT '' NOT NULL,
	`total_amount_cents` integer NOT NULL,
	`payment_status` text DEFAULT 'pending' NOT NULL,
	`recurrence_rule` text,
	`parent_booking_id` text,
	`reminder_sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sitter_id`) REFERENCES `sitter_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_bookings_sitter_start_date` ON `bookings` (`sitter_id`,`start_date`);--> statement-breakpoint
CREATE INDEX `idx_bookings_client_start_date` ON `bookings` (`client_id`,`start_date`);--> statement-breakpoint
CREATE INDEX `idx_bookings_parent_id` ON `bookings` (`parent_booking_id`);--> statement-breakpoint
CREATE INDEX `idx_bookings_reminders` ON `bookings` (`sitter_id`,`status`,`start_at`);--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`sitter_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`duration_minutes` integer,
	`price_cents` integer NOT NULL,
	`additional_pet_price_cents` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sitter_id`) REFERENCES `sitter_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_services_sitter_active_name` ON `services` (`sitter_id`,`is_active`,`name`);--> statement-breakpoint
PRAGMA optimize;
