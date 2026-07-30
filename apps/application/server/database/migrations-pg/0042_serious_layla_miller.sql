ALTER TABLE "failure_clusters" ADD COLUMN "fix_landed_run_id" integer;--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD COLUMN "fix_landed_at" timestamp;--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD COLUMN "fix_commit" text;--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD COLUMN "time_to_resolution_ms" integer;--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD COLUMN "fix_verification" text;