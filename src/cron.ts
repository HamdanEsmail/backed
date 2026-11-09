// The job that runs every minute (wrangler.jsonc `* * * * *`): delete public searches past their
// time, then move every unfinished search forward, so a search finishes even when nobody is
// watching its page. Each step runs even when an earlier one fails.
import type { Env } from "./env";
import { advance } from "./search/advance";

/** Unfinished searches moved forward per minute, oldest first. */
const ADVANCE_PER_RUN = 5;

export interface CronResult {
  /** Searches moved forward by this run. */
  advanced: number;
  expired: number;
  failed_steps: string[];
}

export async function runCron(env: Env, now: Date = new Date()): Promise<CronResult> {
  const out: CronResult = { advanced: 0, expired: 0, failed_steps: [] };

  try {
    // Companies, their investors and the ranking go with the search (ON DELETE CASCADE).
    const { results } = await env.DB.prepare(
      "DELETE FROM searches WHERE expires_at IS NOT NULL AND expires_at < ? AND demo IS NULL AND state IN ('ready', 'failed') RETURNING id",
    )
      .bind(now.toISOString())
      .all();
    out.expired = results.length;
  } catch {
    out.failed_steps.push("expire");
  }

  const { results } = await env.DB.prepare(
    "SELECT id FROM searches WHERE state NOT IN ('ready', 'failed') ORDER BY created_at, id LIMIT ?",
  )
    .bind(ADVANCE_PER_RUN)
    .all<{ id: string }>();
  for (const { id } of results) {
    try {
      await advance(env, id, now);
      out.advanced++;
    } catch {
      out.failed_steps.push(`advance:${id}`);
    }
  }
  if (out.failed_steps.length > 0) console.warn("cron", JSON.stringify(out));
  return out;
}
