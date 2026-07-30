CREATE TABLE "test_functions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"module" text NOT NULL,
	"receiver" text,
	"import_name" text,
	"params" text NOT NULL,
	"returns_page" boolean DEFAULT false NOT NULL,
	"url_pattern" text,
	"steps" text NOT NULL,
	"param_sources" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"confidence" double precision DEFAULT 1 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_functions" ADD CONSTRAINT "test_functions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_test_functions_project_id" ON "test_functions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_test_functions_project_module_name" ON "test_functions" USING btree ("project_id","module","name");