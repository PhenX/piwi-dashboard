ALTER TABLE "test_cases" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "owner" text;--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "priority" text;--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "feature" text;--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD COLUMN "test_meta" jsonb;--> statement-breakpoint
CREATE INDEX "idx_test_cases_owner" ON "test_cases" USING btree ("project_id","owner");