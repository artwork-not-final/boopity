CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`sitter_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`emergency_contact_name` text DEFAULT '' NOT NULL,
	`emergency_contact_phone` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sitter_id`) REFERENCES `sitter_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_clients_sitter_created_at` ON `clients` (`sitter_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_clients_sitter_status` ON `clients` (`sitter_id`,`status`);--> statement-breakpoint
CREATE TABLE `pets` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`species` text DEFAULT 'dog' NOT NULL,
	`breed` text,
	`color` text,
	`date_of_birth` text,
	`weight` real,
	`spayed_neutered` integer DEFAULT false NOT NULL,
	`microchipped` integer DEFAULT false NOT NULL,
	`microchip_id` text,
	`photo_object_key` text,
	`vaccinations_current` integer DEFAULT false NOT NULL,
	`medical_conditions` text,
	`medications` text,
	`allergies` text,
	`behavior_notes` text,
	`feeding_instructions` text,
	`special_instructions` text,
	`vet_name` text,
	`vet_phone` text,
	`vet_clinic` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pets_client_active_name` ON `pets` (`client_id`,`is_active`,`name`);--> statement-breakpoint
CREATE TABLE `sitter_pet_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`sitter_id` text NOT NULL,
	`pet_id` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sitter_id`) REFERENCES `sitter_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sitter_pet_notes_sitter_pet_unique` ON `sitter_pet_notes` (`sitter_id`,`pet_id`);--> statement-breakpoint
ALTER TABLE `sitter_profiles` ADD `subscription_tier` text DEFAULT 'free' NOT NULL;--> statement-breakpoint
PRAGMA optimize;
