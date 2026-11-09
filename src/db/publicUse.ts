// Daily counters behind the public limits. One row per (visitor hash, UTC day); the row whose hash
// is ALL counts every public search that day.

export const ALL = "all";

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Counts one search for `key` today unless it already has `limit`. One statement, so two racing
 *  callers can never both take the last place. True when counted. */
export async function countIfUnder(db: D1Database, key: string, now: Date, limit: number): Promise<boolean> {
  if (limit < 1) return false;
  const row = await db
    .prepare(
      `INSERT INTO public_use (ip_hash, day, searches) VALUES (?1, ?2, 1)
       ON CONFLICT (ip_hash, day) DO UPDATE SET searches = searches + 1 WHERE searches < ?3
       RETURNING searches`,
    )
    .bind(key, utcDay(now), limit)
    .first<{ searches: number }>();
  return row !== null;
}

/** Gives back a place counted by countIfUnder (when a later check refuses the search). */
export async function uncount(db: D1Database, key: string, now: Date): Promise<void> {
  await db.prepare("UPDATE public_use SET searches = MAX(0, searches - 1) WHERE ip_hash = ? AND day = ?").bind(key, utcDay(now)).run();
}

/** Searches counted for `key` today. */
export async function usedToday(db: D1Database, key: string, now: Date): Promise<number> {
  const row = await db.prepare("SELECT searches FROM public_use WHERE ip_hash = ? AND day = ?").bind(key, utcDay(now)).first<{ searches: number }>();
  return row?.searches ?? 0;
}
