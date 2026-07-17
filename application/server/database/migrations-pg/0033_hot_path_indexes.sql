DROP INDEX "idx_test_runs_cases_test_case_id";--> statement-breakpoint
CREATE INDEX "idx_account_tokens_user" ON "account_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_cluster_merge_suggestions_cluster_b" ON "cluster_merge_suggestions" USING btree ("cluster_b_id");--> statement-breakpoint
CREATE INDEX "idx_entity_links_created_by" ON "entity_links" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "idx_failure_clusters_project_status" ON "failure_clusters" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "idx_fdv_test_runs_case" ON "failure_diagnosis_versions" USING btree ("test_runs_case_id");--> statement-breakpoint
CREATE INDEX "idx_files_blob_id" ON "files" USING btree ("blob_id");--> statement-breakpoint
CREATE INDEX "idx_locator_snapshots_last_seen_run" ON "locator_snapshots" USING btree ("last_seen_run_id");--> statement-breakpoint
CREATE INDEX "idx_notification_deliveries_subscription" ON "notification_deliveries" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "idx_notification_deliveries_channel" ON "notification_deliveries" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_project_assignments_created_by" ON "project_assignments" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "idx_test_cases_suite" ON "test_cases" USING btree ("suite_id");--> statement-breakpoint
CREATE INDEX "idx_test_runs_status" ON "test_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_test_runs_cases_case_created" ON "test_runs_cases" USING btree ("test_case_id","created_at");