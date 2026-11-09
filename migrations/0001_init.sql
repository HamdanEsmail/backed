-- Backed: the first schema. Times are ISO 8601 UTC strings; dates are YYYY-MM-DD.

-- One founder's search. `state` moves queued -> finding -> checking -> ranking -> ready, or to failed.
-- `advance` (src/search/advance.ts) moves it a little at a time and is safe to call twice.
CREATE TABLE searches (
  id TEXT PRIMARY KEY,
  line TEXT NOT NULL,
  stage TEXT NOT NULL,
  country TEXT NOT NULL,
  -- The line, stage and country normalised: the same key within 7 days opens the stored search.
  reuse_key TEXT NOT NULL,
  -- 'public' (the form or the public API), 'admin' (the admin route) or 'import' (an adopted dataset).
  origin TEXT NOT NULL,
  -- 1 to 3 for the demo searches (1 is featured on the home), else NULL. Demo searches are kept.
  demo INTEGER,
  state TEXT NOT NULL DEFAULT 'queued',
  -- Why a failed search did not finish, in Backed's own words (never upstream text).
  failed_reason TEXT,
  -- The window and the stages the proof check holds rows to: the first day of the month 18 months
  -- back, and the founder's stage with the ones next to it (a JSON array).
  window_start TEXT NOT NULL,
  stages_json TEXT NOT NULL,
  -- The TinySet spec as it was sent, shown on the search's page ("What TinySet was asked").
  spec_json TEXT NOT NULL,
  dataset_id TEXT,
  run_id TEXT,
  dataset_status TEXT,
  row_count INTEGER,
  -- When the dataset was last read. One read at a time per search: a read claims this column first.
  synced_at TEXT,
  -- The wallet before the run started and after it ended; the difference is the search's cost.
  wallet_before_usd REAL,
  wallet_after_usd REAL,
  cost_usd REAL,
  -- 'wallet' (the difference above) or 'rows' (rows at the rate card, when the key is shared).
  cost_basis TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  -- A public search is deleted with its companies after this time; NULL keeps it.
  expires_at TEXT
);
CREATE INDEX searches_reuse ON searches (reuse_key, created_at);
CREATE INDEX searches_state ON searches (state, created_at);

-- One company TinySet found for a search (or, later, one a watch found). Stored by the row's
-- `_id`: rows change while a run is in progress, and a changed row is checked again.
CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  search_id TEXT NOT NULL REFERENCES searches (id) ON DELETE CASCADE,
  -- The TinySet row `_id`.
  row_id TEXT NOT NULL,
  -- 'tinyset' or 'watch'.
  source TEXT NOT NULL DEFAULT 'tinyset',
  -- 1 when the row is no longer in the dataset (merged into another, or removed).
  removed INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  website TEXT,
  country TEXT,
  description TEXT,
  round_type TEXT,
  amount_usd REAL,
  announced_on TEXT,
  lead_investor TEXT,
  lead_investor_website TEXT,
  other_investors TEXT,
  lead_partner TEXT,
  founders TEXT,
  announcement_url TEXT,
  -- The fields the proof check depends on, joined: when it changes, the company is checked again.
  check_key TEXT NOT NULL,
  -- 'unchecked', 'checking' (claimed at `claimed_at`), 'proved' or 'set_apart'.
  state TEXT NOT NULL DEFAULT 'unchecked',
  claimed_at TEXT,
  -- Why a company was set apart: a short code the page turns into its sentence.
  set_apart_reason TEXT,
  -- The page that was read (after redirects) and when.
  page_url TEXT,
  read_at TEXT,
  -- The partner and the founders, kept only when the page names them (JSON array for founders).
  partner_named TEXT,
  founders_named_json TEXT,
  found_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (search_id, row_id)
);
CREATE INDEX companies_state ON companies (search_id, state);

-- Each investor listed for a company, whether or not the page names it. Only a named investor
-- counts. The points are this company's share of the investor's score, part by part.
CREATE TABLE company_investors (
  company_id TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  search_id TEXT NOT NULL,
  -- The normalised name: the key investors are grouped by across companies.
  investor_key TEXT NOT NULL,
  -- The name as the row lists it.
  name TEXT NOT NULL,
  -- 'lead' or 'other'.
  role TEXT NOT NULL,
  named INTEGER NOT NULL DEFAULT 0,
  -- The sentence from the page that names the investor, cut around the name.
  quote TEXT,
  points INTEGER,
  -- The parts of `points` (JSON: [{ "part": "backed", "points": 3 }, ...]).
  parts_json TEXT,
  PRIMARY KEY (company_id, investor_key)
);
CREATE INDEX company_investors_search ON company_investors (search_id, investor_key);

-- A search's investors in ranked order, written when the search is ranked.
CREATE TABLE ranking (
  search_id TEXT NOT NULL REFERENCES searches (id) ON DELETE CASCADE,
  investor_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  -- URL-safe and unique within the search.
  slug TEXT NOT NULL,
  score INTEGER NOT NULL,
  companies INTEGER NOT NULL,
  led INTEGER NOT NULL,
  -- "Rounds they joined": stages (JSON array) and the smallest and largest round, from the rows.
  stages_json TEXT NOT NULL,
  min_round_usd REAL,
  max_round_usd REAL,
  -- A website the rows give for this investor (as a lead), used first by the way in.
  site_hint TEXT,
  PRIMARY KEY (search_id, investor_key),
  UNIQUE (search_id, slug)
);
CREATE INDEX ranking_position ON ranking (search_id, position);

-- The way in for an investor, looked up once and reused across searches for 30 days.
CREATE TABLE investors (
  investor_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- 'pending', 'looking' (claimed at `claimed_at`) or 'done'.
  state TEXT NOT NULL DEFAULT 'pending',
  claimed_at TEXT,
  -- Their own site and how it was found: 'row', 'search' or 'none'.
  site_url TEXT,
  site_source TEXT,
  -- 'form', 'email' or 'none'; the form's address or the published email address.
  door_kind TEXT,
  door_url TEXT,
  door_email TEXT,
  -- A cheque size, only when their site states one in figures: the words quoted and the page.
  cheque_quote TEXT,
  cheque_url TEXT,
  -- When their site was read; NULL when it could not be read.
  read_at TEXT,
  looked_up_at TEXT
);

-- The spend ledger: one row per TinyFish call (free calls at $0), plus one row per finished
-- TinySet run with what it cost.
CREATE TABLE spend (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  ref TEXT,
  at TEXT NOT NULL
);
CREATE INDEX spend_kind ON spend (kind);

-- Daily counters behind the public limits. One row per (visitor hash, UTC day); the row with
-- ip_hash 'all' counts every public search that day.
CREATE TABLE public_use (
  ip_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  searches INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, day)
);

-- The one search allowed to run on TinySet at a time. One row, always present.
CREATE TABLE run_slot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  search_id TEXT,
  since TEXT
);
INSERT INTO run_slot (id) VALUES (1);
