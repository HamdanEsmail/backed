// The job that runs every minute (wrangler.jsonc `* * * * *`). Its work is to move every unfinished
// search forward, so a search finishes even when nobody is watching its page.
import type { Env } from "./env";

export interface CronResult {
  /** Searches moved forward by this run. */
  advanced: number;
  failed_steps: string[];
}

export async function runCron(_env: Env, _now: Date = new Date()): Promise<CronResult> {
  return { advanced: 0, failed_steps: [] };
}
