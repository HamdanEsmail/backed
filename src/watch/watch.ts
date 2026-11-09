// Watching a saved search (spec section 8). A demo search can be watched by one TinyFish Topic
// Monitor that runs "<key words> raises seed funding" twice a day. Each new result it reports is
// read with Fetch, read as one company's facts, and put through the same proof check as a TinySet
// row. Only a company the check proves is added ("found by the watch"), then the search is ranked
// again in place. Backed only ever deletes the Monitors whose ids it stored here.
import {
  MAX_WATCHES,
  PRICES,
  WATCH_MAX_DAYS,
  WATCH_READS_PER_CALL,
  WATCH_RECENCY_MINUTES,
  WATCH_RESULTS_PER_RUN,
  WATCH_SCHEDULE_CRON,
  ADVANCE_BUDGET_MS,
  CHECK_CLAIM_STALE_MINUTES,
} from "../core/limits";
import { nameKey } from "../core/names";
import { recordSpend } from "../core/spend";
import { stageInText, type Stage } from "../core/stages";
import type { Env } from "../env";
import { lookUpWaysInLater, rankAgain } from "../search/advance";
import { checkKeyOf } from "../search/facts";
import { paidWorkStopped } from "../search/money";
import { checkCompany } from "../search/proof";
import { getSearch, saveCheck, stagesOf, type CompanyRow } from "../search/store";
import { fetchPage } from "../tinyfish/fetch";
import { createTopicMonitor, deleteMonitor } from "../tinyfish/monitor";
import { factsFromAnnouncement } from "./announcement";

export type WatchRow = {
  search_id: string;
  monitor_id: string;
  query: string;
  created_at: string;
  until: string;
  last_run_at: string | null;
  ended_at: string | null;
  ended_reason: string | null;
};

const MONITOR_PURPOSE = "find news announcements of startups raising a funding round";

/** The query a watch runs: "<key words> raises seed funding" (Series A or B for those stages). */
export function watchQuery(keyWords: string, stage: Stage): string {
  const round = stage === "pre-seed" || stage === "seed" ? "seed" : stageInText(stage);
  return `${keyWords.replace(/\s+/g, " ").trim()} raises ${round} funding`;
}

export function getWatch(db: D1Database, searchId: string): Promise<WatchRow | null> {
  return db.prepare("SELECT * FROM watches WHERE search_id = ?").bind(searchId).first<WatchRow>();
}

export type StartWatch =
  | { ok: true; watch: WatchRow }
  | { ok: false; status: 400 | 404 | 409 | 503; error: string; message: string };

/**
 * Watches a ready demo search until `until` (YYYY-MM-DD, within WATCH_MAX_DAYS). Refused for a public
 * search, past MAX_WATCHES, or once spending has reached the stop. Creating the Monitor runs it once,
 * which is booked. A Monitor that cannot be stored is deleted again, so none runs that Backed holds
 * no id for.
 */
