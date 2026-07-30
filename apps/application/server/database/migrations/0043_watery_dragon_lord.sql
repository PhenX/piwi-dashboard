CREATE TABLE `test_functions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`module` text NOT NULL,
	`receiver` text,
	`import_name` text,
	`params` text NOT NULL,
	`returns_page` integer DEFAULT false NOT NULL,
	`url_pattern` text,
	`steps` text NOT NULL,
	`param_sources` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_test_functions_project_id` ON `test_functions` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_test_functions_project_module_name` ON `test_functions` (`project_id`,`module`,`name`);