// The state machine of a search. `advance(searchId)` moves it forward a little each time it is
// called and is safe to call twice at once: every step claims its work in one statement first.
//
//   queued   -> finding   the run slot is free and this is the oldest queued search: the wallet is
//                         read and the TinySet dataset created. A start whose answer never came
//                         back is not made again: its dataset is looked for by name first.
//   finding  -> checking  the dataset is read (at most every DATASET_READ_EVERY_SECONDS) and its rows
//                         stored; when the run ends, or can no longer be read past its time, its
//                         cost is booked in the same write and the slot freed.
//   finding, checking     companies are checked against their announcements, a few per call.
//   checking -> ranking   every company is checked.
//   ranking  -> ready     the investors are scored and the order stored; then the way in is looked
//                         up for the top investors, a few per call.
//   any      -> failed    TinySet would not start, found nothing, or ended badly with fewer than
//                         MIN_PROVED_TO_RANK companies proved.
import {
  ADVANCE_BUDGET_MS,
  CHECKS_PER_ADVANCE,
  CHECK_CLAIM_STALE_MINUTES,
  DATASET_READ_EVERY_SECONDS,
  MIN_PROVED_TO_RANK,
  PRICES,
  READ_ATTEMPTS,
  READ_RETRY_AFTER_SECONDS,
  SEARCH_BUDGET_USD,
  SEARCH_TIMEOUT_MINUTES,
  SETTLE_AFTER_MINUTES,
  TARGET_ROWS,
  WAY_IN_TOP,
  WAY_INS_PER_ADVANCE,
} from "../core/limits";
import { stageOfRound } from "../core/stages";
import type { Env } from "../env";
import { TinyFishError } from "../tinyfish/client";
import { cancelRun, createDataset, findDataset, getDataset, listRows, type Dataset, type DatasetSpec } from "../tinyfish/datasets";
import { fetchPage } from "../tinyfish/fetch";
import { readBalance } from "../tinyfish/wallet";
import { spendStopReached } from "./money";
import { checkCompany, precheck } from "./proof";
import { rank, type RankCompany } from "./score";
import { releaseSlot, takeSlot } from "./slot";
import { lookUpInvestor, reuseBefore } from "./wayin";
import {
  claimCompany,
  companyCounts,
  factsOfRow,
  getSearch,
  readAgainLater,
  saveCheck,
  stagesOf,
  storeRows,
  type CompanyInvestorRow,
  type CompanyRow,
  type SearchRow,
} from "./store";

/** TinySet answers that mean the request was not taken: the search stays queued and is tried again. */
const NOT_TAKEN = new Set([408, 409, 425, 429]);
/** A start is given this long to answer before its dataset is looked for on TinySet. */
const LOST_START_LOOK_AFTER_SECONDS = 30;
/** No dataset on TinySet this long after a start that never answered: none was made, and the search
 *  goes back to the queue to be created again. */
const LOST_START_MINUTES = 5;
/** A dataset counts as a start's own when it was made no earlier than this before it: clocks differ. */
const LOST_START_CLOCK_SLACK_SECONDS = 60;

export type AdvanceResult = { state: string; did: string[] };

const minutesAgo = (now: Date, iso: string | null) => (iso === null ? Infinity : (now.getTime() - Date.parse(iso)) / 60_000);

