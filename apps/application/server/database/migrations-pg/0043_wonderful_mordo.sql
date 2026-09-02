CREATE TABLE "quarantined_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"test_case_id" integer NOT NULL,
	"reason" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"quarantined_at_run_id" integer,
	"created_by" integer,
	"created_at" timestamp NOT NULL,
	"released_at" timestamp,
	"released_reason" text
);
--> statement-breakpoint
ALTER TABLE "quarantined_tests" ADD CONSTRAINT "quarantined_tests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantined_tests" ADD CONSTRAINT "quarantined_tests_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantined_tests" ADD CONSTRAINT "quarantined_tests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_quarantined_tests_project" ON "quarantined_tests" USING btree ("project_id","released_at");--> statement-breakpoint
CREATE INDEX "idx_quarantined_tests_created_by" ON "quarantined_tests" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_quarantined_tests_active" ON "quarantined_tests" USING btree ("test_case_id") WHERE released_at IS NULL;