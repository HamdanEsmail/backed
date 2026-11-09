-- A run's cost is booked from the wallet the moment it ends, but part of a run can be billed after
-- that. The wallet is read again later and the booked cost corrected once: when it was booked, and
-- when it was settled.
ALTER TABLE searches ADD COLUMN run_booked_at TEXT;
ALTER TABLE searches ADD COLUMN cost_settled_at TEXT;
