CREATE TABLE "markers" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'event' NOT NULL,
	"environment" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"run_id" integer,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "markers" ADD CONSTRAINT "markers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markers" ADD CONSTRAINT "markers_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_markers_project_id" ON "markers" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_markers_project_occurred" ON "markers" USING btree ("project_id","occurred_at");