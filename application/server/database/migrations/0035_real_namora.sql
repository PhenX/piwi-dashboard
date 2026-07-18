CREATE TABLE `markers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`occurred_at` integer NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`category` text DEFAULT 'event' NOT NULL,
	`environment` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`run_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_markers_project_id` ON `markers` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_markers_project_occurred` ON `markers` (`project_id`,`occurred_at`);