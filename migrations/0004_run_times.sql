-- When TinySet's run started and ended, as TinySet reports it. For an adopted dataset this is the
-- only time there is: the run did not happen here.
ALTER TABLE searches ADD COLUMN run_started_at TEXT;
ALTER TABLE searches ADD COLUMN run_finished_at TEXT;
