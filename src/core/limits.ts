// Every limit and price in the product. Nothing else hard-codes one.

// --- What a search asks TinySet for -------------------------------------------------------------

/** Rows a search asks TinySet for. */
export const TARGET_ROWS = 30;
/** Rounds announced on or after the first day of the month this many months back count. */
export const WINDOW_MONTHS = 18;
/** The founder's line: at least this many characters... */
export const LINE_MIN_CHARS = 20;
/** ...and at most this many. */
export const LINE_MAX_CHARS = 140;

// --- How a search runs ---------------------------------------------------------------------------

/** How long a TinySet run takes, in minutes, as the runs so far have gone. The page of a running
 *  search says so. */
export const RUN_TAKES_MINUTES = { from: 5, to: 20 } as const;
/** One search runs on TinySet at a time; a holder of the run slot older than this no longer blocks
 *  the queue. */
export const RUN_SLOT_STALE_MINUTES = 45;
/** A search still finding after this long is failed: the run is cancelled and nothing is ranked
 *  unless enough companies were proved. */
export const SEARCH_TIMEOUT_MINUTES = 40;
/** A search's dataset is read at most once in this many seconds, however often `advance` runs. */
export const DATASET_READ_EVERY_SECONDS = 10;
/** Pages of rows read per dataset read (500 rows a page; a search asks for 30). */
export const MAX_ROW_PAGES = 4;
/** Companies one `advance` call checks at most. */
export const CHECKS_PER_ADVANCE = 3;
/** A company claimed for checking and not finished in this time can be claimed again. */
export const CHECK_CLAIM_STALE_MINUTES = 2;
/** An announcement or an investor's page is waited for this long at most. */
export const READ_TIMEOUT_MS = 15_000;
/** An announcement read that failed for a passing reason is tried again, up to this many reads in
 *  all, and not sooner than READ_RETRY_AFTER_SECONDS later. */
export const READ_ATTEMPTS = 3;
export const READ_RETRY_AFTER_SECONDS = 30;
/** One `advance` call starts no new announcement read after this long, so it ends well inside the
 *  time a Worker keeps running after its response. */
export const ADVANCE_BUDGET_MS = 12_000;
/** A quotation longer than this is cut to the clause around the investor's name. */
export const QUOTE_MAX_CHARS = 170;
/** A search whose TinySet run failed or was cancelled is ranked from what it found only when at
 *  least this many companies were proved; otherwise it fails and nothing is ranked. */
export const MIN_PROVED_TO_RANK = 5;
/** Below this many proved companies the ranked list says it is thin. */
export const THIN_BELOW = 10;

// --- The way in ----------------------------------------------------------------------------------

/** The way in is looked up for this many investors at the top of a search. */
export const WAY_IN_TOP = 10;
/** Investors one `advance` call looks up at most. */
export const WAY_INS_PER_ADVANCE = 2;
/** An investor lookup is reused across searches for this many days. */
export const INVESTOR_REUSE_DAYS = 30;
/** A lookup that failed for a passing reason (a timeout, a busy service) is tried this many times
 *  in all before it is stored as it stands. */
export const WAY_IN_ATTEMPTS = 3;

// --- Watching a saved search ---------------------------------------------------------------------

/** Searches watched at once, at most: the three demo searches. */
export const MAX_WATCHES = 3;
/** A watch runs at most this many days. */
export const WATCH_MAX_DAYS = 14;
/** When a watch's Monitor runs: twice a day, at 06:00 and 18:00 UTC. */
export const WATCH_SCHEDULE_CRON = "0 6,18 * * *";
/** A Monitor result counts as new when the search engine dates it within this many minutes. */
export const WATCH_RECENCY_MINUTES = 1440;
/** Results a Monitor run keeps. */
export const WATCH_RESULTS_PER_RUN = 5;
/** New results read per webhook call or cron minute, at most. */
export const WATCH_READS_PER_CALL = 3;

// --- Keeping and reusing -------------------------------------------------------------------------

/** The same line, stage and country within this many days opens the stored search. */
export const REUSE_DAYS = 7;
/** A public search is kept this many days, then deleted with its companies. Demo searches stay. */
export const PUBLIC_SEARCH_TTL_DAYS = 7;

// --- Public limits -------------------------------------------------------------------------------

/** New public searches a UTC day, across every visitor. */
export const PUBLIC_SEARCHES_PER_DAY = 3;
/** New public searches a UTC day, per visitor. */
export const PUBLIC_SEARCHES_PER_VISITOR_PER_DAY = 1;

// --- Money ---------------------------------------------------------------------------------------

/** What a new search is budgeted at until its run ends and the wallet says what it cost. The rate
 *  card is $0.10 a row (30 rows, $3); the runs measured so far cost about $1. */
export const SEARCH_BUDGET_USD = 3;
/** All paid work stops when the ledger, plus the budget of every unsettled run, reaches this. */
export const SPEND_STOP_USD = 9;
/** Part of a run can be billed after it ends. The wallet is read again this long after the run's
 *  cost was booked, and the booked cost corrected once. */
export const SETTLE_AFTER_MINUTES = 10;

/** US dollars per unit, by ledger kind. */
export const PRICES = {
  /** A TinySet row at the rate card: the cost of a run when the wallet cannot say it. */
  dataset_row: 0.1,
  /** A TinySet API call (create, read, cancel). The run's cost is booked when it ends. */
  dataset: 0,
  fetch: 0,
  search: 0,
  /** One Topic Monitor run. The rate known from the first account; not yet confirmed on this one. */
  monitor_check: 0.005,
  wallet: 0,
} as const;
