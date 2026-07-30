-- Older rows predate the scalar browser_name column and only carry the
-- browser JSON blob; backfill so read paths can rely on the scalar.
UPDATE test_runs_cases
SET browser_name = json_extract(browser, '$.projectName')
WHERE browser_name IS NULL
	AND browser IS NOT NULL
	AND json_extract(browser, '$.projectName') IS NOT NULL;
