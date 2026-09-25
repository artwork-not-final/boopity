CREATE TABLE `cron_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cron_runs_job_scheduled_at` ON `cron_runs` (`job`,`scheduled_at`);