async function fail(env: Env, s: SearchRow, from: string, reason: string, now: Date): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE searches SET state = 'failed', failed_reason = ?, finished_at = ?,
       cost_basis = COALESCE(cost_basis, CASE WHEN dataset_id IS NULL THEN 'none' ELSE cost_basis END),
       cost_usd = COALESCE(cost_usd, CASE WHEN dataset_id IS NULL THEN 0 ELSE cost_usd END)
     WHERE id = ? AND state = ?`,
  )
    .bind(reason, now.toISOString(), s.id, from)
    .run();
  await releaseSlot(env.DB, s.id);
  return r.meta.changes === 1;
}

// --- queued --------------------------------------------------------------------------------------

async function start(env: Env, s: SearchRow, now: Date, did: string[]): Promise<void> {
  const older = await env.DB.prepare(
    "SELECT 1 FROM searches WHERE state = 'queued' AND (created_at < ?1 OR (created_at = ?1 AND id < ?2)) LIMIT 1",
  )
    .bind(s.created_at, s.id)
    .first();
  if (older !== null) return;
  if (await spendStopReached(env.DB)) {
    if (await fail(env, s, "queued", "spend_stop", now)) did.push("failed:spend_stop");
    return;
  }
  if (!(await takeSlot(env.DB, s.id, now))) return;
  const claimed = await env.DB.prepare("UPDATE searches SET state = 'finding', started_at = ? WHERE id = ? AND state = 'queued'")
    .bind(now.toISOString(), s.id)
    .run();
  if (claimed.meta.changes !== 1) {
    await releaseSlot(env.DB, s.id);
    return;
  }

  let before: number | null = null;
  try {
    before = await readBalance(env);
  } catch {
    // The cost is then counted from the rows.
  }
  // Stored before the create, so a start whose answer is lost still knows the wallet it began with.
  await env.DB.prepare("UPDATE searches SET wallet_before_usd = ? WHERE id = ?").bind(before, s.id).run();
  try {
    const ds = await createDataset(env, JSON.parse(s.spec_json) as DatasetSpec, TARGET_ROWS);
    await takeUp(env.DB, s.id, ds);
    did.push("started");
  } catch (err) {
    const status = err instanceof TinyFishError ? err.status : null;
    if (status !== null && NOT_TAKEN.has(status)) {
      await requeue(env.DB, s.id);
      did.push("start_later");
    } else if (status !== null && status >= 400 && status < 500) {
      await fail(env, { ...s, state: "finding" }, "finding", "start_failed", now);
      did.push("failed:start_failed");
    } else {
      // A server error, a dropped connection, an answer that could not be read or stored: TinySet
      // may have made the dataset and started a paid run. Creating again could pay twice, so the
      // search stays `finding`, counted at its budget, and `find` looks for the dataset by name.
      did.push("start_uncertain");
    }
  }
}

/** Records the dataset a search's run fills. False when the search already has one. */
async function takeUp(db: D1Database, searchId: string, ds: Dataset): Promise<boolean> {
  const r = await db
    .prepare("UPDATE searches SET dataset_id = ?, run_id = ?, dataset_status = ?, row_count = ? WHERE id = ? AND state = 'finding' AND dataset_id IS NULL")
    .bind(ds.id, ds.run?.id ?? null, ds.status, ds.rowCount, searchId)
    .run();
  return r.meta.changes === 1;
}

/** Puts a search with no dataset back in the queue and frees the slot. */
async function requeue(db: D1Database, searchId: string): Promise<boolean> {
  const r = await db
    .prepare("UPDATE searches SET state = 'queued', started_at = NULL, wallet_before_usd = NULL WHERE id = ? AND state = 'finding' AND dataset_id IS NULL")
    .bind(searchId)
    .run();
  if (r.meta.changes !== 1) return false;
  await releaseSlot(db, searchId);
  return true;
}

// --- finding -------------------------------------------------------------------------------------

/**
 * The run has ended: the search moves on to checking and what the run cost is booked, in one write,
 * so a run is never ended without being booked. Then the slot is freed. `billedRows` is the rows
 * TinySet filled, or null when the dataset could not be read to say.
 */
async function endRun(
  env: Env,
  s: SearchRow,
  status: string,
  rowCount: number,
  billedRows: number | null,
  problem: string | null,
  now: Date,
  did: string[],
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  if (s.origin === "import") {
    statements.push(
      env.DB.prepare(
        "UPDATE searches SET state = 'checking', dataset_status = ?, row_count = ?, failed_reason = ?, cost_usd = 0, cost_basis = 'import' WHERE id = ? AND state = 'finding'",
      ).bind(status, rowCount, problem, s.id),
    );
  } else {
    let after: number | null = null;
    try {
      after = await readBalance(env);
    } catch {
      // counted from the rows
    }
    // The wallet's difference is the cost while this key is Backed's alone. A difference above the
    // search's budget means something else spent too, and none means the bill has not landed: then
    // the rows TinySet filled count, at the rate card. When the rows are not known either, the run
    // is counted at nothing if the wallet was read at both ends and has not moved, else at the
    // whole budget.
    const diff = s.wallet_before_usd !== null && after !== null ? Math.round((s.wallet_before_usd - after) * 1e6) / 1e6 : null;
    const byRows = billedRows !== null ? Math.round(billedRows * PRICES.dataset_row * 1e6) / 1e6 : diff === 0 ? 0 : SEARCH_BUDGET_USD;
    const useWallet = diff !== null && diff > 0 && diff <= SEARCH_BUDGET_USD + 1e-9;
    const cost = useWallet ? diff : byRows;
    const at = now.toISOString();
    statements.push(
      env.DB.prepare(
        `UPDATE searches SET state = 'checking', dataset_status = ?, row_count = ?, failed_reason = ?,
           wallet_after_usd = ?, cost_usd = ?, cost_basis = ?, run_booked_at = ? WHERE id = ? AND state = 'finding'`,
      ).bind(status, rowCount, problem, after, cost, useWallet ? "wallet" : "rows", at, s.id),
      // The ledger row is written only with the move above, and once: its id is the search's.
      env.DB.prepare(
        `INSERT OR IGNORE INTO spend (id, kind, amount_usd, ref, at)
         SELECT ?1, 'dataset_run', ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM searches WHERE id = ?3 AND state = 'checking' AND run_booked_at = ?4)`,
      ).bind(`dataset_run:${s.id}`, cost, s.id, at),
    );
  }
  const written = await env.DB.batch(statements);
  if (written[0]?.meta.changes !== 1) return;
  did.push(`run_ended:${status}`);
  await releaseSlot(env.DB, s.id);
}

/**
 * Corrects a booked run cost once, SETTLE_AFTER_MINUTES after it was booked: part of a run can be
 * billed after the wallet was read at its end. The wallet's whole difference since the run started
 * replaces the booked cost when it is larger and within the budget. When a later run has started
 * since, the late bill is in that run's difference, so nothing is changed. Returns the search
 * settled, or null.
 */
export async function settleRunCost(env: Env, now: Date = new Date()): Promise<{ id: string; cost: number } | null> {
  const due = new Date(now.getTime() - SETTLE_AFTER_MINUTES * 60_000).toISOString();
  const s = await env.DB.prepare(
    `UPDATE searches SET cost_settled_at = ? WHERE id = (
       SELECT id FROM searches WHERE origin <> 'import' AND cost_basis IN ('wallet', 'rows') AND cost_settled_at IS NULL
         AND COALESCE(run_booked_at, run_finished_at) <= ? ORDER BY COALESCE(run_booked_at, run_finished_at) LIMIT 1)
     AND cost_settled_at IS NULL RETURNING *`,
  )
    .bind(now.toISOString(), due)
    .first<SearchRow>();
  if (s === null || s.wallet_before_usd === null) return null;
  const booked = s.run_booked_at ?? s.run_finished_at!;
  const later = await env.DB.prepare(
    "SELECT 1 AS later FROM searches WHERE id <> ? AND origin <> 'import' AND dataset_id IS NOT NULL AND started_at > ? LIMIT 1",
  )
    .bind(s.id, booked)
    .first<{ later: number }>();
  if (later !== null) return { id: s.id, cost: s.cost_usd ?? 0 };
  let balance: number;
  try {
    balance = await readBalance(env);
  } catch {
    return { id: s.id, cost: s.cost_usd ?? 0 };
  }
  const total = Math.round((s.wallet_before_usd - balance) * 1e6) / 1e6;
  if (!(total > (s.cost_usd ?? 0) && total <= SEARCH_BUDGET_USD + 1e-9)) return { id: s.id, cost: s.cost_usd ?? 0 };
  await env.DB.batch([
    env.DB.prepare("UPDATE spend SET amount_usd = ? WHERE kind = 'dataset_run' AND ref = ?").bind(total, s.id),
    env.DB.prepare("UPDATE searches SET cost_usd = ?, cost_basis = 'wallet' WHERE id = ?").bind(total, s.id),
  ]);
  return { id: s.id, cost: total };
}

/** Claims a search's next look at TinySet: one caller in DATASET_READ_EVERY_SECONDS gets it. */
async function claimLook(db: D1Database, s: SearchRow, now: Date): Promise<boolean> {
  const due = new Date(now.getTime() - DATASET_READ_EVERY_SECONDS * 1000).toISOString();
  const claim = await db
    .prepare("UPDATE searches SET synced_at = ? WHERE id = ? AND state = 'finding' AND (synced_at IS NULL OR synced_at <= ?)")
    .bind(now.toISOString(), s.id, due)
    .run();
  return claim.meta.changes === 1;
}

/**
 * A search still `finding` with no dataset: its start never answered (a server error, a dropped
 * connection, a Worker that stopped). TinySet is asked for a dataset with this search's name made
 * since the start. One found is this search's own and is taken up. None after LOST_START_MINUTES
 * means none was made, and only then is the search queued to be created again.
 */
async function findLostStart(env: Env, s: SearchRow, now: Date, did: string[]): Promise<void> {
  const age = minutesAgo(now, s.started_at);
  if (age * 60 < LOST_START_LOOK_AFTER_SECONDS || !(await claimLook(env.DB, s, now))) return;
  let made: Dataset | null;
  try {
    const since = new Date(Date.parse(s.started_at ?? "") - LOST_START_CLOCK_SLACK_SECONDS * 1000);
    made = await findDataset(env, (JSON.parse(s.spec_json) as DatasetSpec).name, since);
  } catch (err) {
    if (!(err instanceof TinyFishError)) throw err;
    did.push(`read_error:${err.code}`);
    // TinySet could not say for the whole length of a run: the search ends as one that would not start.
    if (age > SEARCH_TIMEOUT_MINUTES) await endRun(env, s, "unknown", 0, null, "start_failed", now, did);
    return;
  }
  if (made !== null) {
    if (await takeUp(env.DB, s.id, made)) did.push("start_found");
  } else if (age > LOST_START_MINUTES) {
    if (await requeue(env.DB, s.id)) did.push("requeued");
  }
}

async function find(env: Env, s: SearchRow, now: Date, did: string[]): Promise<void> {
  if (s.dataset_id === null) {
    if (s.origin !== "import") await findLostStart(env, s, now, did);
    return;
  }
  if (!(await claimLook(env.DB, s, now))) return;

  try {
    const ds = await getDataset(env, s.dataset_id);
    const { rows, complete } = await listRows(env, s.dataset_id);
    const stored = await storeRows(env.DB, s.id, rows, complete, now);
    await env.DB.prepare(
      `UPDATE searches SET dataset_status = ?, row_count = ?, run_id = COALESCE(?, run_id),
         run_started_at = COALESCE(?, run_started_at), run_finished_at = COALESCE(?, run_finished_at) WHERE id = ?`,
    )
      .bind(ds.status, stored, ds.run?.id ?? null, ds.run?.startedAt ?? null, ds.run?.finishedAt ?? null, s.id)
      .run();
    did.push(`read:${stored}`);

    // The run is over when the dataset says so, or when the run itself has ended. A dataset that
    // reads `empty` has no rows yet: that ends nothing while its run is still going.
    const runOver = ds.run !== null && (ds.run.status === "done" || ds.run.status === "failed" || ds.run.status === "cancelled");
    if (ds.status === "ready" || ds.status === "failed" || ds.status === "cancelled" || runOver) {
      const problem =
        ds.status === "failed" || ds.run?.status === "failed" ? "run_failed" : ds.status === "cancelled" || ds.run?.status === "cancelled" ? "run_cancelled" : null;
      await endRun(env, s, ds.status, stored, ds.rowCount, problem, now, did);
    } else if (minutesAgo(now, s.started_at) > SEARCH_TIMEOUT_MINUTES) {
      if (ds.run !== null) {
        try {
          await cancelRun(env, s.dataset_id, ds.run.id);
        } catch {
          // The run is given up on either way; rows read so far are kept.
        }
      }
      await endRun(env, s, "cancelled", stored, ds.rowCount, "timeout", now, did);
    }
  } catch (err) {
    if (!(err instanceof TinyFishError)) throw err;
    did.push(`read_error:${err.code}`);
    // A dataset that cannot be read is given up on at the same time as one that never finishes, so
    // it cannot hold the slot, a place in the cron or $3 under the stop for good. Its cost is the
    // wallet's difference, else the rows last read.
    if (minutesAgo(now, s.started_at) > SEARCH_TIMEOUT_MINUTES) {
      if (s.run_id !== null) {
        try {
          await cancelRun(env, s.dataset_id, s.run_id);
        } catch {
          // The run is given up on either way; rows read so far are kept.
        }
      }
      const known = s.row_count ?? 0;
      await endRun(env, s, "unknown", known, known > 0 ? known : null, "timeout", now, did);
    }
  }
}

// --- checking ------------------------------------------------------------------------------------

/** A failed read worth trying again: a timeout (ours or TinyFetch's), too many requests, or a
 *  server error. */
function passingFailure(page: { error: string; status?: number }): boolean {
  return /timeout|timed_out/i.test(page.error) || page.status === 429 || (page.status !== undefined && page.status >= 500);
}

/** Checks companies one at a time: as many as are refused without a read, plus up to
 *  CHECKS_PER_ADVANCE reads, while the call is inside its time budget. */
async function check(env: Env, s: SearchRow, now: Date, startedMs: number, did: string[]): Promise<void> {
  const stages = stagesOf(s);
  let reads = 0;
  while (reads < CHECKS_PER_ADVANCE && Date.now() - startedMs < ADVANCE_BUDGET_MS) {
    const c: CompanyRow | null = await claimCompany(env.DB, s.id, now);
    if (c === null) return;
    const facts = factsOfRow(c);
    if (precheck(facts, s.window_start, stages) !== null) {
      await saveCheck(env.DB, c, checkCompany(facts, s.window_start, stages, null), { pageUrl: null, readAt: null }, now);
      did.push(`set_apart:${c.name}`);
      continue;
    }
    reads++;
    const page = await fetchPage(env, facts.announcementUrl!);
    // A read that ran out of time or met a busy service may work later: the company goes back in
    // line, up to READ_ATTEMPTS reads in all. A page that was read, or refused for good, is final.
    if (!page.ok && passingFailure(page) && c.read_attempts + 1 < READ_ATTEMPTS) {
      await readAgainLater(env.DB, c, new Date(now.getTime() + READ_RETRY_AFTER_SECONDS * 1000));
      did.push(`read_again:${c.name}`);
      continue;
    }
    const readAt = new Date().toISOString();
    const result = checkCompany(facts, s.window_start, stages, page.ok ? { text: page.text, title: page.title } : null);
    await saveCheck(env.DB, c, result, { pageUrl: page.ok ? page.finalUrl : facts.announcementUrl, readAt }, now);
    did.push(`${result.status}:${c.name}`);
  }
}

/** Every company checked: on to ranking, or failed. */
async function finishChecking(env: Env, s: SearchRow, now: Date, did: string[]): Promise<void> {
  const counts = await companyCounts(env.DB, s.id);
  if (counts.pending > 0) return;
  // A run that ended badly says so, even with no company found: "none found" is for a run that finished.
  if (s.failed_reason !== null && counts.proved < MIN_PROVED_TO_RANK) {
    if (await fail(env, s, "checking", s.failed_reason, now)) did.push(`failed:${s.failed_reason}`);
    return;
  }
  if (counts.found === 0) {
    if (await fail(env, s, "checking", "none_found", now)) did.push("failed:none_found");
    return;
  }
  const r = await env.DB.prepare(
    `UPDATE searches SET state = 'ranking' WHERE id = ? AND state = 'checking'
       AND NOT EXISTS (SELECT 1 FROM companies WHERE search_id = ? AND removed = 0 AND state IN ('unchecked', 'checking'))`,
  )
    .bind(s.id, s.id)
    .run();
  if (r.meta.changes === 1) did.push("ranking");
}

// --- ranking -------------------------------------------------------------------------------------

/** The proved companies of a search, as the score reads them. */
export async function rankInput(db: D1Database, searchId: string): Promise<RankCompany[]> {
  const { results: companies } = await db
    .prepare("SELECT * FROM companies WHERE search_id = ? AND removed = 0 AND state = 'proved'")
    .bind(searchId)
    .all<CompanyRow>();
  const { results: investors } = await db
    .prepare("SELECT ci.* FROM company_investors ci JOIN companies c ON c.id = ci.company_id WHERE c.search_id = ? AND c.removed = 0 AND c.state = 'proved'")
    .bind(searchId)
    .all<CompanyInvestorRow>();
  return companies
    .filter((c) => c.announced_on !== null)
    .map((c) => ({
      id: c.id,
      name: c.name,
      stage: rankStage(c),
      country: c.country,
      amountUsd: c.amount_usd,
      announcedOn: c.announced_on!,
      leadInvestorWebsite: c.lead_investor_website,
      investors: investors
        .filter((i) => i.company_id === c.id)
        .map((i) => ({ key: i.investor_key, name: i.name, role: i.role, named: i.named === 1 })),
    }));
}

const rankStage = (c: CompanyRow) => stageOfRound(c.round_type)!;

/** Scores the investors and stores the order and every part, once: the batch ends by setting
 *  `ranked_at`, and two at once write the same rows. */
async function rankSearch(env: Env, s: SearchRow, now: Date, did: string[]): Promise<void> {
  const { statements, ranked } = await rankingStatements(env, s, now);
  statements.push(
    env.DB.prepare("UPDATE searches SET ranked_at = ? WHERE id = ? AND state = 'ranking' AND ranked_at IS NULL").bind(now.toISOString(), s.id),
  );
  const results = await env.DB.batch(statements);
  if ((results[results.length - 1]?.meta.changes ?? 0) === 1) did.push(`ranked:${ranked}`);
}

/**
 * Ranks a ready search again in place, after a watch added a company: the same score, the same
 * rows, and the page stays ready throughout. Then the way in for any investor new to the top, as
 * far as the time allows; the cron looks up the rest. Returns how many investors are ranked.
 */
export async function rankAgain(env: Env, searchId: string, now: Date = new Date()): Promise<number> {
  const startedMs = Date.now();
  const s = await getSearch(env.DB, searchId);
  if (s === null || s.state !== "ready") return 0;
  const { statements, ranked } = await rankingStatements(env, s, now);
  statements.push(env.DB.prepare("UPDATE searches SET ranked_at = ? WHERE id = ? AND state = 'ready'").bind(now.toISOString(), s.id));
  await env.DB.batch(statements);
  await lookUpTop(env, s, now, startedMs, []);
  return ranked;
}

/** The way in for a ready search's top investors still to look up, within the time budget. */
export async function lookUpWaysInLater(env: Env, searchId: string, now: Date = new Date()): Promise<void> {
  const s = await getSearch(env.DB, searchId);
  if (s !== null && s.state === "ready") await lookUpTop(env, s, now, Date.now(), []);
}

/** The statements that store a search's ranking, without the last one that marks it ranked, and
 *  how many investors it ranks. */
async function rankingStatements(env: Env, s: SearchRow, now: Date): Promise<{ statements: D1PreparedStatement[]; ranked: number }> {
  const ranked = rank(await rankInput(env.DB, s.id), { stage: s.stage, country: s.country }, now);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM ranking WHERE search_id = ?").bind(s.id),
    env.DB.prepare("UPDATE company_investors SET points = NULL, parts_json = NULL WHERE search_id = ?").bind(s.id),
  ];
  for (const r of ranked) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO ranking (search_id, investor_key, position, name, slug, score, companies, led, stages_json, min_round_usd, max_round_usd, site_hint)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(s.id, r.key, r.position, r.name, r.slug, r.score, r.companies, r.led, JSON.stringify(r.stages), r.minRoundUsd, r.maxRoundUsd, r.siteHint),
    );
    for (const d of r.deals) {
      statements.push(
        env.DB.prepare("UPDATE company_investors SET points = ?, parts_json = ? WHERE company_id = ? AND investor_key = ?").bind(
          d.points,
          JSON.stringify(d.parts),
          d.companyId,
          r.key,
        ),
      );
    }
  }
  return { statements, ranked: ranked.length };
}

/** The top investors whose way in is not looked up (or is older than the reuse window). */
async function waysInToDo(env: Env, s: SearchRow, now: Date): Promise<{ investor_key: string; site_hint: string | null }[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.investor_key, r.site_hint FROM ranking r LEFT JOIN investors i ON i.investor_key = r.investor_key
     WHERE r.search_id = ? AND r.position <= ?
       AND (i.investor_key IS NULL OR i.state <> 'done' OR i.looked_up_at < ?)
     ORDER BY r.position`,
  )
    .bind(s.id, WAY_IN_TOP, reuseBefore(now))
    .all<{ investor_key: string; site_hint: string | null }>();
  return results;
}

