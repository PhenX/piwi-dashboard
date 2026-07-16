ALTER TABLE "failure_diagnoses" ALTER COLUMN "cluster_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "failure_diagnosis_versions" ALTER COLUMN "cluster_id" DROP NOT NULL;