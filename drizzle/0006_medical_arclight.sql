CREATE TABLE `notification_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`sitter_id` text NOT NULL,
	`booking_id` text,
	`kind` text NOT NULL,
	`recipient_role` text DEFAULT 'sitter' NOT NULL,
	`payload` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`first_attempt_at` integer,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`provider_id` text,
	`last_error` text,
	`expires_at` integer NOT NULL,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`sitter_id`) REFERENCES `sitter_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_due` ON `notification_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `idx_notifications_sitter_created` ON `notification_outbox` (`sitter_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_notifications_booking_kind` ON `notification_outbox` (`booking_id`,`kind`,`status`);--> statement-breakpoint
ALTER TABLE `upload_objects` ADD `title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `upload_objects` ADD `description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `upload_objects` ADD `category` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `upload_objects` ADD `client_id` text REFERENCES clients(id);--> statement-breakpoint
ALTER TABLE `upload_objects` ADD `pet_id` text REFERENCES pets(id);--> statement-breakpoint
ALTER TABLE `upload_objects` ADD `upload_status` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `upload_objects` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `upload_objects` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `upload_objects` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_documents_sitter_state_created` ON `upload_objects` (`sitter_id`,`upload_status`,`archived_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_documents_client_pet` ON `upload_objects` (`client_id`,`pet_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_upload_cleanup` ON `upload_objects` (`upload_status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_bookings_reminder_due` ON `bookings` (`status`,`reminder_sent_at`,`start_at`);
--> statement-breakpoint
PRAGMA optimize;
