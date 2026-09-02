ALTER TABLE `failure_clusters` ADD `fix_landed_run_id` integer;--> statement-breakpoint
ALTER TABLE `failure_clusters` ADD `fix_landed_at` integer;--> statement-breakpoint
ALTER TABLE `failure_clusters` ADD `fix_commit` text;--> statement-breakpoint
ALTER TABLE `failure_clusters` ADD `time_to_resolution_ms` integer;--> statement-breakpoint
ALTER TABLE `failure_clusters` ADD `fix_verification` text;