/**
 * The way in for the top WAY_IN_TOP investors, a few per call while the call is inside its time
 * budget. Each lookup is stored per investor and reused by every search for 30 days. When none is
 * left to do, the search is ready.
 */
async function waysIn(env: Env, s: SearchRow, now: Date, startedMs: number, did: string[]): Promise<void> {
  if (!(await lookUpTop(env, s, now, startedMs, did))) return;
  const r = await env.DB.prepare("UPDATE searches SET state = 'ready', finished_at = ? WHERE id = ? AND state = 'ranking' AND ranked_at IS NOT NULL")
    .bind(now.toISOString(), s.id)
    .run();
  if (r.meta.changes === 1) did.push("ready");
}

/** Looks up the way in for the top investors still to do, a few per call. True when none is left. */
async function lookUpTop(env: Env, s: SearchRow, now: Date, startedMs: number, did: string[]): Promise<boolean> {
  const todo = await waysInToDo(env, s, now);
  if (todo.length > 0) {
    await env.DB.batch(
      todo.map((t) =>
        env.DB.prepare("INSERT INTO investors (investor_key, name, state) SELECT investor_key, name, 'pending' FROM ranking WHERE search_id = ? AND investor_key = ? ON CONFLICT (investor_key) DO NOTHING").bind(
          s.id,
          t.investor_key,
        ),
      ),
    );
    const staleBefore = new Date(now.getTime() - CHECK_CLAIM_STALE_MINUTES * 60_000).toISOString();
    let looked = 0;
    for (const t of todo) {
      if (looked >= WAY_INS_PER_ADVANCE || Date.now() - startedMs >= ADVANCE_BUDGET_MS) return false;
      if (await lookUpInvestor(env, t.investor_key, t.site_hint, now, staleBefore)) {
        looked++;
        did.push(`way_in:${t.investor_key}`);
      }
    }
    if ((await waysInToDo(env, s, now)).length > 0) return false;
  }
  return true;
}

