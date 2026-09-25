CREATE INDEX `idx_cron_runs_created` ON `cron_runs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_rate_limit_last_request` ON `rate_limit` (`last_request`);--> statement-breakpoint
CREATE INDEX `idx_session_expires` ON `session` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_verification_expires` ON `verification` (`expires_at`);