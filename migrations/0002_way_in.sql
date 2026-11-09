-- The way in. A search stays `ranking` while the way in is looked up for its top investors; the
-- order is written once, when `ranked_at` is set.
ALTER TABLE searches ADD COLUMN ranked_at TEXT;

-- A lookup that failed for a passing reason (a timeout, a busy service) is tried again, a few times.
ALTER TABLE investors ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
