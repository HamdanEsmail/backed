// Starting a search: the 7-day reuse, the public limits, the spend stop, and adopting a dataset
// TinySet already filled. A new search is stored `queued`; `advance` starts it.
import {
  PUBLIC_SEARCH_TTL_DAYS,
  PUBLIC_SEARCHES_PER_DAY,
  PUBLIC_SEARCHES_PER_VISITOR_PER_DAY,
  REUSE_DAYS,
} from "../core/limits";
import { ALL, countIfUnder, uncount } from "../db/publicUse";
import type { Env } from "../env";
import { getDataset } from "../tinyfish/datasets";
import { spendStopReached } from "./money";
import { buildSpec, reuseKey, type SearchInput } from "./spec";
import type { SearchState } from "./store";
import { DAILY_LIMIT, SPEND_STOP, VISITOR_LIMIT } from "./words";

const DAY_MS = 86_400_000;

export type StartResult =
  | { ok: true; id: string; state: SearchState; cached: boolean }
  | { ok: false; error: "spend_stop" | "daily_limit" | "visitor_limit"; message: string };

/** A short id for a search's address: 12 characters from a-z and 0-9. */
export function newSearchId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

/** The stored search for the same line, stage and country from the last REUSE_DAYS days that did
 *  not fail, or null. */
export async function findReusable(db: D1Database, input: SearchInput, now: Date): Promise<{ id: string; state: SearchState } | null> {
  const since = new Date(now.getTime() - REUSE_DAYS * DAY_MS).toISOString();
  return db
    .prepare("SELECT id, state FROM searches WHERE reuse_key = ? AND created_at >= ? AND state <> 'failed' ORDER BY created_at DESC LIMIT 1")
    .bind(reuseKey(input), since)
    .first<{ id: string; state: SearchState }>();
}

async function insertSearch(
  db: D1Database,
  input: SearchInput,
  origin: "public" | "admin",
  demo: number | null,
  now: Date,
): Promise<string> {
  const id = newSearchId();
  const { spec, windowStart, stages } = buildSpec(input.line, input.stage, now);
  const expires = origin === "public" && demo === null ? new Date(now.getTime() + PUBLIC_SEARCH_TTL_DAYS * DAY_MS).toISOString() : null;
  await db
    .prepare(
      `INSERT INTO searches (id, line, stage, country, reuse_key, origin, demo, state, window_start, stages_json, spec_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.line, input.stage, input.country, reuseKey(input), origin, demo, windowStart, JSON.stringify(stages), JSON.stringify(spec), now.toISOString(), expires)
    .run();
  return id;
}

/**
 * A public visitor's search: the stored one when the same was asked within REUSE_DAYS days (free,
 * not counted), else a new one if the spend stop, the day's total and the visitor's own limit allow.
 */
export async function startPublicSearch(env: Env, input: SearchInput, visitor: string, now: Date): Promise<StartResult> {
  const reused = await findReusable(env.DB, input, now);
  if (reused !== null) return { ok: true, id: reused.id, state: reused.state, cached: true };
  if (await spendStopReached(env.DB)) return { ok: false, error: "spend_stop", message: SPEND_STOP };
  if (!(await countIfUnder(env.DB, ALL, now, PUBLIC_SEARCHES_PER_DAY))) return { ok: false, error: "daily_limit", message: DAILY_LIMIT };
  if (!(await countIfUnder(env.DB, visitor, now, PUBLIC_SEARCHES_PER_VISITOR_PER_DAY))) {
    await uncount(env.DB, ALL, now);
    return { ok: false, error: "visitor_limit", message: VISITOR_LIMIT };
  }
  const id = await insertSearch(env.DB, input, "public", null, now);
  return { ok: true, id, state: "queued", cached: false };
}

/** An admin search: not held to the public limits or the reuse, but held to the spend stop. */
export async function startAdminSearch(env: Env, input: SearchInput, demo: number | null, now: Date): Promise<StartResult> {
  if (await spendStopReached(env.DB)) return { ok: false, error: "spend_stop", message: SPEND_STOP };
  const id = await insertSearch(env.DB, input, "admin", demo, now);
  return { ok: true, id, state: "queued", cached: false };
}

/**
 * Adopts a dataset TinySet already filled, without paying for it again: the search starts at
 * `finding` with that dataset, books no run cost, and is checked and ranked like any other. The
 * spec stored is the dataset's own; the window is counted from the day the dataset was made.
 */
export async function importSearch(env: Env, datasetId: string, input: SearchInput, demo: number | null, now: Date): Promise<string> {
  const ds = await getDataset(env, datasetId);
  const madeOn = ds.createdAt !== null && !Number.isNaN(Date.parse(ds.createdAt)) ? new Date(ds.createdAt) : now;
  const built = buildSpec(input.line, input.stage, madeOn);
  const id = newSearchId();
  await env.DB.prepare(
    `INSERT INTO searches (id, line, stage, country, reuse_key, origin, demo, state, window_start, stages_json, spec_json,
       dataset_id, run_id, dataset_status, row_count, cost_usd, cost_basis, created_at, started_at)
     VALUES (?, ?, ?, ?, ?, 'import', ?, 'finding', ?, ?, ?, ?, ?, ?, ?, 0, 'import', ?, ?)`,
  )
    .bind(
      id,
      input.line,
      input.stage,
      input.country,
      reuseKey(input),
      demo,
      built.windowStart,
      JSON.stringify(built.stages),
      JSON.stringify(ds.spec ?? built.spec),
      ds.id,
      ds.run?.id ?? null,
      ds.status,
      ds.rowCount,
      now.toISOString(),
      now.toISOString(),
    )
    .run();
  return id;
}
