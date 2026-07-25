ALTER TABLE `test_cases` ADD `tags` text;--> statement-breakpoint
ALTER TABLE `test_cases` ADD `owner` text;--> statement-breakpoint
ALTER TABLE `test_cases` ADD `priority` text;--> statement-breakpoint
ALTER TABLE `test_cases` ADD `feature` text;--> statement-breakpoint
ALTER TABLE `test_cases` ADD `link` text;--> statement-breakpoint
CREATE INDEX `idx_test_cases_owner` ON `test_cases` (`project_id`,`owner`);--> statement-breakpoint
ALTER TABLE `test_runs_cases` ADD `tags` text;--> statement-breakpoint
ALTER TABLE `test_runs_cases` ADD `test_meta` text;