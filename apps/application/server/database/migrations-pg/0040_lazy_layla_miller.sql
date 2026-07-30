ALTER TABLE "test_runs" ADD COLUMN "import_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_test_runs_import_hash" ON "test_runs" USING btree ("project_id","import_hash");