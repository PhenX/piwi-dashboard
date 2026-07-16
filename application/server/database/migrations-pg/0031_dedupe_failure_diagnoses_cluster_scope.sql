-- Duplicate (cluster_id, scope) rows can exist because PostgreSQL lacked the
-- unique index SQLite has always had. Keep the newest row per key, repoint its
-- version history, and delete the rest so the unique index can be created.
WITH ranked AS (
	SELECT id, cluster_id, scope,
		row_number() OVER (PARTITION BY cluster_id, scope ORDER BY updated_at DESC, id DESC) AS rn
	FROM failure_diagnoses
	WHERE cluster_id IS NOT NULL
),
survivors AS (
	SELECT cluster_id, scope, id FROM ranked WHERE rn = 1
),
losers AS (
	SELECT r.id, s.id AS survivor_id
	FROM ranked r
	JOIN survivors s ON s.cluster_id = r.cluster_id AND s.scope = r.scope
	WHERE r.rn > 1
)
UPDATE failure_diagnosis_versions v
SET diagnosis_id = l.survivor_id
FROM losers l
WHERE v.diagnosis_id = l.id;
--> statement-breakpoint
WITH ranked AS (
	SELECT id,
		row_number() OVER (PARTITION BY cluster_id, scope ORDER BY updated_at DESC, id DESC) AS rn
	FROM failure_diagnoses
	WHERE cluster_id IS NOT NULL
)
DELETE FROM failure_diagnoses fd
USING ranked r
WHERE fd.id = r.id AND r.rn > 1;
