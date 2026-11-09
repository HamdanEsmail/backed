-- An announcement read that failed for a passing reason (a timeout, a busy service) is tried again
-- in a later `advance`, up to READ_ATTEMPTS reads in all, not before `retry_at`.
ALTER TABLE companies ADD COLUMN read_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN retry_at TEXT;
