CREATE TABLE "case_payloads" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"hash" text NOT NULL,
	"content" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD COLUMN "aria_snapshot_payload_id" integer;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD COLUMN "test_source_payload_id" integer;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD COLUMN "test_source_frames_payload_id" integer;--> statement-breakpoint
ALTER TABLE "case_payloads" ADD CONSTRAINT "case_payloads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_case_payloads_project_hash" ON "case_payloads" USING btree ("project_id","hash");--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD CONSTRAINT "test_runs_cases_aria_snapshot_payload_id_case_payloads_id_fk" FOREIGN KEY ("aria_snapshot_payload_id") REFERENCES "public"."case_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD CONSTRAINT "test_runs_cases_test_source_payload_id_case_payloads_id_fk" FOREIGN KEY ("test_source_payload_id") REFERENCES "public"."case_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs_cases" ADD CONSTRAINT "test_runs_cases_test_source_frames_payload_id_case_payloads_id_fk" FOREIGN KEY ("test_source_frames_payload_id") REFERENCES "public"."case_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_trc_aria_payload" ON "test_runs_cases" USING btree ("aria_snapshot_payload_id") WHERE aria_snapshot_payload_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_trc_source_payload" ON "test_runs_cases" USING btree ("test_source_payload_id") WHERE test_source_payload_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_trc_frames_payload" ON "test_runs_cases" USING btree ("test_source_frames_payload_id") WHERE test_source_frames_payload_id IS NOT NULL;