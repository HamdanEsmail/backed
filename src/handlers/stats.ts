// GET /api/stats: what Backed has done and spent, from the database only.
import { Hono } from "hono";
import { PUBLIC_SEARCHES_PER_DAY, SEARCH_BUDGET_USD, SPEND_STOP_USD } from "../core/limits";
import { spendByKind, totalSpend } from "../core/spend";
import { ALL, usedToday } from "../db/publicUse";
import type { Env } from "../env";
import { spendStopReached } from "../search/money";

export const statsRouter = new Hono<{ Bindings: Env }>();

const money = (usd: number) => Math.round(usd * 1e4) / 1e4;

export async function readStats(db: D1Database, now: Date = new Date()) {
  const counts = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM searches) AS searches,
         (SELECT COUNT(*) FROM searches WHERE state = 'ready') AS ready,
         (SELECT COUNT(*) FROM searches WHERE state = 'failed') AS failed,
         (SELECT COUNT(*) FROM searches WHERE state NOT IN ('ready', 'failed')) AS running,
         (SELECT COUNT(*) FROM companies WHERE removed = 0) AS companies,
         (SELECT COUNT(*) FROM companies WHERE removed = 0 AND state = 'proved') AS proved,
         (SELECT COUNT(*) FROM companies WHERE removed = 0 AND state = 'set_apart') AS set_apart,
         (SELECT COUNT(*) FROM ranking) AS ranked_investors`,
    )
    .first<Record<string, number>>();
  const by = await spendByKind(db);
  const spent = await totalSpend(db);
  const usedPublic = await usedToday(db, ALL, now);
  return {
    searches: { total: counts?.searches ?? 0, ready: counts?.ready ?? 0, failed: counts?.failed ?? 0, running: counts?.running ?? 0 },
    companies: { found: counts?.companies ?? 0, proved: counts?.proved ?? 0, set_apart: counts?.set_apart ?? 0 },
    ranked_investors: counts?.ranked_investors ?? 0,
    spend_usd: money(spent),
    // One row per TinyFish call; TinySet runs are booked as one cost row each when they end.
    tinyfish: {
      tinyset: { calls: by.dataset.rows, runs: by.dataset_run.rows, usd: money(by.dataset.usd + by.dataset_run.usd) },
      fetch: { calls: by.fetch.rows, usd: money(by.fetch.usd) },
      search: { calls: by.search.rows, usd: money(by.search.usd) },
      monitor: { calls: by.monitor_check.rows, usd: money(by.monitor_check.usd) },
      wallet: { calls: by.wallet.rows, usd: money(by.wallet.usd) },
    },
    limits: {
      spend_stop_usd: SPEND_STOP_USD,
      search_budget_usd: SEARCH_BUDGET_USD,
      new_searches_open: !(await spendStopReached(db)),
      public_searches_today: usedPublic,
      public_searches_per_day: PUBLIC_SEARCHES_PER_DAY,
    },
  };
}

statsRouter.get("/api/stats", async (c) => c.json(await readStats(c.env.DB)));
