DROP INDEX "idx_failure_diagnoses_execution_scope";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_failure_diagnoses_cluster_scope" ON "failure_diagnoses" USING btree ("cluster_id","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_failure_diagnoses_execution" ON "failure_diagnoses" USING btree ("test_runs_case_id","scope");