export async function startWatch(env: Env, searchId: string, keyWords: string, until: string, now: Date): Promise<StartWatch> {
  const s = await getSearch(env.DB, searchId);
  if (s === null) return { ok: false, status: 404, error: "not_found", message: "No such search." };
  if (s.demo === null) return { ok: false, status: 400, error: "not_a_demo", message: "Only the demo searches are watched." };
  if (s.state !== "ready") return { ok: false, status: 409, error: "not_ready", message: "Only a ready search is watched." };
  const today = now.toISOString().slice(0, 10);
  const last = new Date(now.getTime() + WATCH_MAX_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < today || until > last) {
    return { ok: false, status: 400, error: "invalid", message: `until is a date from today to ${last}.` };
  }
  const words = keyWords.replace(/\s+/g, " ").trim();
  if (words.length < 3 || words.length > 80) return { ok: false, status: 400, error: "invalid", message: "key_words is 3 to 80 characters." };
  const existing = await getWatch(env.DB, searchId);
  if (existing !== null && existing.ended_at === null) return { ok: false, status: 409, error: "already_watched", message: "This search is already watched." };
  const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM watches WHERE ended_at IS NULL").first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_WATCHES) return { ok: false, status: 409, error: "too_many_watches", message: `At most ${MAX_WATCHES} searches are watched.` };
  if (await paidWorkStopped(env.DB)) return { ok: false, status: 503, error: "spend_stop", message: "Paid work has stopped: this demo has spent its budget." };

  const query = watchQuery(words, s.stage);
  const { monitorId } = await createTopicMonitor(env, {
    query,
    name: `backed:${s.id}`,
    scheduleCron: WATCH_SCHEDULE_CRON,
    purpose: MONITOR_PURPOSE,
    webhookUrl: `${env.PUBLIC_BASE_URL.replace(/\/+$/, "")}/hooks/monitor/${env.WEBHOOK_SECRET}`,
    recencyMinutes: WATCH_RECENCY_MINUTES,
    resultLimit: WATCH_RESULTS_PER_RUN,
  });
  const at = now.toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO watches (search_id, monitor_id, query, created_at, until) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (search_id) DO UPDATE SET monitor_id = ?2, query = ?3, created_at = ?4, until = ?5, last_run_at = NULL, ended_at = NULL, ended_reason = NULL`,
    )
      .bind(s.id, monitorId, query, at, until)
      .run();
  } catch (err) {
    try {
      await deleteMonitor(env, monitorId);
    } catch {
      // The write's own failure is the one reported.
    }
    throw err;
  }
  return { ok: true, watch: (await getWatch(env.DB, s.id))! };
}

/** Deletes the watch's own Monitor, by the id stored for it, and ends the watch. False when the
 *  search is not watched. */
export async function stopWatch(env: Env, searchId: string, reason: "admin" | "until" | "spend_stop", now: Date): Promise<boolean> {
  const w = await getWatch(env.DB, searchId);
  if (w === null || w.ended_at !== null) return false;
  await deleteMonitor(env, w.monitor_id);
  await env.DB.prepare("UPDATE watches SET ended_at = ?, ended_reason = ? WHERE search_id = ? AND ended_at IS NULL")
    .bind(now.toISOString(), reason, searchId)
    .run();
  return true;
}

// --- A Monitor run -------------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export type MonitorRun = {
  monitorId: string | null;
  runId: string | null;
  results: { url: string; title: string | null; date: string | null }[];
};

/**
 * The parts of a Topic Monitor payload Backed reads, from the top level or a nested `run`. The ids
 * come in more than one form: `search_monitor_id` or `monitor_id`, else inside `request_id`
 * ("search-monitor:<id>:run:<id>"); the run is `id`, else the run part of `request_id`. The results
 * are those at `new_result_positions` (0-based) when the payload gives them, else every result:
 * one already known adds nothing.
 */
export function readMonitorRun(data: unknown): MonitorRun {
  const layers = [data, isRecord(data) ? data.run : undefined].filter(isRecord);
  const pick = (key: string): unknown => {
    for (const layer of layers) if (layer[key] !== undefined && layer[key] !== null) return layer[key];
    return undefined;
  };
  const requestId = str(pick("request_id"));
  const fromRequest = requestId === null ? null : /^search-monitor:([^:]+):run:([^:]+)$/.exec(requestId);
  const monitorId = str(pick("search_monitor_id")) ?? str(pick("monitor_id")) ?? fromRequest?.[1] ?? null;
  const runId = str(pick("id")) ?? str(pick("run_id")) ?? fromRequest?.[2] ?? null;

  const all = pick("results");
  const positions = pick("new_result_positions");
  const items = !Array.isArray(all)
    ? []
    : Array.isArray(positions)
      ? positions.filter((p): p is number => typeof p === "number" && Number.isInteger(p)).map((p) => all[p])
      : all;
  const results: MonitorRun["results"] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const url = str(item.url);
    if (url === null || !/^https?:\/\//i.test(url) || url.length > 2000 || results.some((r) => r.url === url)) continue;
    results.push({ url, title: str(item.title)?.slice(0, 300) ?? null, date: str(item.date)?.slice(0, 60) ?? null });
  }
  return { monitorId, runId, results };
}

const RUN_ID = /^[A-Za-z0-9:_-]{1,200}$/;

export type RunReceived =
  | { status: 400 | 404; body: { error: string } }
  | { status: 200; body: { ok: true; duplicate?: true; ignored?: string; new_results?: number }; searchId?: string };

/**
 * One Monitor run, after the secret was checked. The run is booked once at its price (a run
 * delivered twice changes nothing the second time); its results are stored to be read, each address
 * once per search.
 */
export async function receiveRun(env: Env, data: unknown, now: Date): Promise<RunReceived> {
  const run = readMonitorRun(data);
  if (run.monitorId === null || run.runId === null || !RUN_ID.test(run.runId)) return { status: 400, body: { error: "invalid_payload" } };
  const w = await env.DB.prepare("SELECT * FROM watches WHERE monitor_id = ?").bind(run.monitorId).first<WatchRow>();
  if (w === null) return { status: 404, body: { error: "unknown_monitor" } };

  const first = await env.DB.prepare("INSERT OR IGNORE INTO watch_runs (run_id, monitor_id, received_at, results) VALUES (?, ?, ?, ?)")
    .bind(run.runId, run.monitorId, now.toISOString(), run.results.length)
    .run();
  if (first.meta.changes !== 1) return { status: 200, body: { ok: true, duplicate: true } };
  // The run was billed whatever came of it.
  await recordSpend(env.DB, "monitor_check", PRICES.monitor_check, run.monitorId);
  if (w.ended_at !== null) return { status: 200, body: { ok: true, ignored: "watch_ended" } };

  const at = now.toISOString();
  const statements = [env.DB.prepare("UPDATE watches SET last_run_at = ? WHERE search_id = ?").bind(at, w.search_id)];
  for (const r of run.results) {
    statements.push(
      env.DB.prepare("INSERT OR IGNORE INTO watch_hits (search_id, url, title, date_text, run_id, seen_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
        w.search_id,
        r.url,
        r.title,
        r.date,
        run.runId,
        at,
      ),
    );
  }
  const written = await env.DB.batch(statements);
  const added = written.slice(1).filter((r) => r.meta.changes === 1).length;
  return { status: 200, body: { ok: true, new_results: added }, searchId: w.search_id };
}

// --- Reading a new result ------------------------------------------------------------------------

type HitRow = { search_id: string; url: string; title: string | null; date_text: string | null; claimed_at: string | null };

async function finishHit(db: D1Database, hit: HitRow, state: "added" | "known" | "refused", reason: string | null, companyId: string | null, now: Date) {
  await db
    .prepare("UPDATE watch_hits SET state = ?, reason = ?, company_id = ?, done_at = ? WHERE search_id = ? AND url = ? AND claimed_at = ?")
    .bind(state, reason, companyId, now.toISOString(), hit.search_id, hit.url, hit.claimed_at)
    .run();
}

/** What became of one result: "added", "known" or a reason it was refused. */
export async function readHit(env: Env, hit: HitRow, now: Date): Promise<string> {
  const s = await getSearch(env.DB, hit.search_id);
  if (s === null || s.state !== "ready") {
    await finishHit(env.DB, hit, "refused", "search_not_ready", null, now);
    return "search_not_ready";
  }
  const sameUrl = await env.DB.prepare("SELECT 1 FROM companies WHERE search_id = ?1 AND removed = 0 AND (announcement_url = ?2 OR page_url = ?2) LIMIT 1")
    .bind(s.id, hit.url)
    .first();
  if (sameUrl !== null) {
    await finishHit(env.DB, hit, "known", null, null, now);
    return "known";
  }

  const page = await fetchPage(env, hit.url);
  if (!page.ok || page.text.trim() === "") {
    await finishHit(env.DB, hit, "refused", "unreadable", null, now);
    return "unreadable";
  }
  const facts = factsFromAnnouncement({ url: hit.url, title: hit.title, date: hit.date_text }, { text: page.text, title: page.title }, now);
  if (facts === null) {
    await finishHit(env.DB, hit, "refused", "not_an_announcement", null, now);
    return "not_an_announcement";
  }
  const { results: names } = await env.DB.prepare("SELECT name FROM companies WHERE search_id = ? AND removed = 0").bind(s.id).all<{ name: string }>();
  const key = nameKey(facts.name);
  if (names.some((c) => nameKey(c.name) === key)) {
    await finishHit(env.DB, hit, "known", null, null, now);
    return "known";
  }

  // The same proof check as a TinySet row. Only a proved company is added.
  const result = checkCompany(facts, s.window_start, stagesOf(s), { text: page.text, title: page.title ?? hit.title });
  if (result.status !== "proved") {
    await finishHit(env.DB, hit, "refused", result.reason, null, now);
    return result.reason;
  }
  const id = crypto.randomUUID();
  const claim = `${now.toISOString()}#${crypto.randomUUID()}`;
  const at = now.toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO companies (id, search_id, row_id, source, removed, name, website, country, description, round_type, amount_usd,
       announced_on, lead_investor, lead_investor_website, other_investors, lead_partner, founders, announcement_url, check_key,
       state, claimed_at, found_at, updated_at)
     VALUES (?1, ?2, ?3, 'watch', 0, ?4, NULL, NULL, NULL, ?5, ?6, ?7, ?8, NULL, ?9, NULL, NULL, ?10, ?11, 'checking', ?12, ?13, ?13)
     ON CONFLICT (search_id, row_id) DO NOTHING RETURNING *`,
  )
    .bind(id, s.id, `watch:${hit.url}`, facts.name, facts.roundType, facts.amountUsd, facts.announcedOn, facts.leadInvestor, facts.otherInvestors, facts.announcementUrl, checkKeyOf(facts), claim, at)
    .first<CompanyRow>();
  if (row === null) {
    await finishHit(env.DB, hit, "known", null, null, now);
    return "known";
  }
  await saveCheck(env.DB, row, result, { pageUrl: page.finalUrl, readAt: at }, now);
  await finishHit(env.DB, hit, "added", null, id, now);
  await rankAgain(env, s.id, now);
  return "added";
}

/** Claims the next result waiting to be read, or one whose read must have died. */
function claimHit(db: D1Database, now: Date): Promise<HitRow | null> {
  const staleBefore = new Date(now.getTime() - CHECK_CLAIM_STALE_MINUTES * 60_000).toISOString();
  return db
    .prepare(
      `UPDATE watch_hits SET state = 'checking', claimed_at = ?1
       WHERE rowid = (SELECT rowid FROM watch_hits WHERE state = 'new' OR (state = 'checking' AND claimed_at < ?2) ORDER BY seen_at, url LIMIT 1)
       RETURNING search_id, url, title, date_text, claimed_at`,
    )
    .bind(`${now.toISOString()}#${crypto.randomUUID()}`, staleBefore)
    .first<HitRow>();
}

