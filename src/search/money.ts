// The spend stop. The ledger holds what has been spent; a run that has started but not ended is
// counted at its budget, so the stop holds even while several are open.
import { SEARCH_BUDGET_USD, SPEND_STOP_USD } from "../core/limits";
import { totalSpend } from "../core/spend";

/** Spent so far plus SEARCH_BUDGET_USD for every paid run not yet booked. */
export async function committedSpend(db: D1Database): Promise<number> {
  const open = await db
    .prepare("SELECT COUNT(*) AS n FROM searches WHERE state <> 'queued' AND origin <> 'import' AND cost_basis IS NULL AND started_at IS NOT NULL")
    .first<{ n: number }>();
  return (await totalSpend(db)) + (open?.n ?? 0) * SEARCH_BUDGET_USD;
}

/** True when one more search, at its budget, would take spending past SPEND_STOP_USD. New paid
 *  searches are refused from then on; stored searches stay readable. */
export async function spendStopReached(db: D1Database): Promise<boolean> {
  return (await committedSpend(db)) + SEARCH_BUDGET_USD > SPEND_STOP_USD + 1e-9;
}

/** True when spending itself has reached SPEND_STOP_USD. Every paid call ends then, the watches'
 *  Monitor runs included. A Monitor run costs half a cent, so the watches go on well after the last
 *  search that fits has started. */
export async function paidWorkStopped(db: D1Database): Promise<boolean> {
  return (await committedSpend(db)) >= SPEND_STOP_USD - 1e-9;
}
