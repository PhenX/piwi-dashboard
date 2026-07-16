DROP INDEX `idx_test_runs_cases_test_case_id`;--> statement-breakpoint
CREATE INDEX `idx_test_runs_cases_case_created` ON `test_runs_cases` (`test_case_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_account_tokens_user` ON `account_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_cluster_merge_suggestions_cluster_b` ON `cluster_merge_suggestions` (`cluster_b_id`);--> statement-breakpoint
CREATE INDEX `idx_entity_links_created_by` ON `entity_links` (`created_by`);--> statement-breakpoint
CREATE INDEX `idx_failure_clusters_project_status` ON `failure_clusters` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_fdv_test_runs_case` ON `failure_diagnosis_versions` (`test_runs_case_id`);--> statement-breakpoint
CREATE INDEX `idx_files_blob_id` ON `files` (`blob_id`);--> statement-breakpoint
CREATE INDEX `idx_locator_snapshots_last_seen_run` ON `locator_snapshots` (`last_seen_run_id`);--> statement-breakpoint
CREATE INDEX `idx_notification_deliveries_subscription` ON `notification_deliveries` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `idx_notification_deliveries_channel` ON `notification_deliveries` (`channel_id`);--> statement-breakpoint
CREATE INDEX `idx_project_assignments_created_by` ON `project_assignments` (`created_by`);--> statement-breakpoint
CREATE INDEX `idx_test_cases_suite` ON `test_cases` (`suite_id`);--> statement-breakpoint
CREATE INDEX `idx_test_runs_status` ON `test_runs` (`status`);