/** Reads waiting results, up to WATCH_READS_PER_CALL, while the call is inside its time budget. */
export async function readHits(env: Env, now: Date = new Date()): Promise<string[]> {
  const startedMs = Date.now();
  const did: string[] = [];
  while (did.length < WATCH_READS_PER_CALL && Date.now() - startedMs < ADVANCE_BUDGET_MS) {
    const hit = await claimHit(env.DB, now);
    if (hit === null) break;
    did.push(await readHit(env, hit, now));
  }
  return did;
}

/**
 * The watch's part of the minute's cron: end every watch past its last day, or all of them once
 * spending has reached the stop (their Monitors deleted by the ids stored here); read waiting
 * results; look up the way in for investors a watch brought into a top ten.
 */
export async function watchCron(env: Env, now: Date = new Date()): Promise<{ ended: number; read: number }> {
  const { results: active } = await env.DB.prepare("SELECT * FROM watches WHERE ended_at IS NULL").all<WatchRow>();
  let ended = 0;
  if (active.length > 0) {
    const stop = await paidWorkStopped(env.DB);
    const today = now.toISOString().slice(0, 10);
    for (const w of active) {
      if (!stop && w.until >= today) continue;
      if (await stopWatch(env, w.search_id, stop ? "spend_stop" : "until", now)) ended++;
    }
  }
  const read = await readHits(env, now);
  for (const w of active) await lookUpWaysInLater(env, w.search_id, now);
  return { ended, read: read.length };
}
