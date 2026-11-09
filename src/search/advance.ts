// The state machine of a search. `advance(searchId)` moves it forward a little each time it is
// called and is safe to call twice at once: every step claims its work in one statement first.
//
//   queued   -> finding   the run slot is free and this is the oldest queued search: the wallet is
//                         read and the TinySet dataset created.
//   finding  -> checking  the dataset is read (at most every DATASET_READ_EVERY_SECONDS) and its rows
//                         stored; when the run ends, its cost is booked and the slot freed.
//   finding, checking     companies are checked against their announcements, a few per call.
//   checking -> ranking   every company is checked.
//   ranking  -> ready     the investors are scored and the order stored.
//   any      -> failed    TinySet would not start, found nothing, or ended badly with fewer than
//                         MIN_PROVED_TO_RANK companies proved.
import {
  ADVANCE_BUDGET_MS,
  CHECKS_PER_ADVANCE,
  DATASET_READ_EVERY_SECONDS,
  MIN_PROVED_TO_RANK,
  PRICES,
  SEARCH_TIMEOUT_MINUTES,
  TARGET_ROWS,
} from "../core/limits";
import { recordSpend } from "../core/spend";
import { stageOfRound } from "../core/stages";
import type { Env } from "../env";
import { TinyFishError } from "../tinyfish/client";
import { cancelRun, createDataset, getDataset, listRows, type DatasetSpec } from "../tinyfish/datasets";
import { fetchPage } from "../tinyfish/fetch";
import { readBalance } from "../tinyfish/wallet";
import { spendStopReached } from "./money";
import { checkCompany, precheck } from "./proof";
import { rank, type RankCompany } from "./score";
import { releaseSlot, takeSlot } from "./slot";
import {
  claimCompany,
  companyCounts,
  factsOfRow,
  getSearch,
  saveCheck,
  stagesOf,
  storeRows,
  type CompanyInvestorRow,
  type CompanyRow,
  type SearchRow,
} from "./store";

/** A search still `finding` without a dataset this long after it was claimed (the Worker died
 *  between the claim and the create) goes back to the queue. */
const LOST_START_MINUTES = 5;
/** TinySet answers that mean "not now": the search stays queued and is tried again. */
const RETRY_LATER = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

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
  try {
    const ds = await createDataset(env, JSON.parse(s.spec_json) as DatasetSpec, TARGET_ROWS);
    await env.DB.prepare(
      "UPDATE searches SET dataset_id = ?, run_id = ?, dataset_status = ?, row_count = ?, wallet_before_usd = ? WHERE id = ?",
    )
      .bind(ds.id, ds.run?.id ?? null, ds.status, ds.rowCount, before, s.id)
      .run();
    did.push("started");
  } catch (err) {
    const retry = !(err instanceof TinyFishError) || RETRY_LATER.has(err.status);
    if (retry) {
      await env.DB.prepare("UPDATE searches SET state = 'queued', started_at = NULL WHERE id = ? AND state = 'finding'").bind(s.id).run();
      await releaseSlot(env.DB, s.id);
      did.push("start_later");
    } else {
      await fail(env, { ...s, state: "finding" }, "finding", "start_failed", now);
      did.push("failed:start_failed");
    }
  }
}

// --- finding -------------------------------------------------------------------------------------

/** The run has ended: book what it cost (once), free the slot, move on to checking. */
async function endRun(env: Env, s: SearchRow, status: string, rowCount: number, problem: string | null, now: Date, did: string[]): Promise<void> {
  const moved = await env.DB.prepare(
    "UPDATE searches SET state = 'checking', dataset_status = ?, row_count = ?, failed_reason = ? WHERE id = ? AND state = 'finding'",
  )
    .bind(status, rowCount, problem, s.id)
    .run();
  if (moved.meta.changes !== 1) return;
  did.push(`run_ended:${status}`);

  if (s.origin === "import") {
    await env.DB.prepare("UPDATE searches SET cost_usd = 0, cost_basis = 'import' WHERE id = ?").bind(s.id).run();
  } else {
    let after: number | null = null;
    try {
      after = await readBalance(env);
    } catch {
      // counted from the rows
    }
    // The wallet's difference is the cost while this key is Backed's alone. A difference above what
    // the rows could cost at the rate card means something else spent too: then the rows count.
    const byRows = Math.round(rowCount * PRICES.dataset_row * 1e6) / 1e6;
    const diff = s.wallet_before_usd !== null && after !== null ? Math.round((s.wallet_before_usd - after) * 1e6) / 1e6 : null;
    const useWallet = diff !== null && diff > 0 && diff <= byRows + 1e-9;
    const cost = useWallet ? diff : byRows;
    await recordSpend(env.DB, "dataset_run", cost, s.id);
    await env.DB.prepare("UPDATE searches SET wallet_after_usd = ?, cost_usd = ?, cost_basis = ? WHERE id = ?")
      .bind(after, cost, useWallet ? "wallet" : "rows", s.id)
      .run();
  }
  await releaseSlot(env.DB, s.id);
}

