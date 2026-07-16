PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_failure_diagnoses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cluster_id` integer,
	`scope` text DEFAULT 'cluster' NOT NULL,
	`test_runs_case_id` integer,
	`context_sha` text,
	`status` text DEFAULT 'running' NOT NULL,
	`provider` text,
	`model` text,
	`category` text,
	`confidence` text,
	`summary` text,
	`root_cause` text,
	`details` text,
	`error` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`duration_ms` integer,
	`feedback` text,
	`feedback_note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`cluster_id`) REFERENCES `failure_clusters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_runs_case_id`) REFERENCES `test_runs_cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_failure_diagnoses`("id", "cluster_id", "scope", "test_runs_case_id", "context_sha", "status", "provider", "model", "category", "confidence", "summary", "root_cause", "details", "error", "input_tokens", "output_tokens", "duration_ms", "feedback", "feedback_note", "created_at", "updated_at") SELECT "id", "cluster_id", "scope", "test_runs_case_id", "context_sha", "status", "provider", "model", "category", "confidence", "summary", "root_cause", "details", "error", "input_tokens", "output_tokens", "duration_ms", "feedback", "feedback_note", "created_at", "updated_at" FROM `failure_diagnoses`;--> statement-breakpoint
DROP TABLE `failure_diagnoses`;--> statement-breakpoint
ALTER TABLE `__new_failure_diagnoses` RENAME TO `failure_diagnoses`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_failure_diagnoses_cluster_scope` ON `failure_diagnoses` (`cluster_id`,`scope`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_failure_diagnoses_execution` ON `failure_diagnoses` (`test_runs_case_id`,`scope`);--> statement-breakpoint
CREATE TABLE `__new_failure_diagnosis_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`diagnosis_id` integer NOT NULL,
	`cluster_id` integer,
	`scope` text DEFAULT 'cluster' NOT NULL,
	`test_runs_case_id` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`provider` text,
	`model` text,
	`category` text,
	`confidence` text,
	`summary` text,
	`root_cause` text,
	`details` text,
	`error` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`duration_ms` integer,
	`context_sha` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`diagnosis_id`) REFERENCES `failure_diagnoses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `failure_clusters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_runs_case_id`) REFERENCES `test_runs_cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_failure_diagnosis_versions`("id", "diagnosis_id", "cluster_id", "scope", "test_runs_case_id", "status", "provider", "model", "category", "confidence", "summary", "root_cause", "details", "error", "input_tokens", "output_tokens", "duration_ms", "context_sha", "created_at") SELECT "id", "diagnosis_id", "cluster_id", "scope", "test_runs_case_id", "status", "provider", "model", "category", "confidence", "summary", "root_cause", "details", "error", "input_tokens", "output_tokens", "duration_ms", "context_sha", "created_at" FROM `failure_diagnosis_versions`;--> statement-breakpoint
DROP TABLE `failure_diagnosis_versions`;--> statement-breakpoint
ALTER TABLE `__new_failure_diagnosis_versions` RENAME TO `failure_diagnosis_versions`;--> statement-breakpoint
CREATE INDEX `idx_fdv_diagnosis_id` ON `failure_diagnosis_versions` (`diagnosis_id`);--> statement-breakpoint
CREATE INDEX `idx_fdv_cluster_id` ON `failure_diagnosis_versions` (`cluster_id`);