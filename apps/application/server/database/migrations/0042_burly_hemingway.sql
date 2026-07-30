CREATE TABLE `quarantined_tests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`test_case_id` integer NOT NULL,
	`reason` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`quarantined_at_run_id` integer,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`released_at` integer,
	`released_reason` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_quarantined_tests_project` ON `quarantined_tests` (`project_id`,`released_at`);--> statement-breakpoint
CREATE INDEX `idx_quarantined_tests_created_by` ON `quarantined_tests` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quarantined_tests_active` ON `quarantined_tests` (`test_case_id`) WHERE released_at IS NULL;