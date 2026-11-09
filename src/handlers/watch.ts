// Watching a saved search: the admin routes that start and stop a watch, and the webhook its
// Monitor calls. The webhook's path carries WEBHOOK_SECRET; with any other value it is 404.
import { Hono } from "hono";
import { adminOnly, constantTimeEqual } from "../auth";
import type { Env } from "../env";
import { TinyFishError } from "../tinyfish/client";
import { getWatch, readHits, receiveRun, startWatch, stopWatch } from "../watch/watch";

export const watchRouter = new Hono<{ Bindings: Env }>();

const SEARCH_ID = /^[a-z0-9]{12}$/;

/** POST /api/admin/searches/:id/watch `{ key_words, until }`: creates the search's Monitor. */
watchRouter.post("/api/admin/searches/:id/watch", adminOnly, async (c) => {
  const id = c.req.param("id");
  if (!SEARCH_ID.test(id)) return c.json({ error: "not_found" }, 404);
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await c.req.json();
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    // answered below
  }
  if (typeof body.key_words !== "string" || typeof body.until !== "string") {
    return c.json({ error: "invalid", message: "Send key_words (the line's key words) and until (YYYY-MM-DD)." }, 400);
  }
  try {
    const r = await startWatch(c.env, id, body.key_words, body.until, new Date());
    if (!r.ok) return c.json({ error: r.error, message: r.message }, r.status);
    const w = r.watch;
    return c.json({ search_id: w.search_id, monitor_id: w.monitor_id, query: w.query, until: w.until, created_at: w.created_at }, 201);
  } catch (err) {
    if (err instanceof TinyFishError) return c.json({ error: "monitor_not_created", code: err.code }, 502);
    throw err;
  }
});

/** DELETE /api/admin/searches/:id/watch: deletes the search's own Monitor and ends the watch. */
watchRouter.delete("/api/admin/searches/:id/watch", adminOnly, async (c) => {
  const id = c.req.param("id");
  if (!SEARCH_ID.test(id) || (await getWatch(c.env.DB, id)) === null) return c.json({ error: "not_found" }, 404);
  try {
    const stopped = await stopWatch(c.env, id, "admin", new Date());
    return c.json({ search_id: id, stopped });
  } catch (err) {
    if (err instanceof TinyFishError) return c.json({ error: "monitor_not_deleted", code: err.code }, 502);
    throw err;
  }
});

/** POST /hooks/monitor/:secret: one Monitor run. Its new results are read after the response. */
watchRouter.post("/hooks/monitor/:secret", async (c) => {
  const secret = c.env.WEBHOOK_SECRET;
  if (!secret || !constantTimeEqual(c.req.param("secret"), secret)) return c.body(null, 404);
  let data: unknown;
  try {
    data = JSON.parse(await c.req.text());
  } catch {
    return c.json({ error: "invalid_payload" }, 400);
  }
  const now = new Date();
  const r = await receiveRun(c.env, data, now);
  if (r.status === 200 && (r.body.new_results ?? 0) > 0) {
    c.executionCtx.waitUntil(
      readHits(c.env, now).catch(() => {
        console.error("watch read failed");
      }),
    );
  }
  return c.json(r.body, r.status);
});
