-- Watching a saved search (spec section 8). A watch is one TinyFish Topic Monitor that Backed
-- created for one demo search; Backed keeps its id and only ever deletes that id.
CREATE TABLE watches (
  search_id TEXT PRIMARY KEY REFERENCES searches (id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL UNIQUE,
  -- The search query the Monitor runs ("<key words> raises seed funding").
  query TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- The last day it runs (YYYY-MM-DD); the cron deletes the Monitor after it.
  until TEXT NOT NULL,
  last_run_at TEXT,
  -- Set when the Monitor was deleted: 'admin', 'until' or 'spend_stop'.
  ended_at TEXT,
  ended_reason TEXT
);

-- One Monitor run, by its id: a run delivered twice is booked and read once.
CREATE TABLE watch_runs (
  run_id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  results INTEGER NOT NULL
);

-- One new result a run reported for a watched search, read once. 'new' waits to be read;
-- 'checking' is claimed at `claimed_at`; then 'added' (a company proved and added), 'known' (the
-- search already has that company or page) or 'refused' (with the reason).
CREATE TABLE watch_hits (
  search_id TEXT NOT NULL REFERENCES searches (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  -- The date the search result gave, as written ("Sep 16, 2026", "3 hours ago").
  date_text TEXT,
  run_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'new',
  claimed_at TEXT,
  reason TEXT,
  company_id TEXT,
  seen_at TEXT NOT NULL,
  done_at TEXT,
  PRIMARY KEY (search_id, url)
);
CREATE INDEX watch_hits_state ON watch_hits (state, seen_at);
