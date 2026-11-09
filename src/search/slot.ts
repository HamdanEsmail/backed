// The one search allowed to run on TinySet at a time. One D1 row holds the search and since when; a
// holder older than RUN_SLOT_STALE_MINUTES no longer blocks, so a lost run cannot hold it for good.
import { RUN_SLOT_STALE_MINUTES } from "../core/limits";

/** Takes the slot for `searchId` when it is free or its holder is stale. One conditional UPDATE, so
 *  of two racing takers exactly one wins (a second call for the same search loses too). */
export async function takeSlot(db: D1Database, searchId: string, now: Date): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - RUN_SLOT_STALE_MINUTES * 60_000).toISOString();
  const r = await db
    .prepare("UPDATE run_slot SET search_id = ?, since = ? WHERE id = 1 AND (search_id IS NULL OR since < ?)")
    .bind(searchId, now.toISOString(), staleBefore)
    .run();
  return r.meta.changes === 1;
}

/** Frees the slot, but only when `searchId` holds it. */
export async function releaseSlot(db: D1Database, searchId: string): Promise<boolean> {
  const r = await db.prepare("UPDATE run_slot SET search_id = NULL, since = NULL WHERE id = 1 AND search_id = ?").bind(searchId).run();
  return r.meta.changes === 1;
}

export function readSlot(db: D1Database): Promise<{ search_id: string | null; since: string | null } | null> {
  return db.prepare("SELECT search_id, since FROM run_slot WHERE id = 1").first();
}