async function find(env: Env, s: SearchRow, now: Date, did: string[]): Promise<void> {
  if (s.dataset_id === null) {
    if (s.origin !== "import" && minutesAgo(now, s.started_at) > LOST_START_MINUTES) {
      await env.DB.prepare("UPDATE searches SET state = 'queued', started_at = NULL WHERE id = ? AND state = 'finding' AND dataset_id IS NULL")
        .bind(s.id)
        .run();
      await releaseSlot(env.DB, s.id);
      did.push("requeued");
    }
    return;
  }
  const due = new Date(now.getTime() - DATASET_READ_EVERY_SECONDS * 1000).toISOString();
  const claim = await env.DB.prepare(
    "UPDATE searches SET synced_at = ? WHERE id = ? AND state = 'finding' AND (synced_at IS NULL OR synced_at <= ?)",
  )
    .bind(now.toISOString(), s.id, due)
    .run();
  if (claim.meta.changes !== 1) return;

  try {
    const ds = await getDataset(env, s.dataset_id);
    const { rows, complete } = await listRows(env, s.dataset_id);
    const stored = await storeRows(env.DB, s.id, rows, complete, now);
    await env.DB.prepare("UPDATE searches SET dataset_status = ?, row_count = ?, run_id = COALESCE(?, run_id) WHERE id = ?")
      .bind(ds.status, stored, ds.run?.id ?? null, s.id)
      .run();
    did.push(`read:${stored}`);

    const runOver = ds.run !== null && (ds.run.status === "done" || ds.run.status === "failed" || ds.run.status === "cancelled");
    if (ds.status === "ready" || ds.status === "empty" || ds.status === "failed" || ds.status === "cancelled" || (ds.status !== "populating" && runOver)) {
      const problem =
        ds.status === "failed" || ds.run?.status === "failed" ? "run_failed" : ds.status === "cancelled" || ds.run?.status === "cancelled" ? "run_cancelled" : null;
      await endRun(env, s, ds.status, stored, problem, now, did);
    } else if (minutesAgo(now, s.started_at) > SEARCH_TIMEOUT_MINUTES) {
      if (ds.run !== null) {
        try {
          await cancelRun(env, s.dataset_id, ds.run.id);
        } catch {
          // The run is given up on either way; rows read so far are kept.
        }
      }
      await endRun(env, s, "cancelled", stored, "timeout", now, did);
    }
  } catch (err) {
    if (!(err instanceof TinyFishError)) throw err;
    did.push(`read_error:${err.code}`);
  }
}

// --- checking ------------------------------------------------------------------------------------

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
  if (counts.found === 0) {
    if (await fail(env, s, "checking", "none_found", now)) did.push("failed:none_found");
    return;
  }
  if (s.failed_reason !== null && counts.proved < MIN_PROVED_TO_RANK) {
    if (await fail(env, s, "checking", s.failed_reason, now)) did.push(`failed:${s.failed_reason}`);
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

/** Scores the investors and stores the order and every part. Safe to run twice: it writes the
 *  same rows. */
async function rankSearch(env: Env, s: SearchRow, now: Date, did: string[]): Promise<void> {
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
  statements.push(
    env.DB.prepare("UPDATE searches SET state = 'ready', finished_at = ? WHERE id = ? AND state = 'ranking'").bind(now.toISOString(), s.id),
  );
  const results = await env.DB.batch(statements);
  if ((results[results.length - 1]?.meta.changes ?? 0) === 1) did.push(`ready:${ranked.length}`);
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
  if (s.state === "ranking") {
    await rankSearch(env, s, now, did);
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
