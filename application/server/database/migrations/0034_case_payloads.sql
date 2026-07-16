CREATE TABLE `case_payloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`hash` text NOT NULL,
	`content` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_case_payloads_project_hash` ON `case_payloads` (`project_id`,`hash`);--> statement-breakpoint
ALTER TABLE `test_runs_cases` ADD `aria_snapshot_payload_id` integer REFERENCES case_payloads(id);--> statement-breakpoint
ALTER TABLE `test_runs_cases` ADD `test_source_payload_id` integer REFERENCES case_payloads(id);--> statement-breakpoint
ALTER TABLE `test_runs_cases` ADD `test_source_frames_payload_id` integer REFERENCES case_payloads(id);--> statement-breakpoint
CREATE INDEX `idx_trc_aria_payload` ON `test_runs_cases` (`aria_snapshot_payload_id`) WHERE aria_snapshot_payload_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_trc_source_payload` ON `test_runs_cases` (`test_source_payload_id`) WHERE test_source_payload_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_trc_frames_payload` ON `test_runs_cases` (`test_source_frames_payload_id`) WHERE test_source_frames_payload_id IS NOT NULL;