// --- the whole step ------------------------------------------------------------------------------

/** Moves one search forward. Returns its state afterwards and what was done (for the logs and tests). */
export async function advance(env: Env, searchId: string, now: Date = new Date()): Promise<AdvanceResult> {
  const startedMs = Date.now();
  const did: string[] = [];
  let s = await getSearch(env.DB, searchId);
  if (s === null) return { state: "missing", did };

  if (s.state === "queued") {
    await start(env, s, now, did);
    return { state: (await getSearch(env.DB, searchId))?.state ?? "missing", did };
  }
  if (s.state === "finding") {
    await find(env, s, now, did);
    s = (await getSearch(env.DB, searchId))!;
  }
  if (s.state === "finding" || s.state === "checking") {
    await check(env, s, now, startedMs, did);
    s = (await getSearch(env.DB, searchId))!;
  }
  if (s.state === "checking") {
    await finishChecking(env, s, now, did);
    s = (await getSearch(env.DB, searchId))!;
  }
  if (s.state === "ranking" && s.ranked_at === null) {
    await rankSearch(env, s, now, did);
    s = (await getSearch(env.DB, searchId))!;
  }
  if (s.state === "ranking" && s.ranked_at !== null) {
    await waysIn(env, s, now, startedMs, did);
    s = (await getSearch(env.DB, searchId))!;
  }
  return { state: s.state, did };
}

/** For a page or an API read: advance after the response, never in its way, and never let a
 *  failure reach the visitor. */
export function advanceLater(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, searchId: string): void {
  ctx.waitUntil(
    advance(env, searchId).catch(() => {
      console.error("advance failed");
    }),
  );
}
