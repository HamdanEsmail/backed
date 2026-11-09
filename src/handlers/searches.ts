// The searches API. Every read answers at once from what is stored and asks for an `advance` after
// the response; nothing here waits on TinyFish except the admin import's one dataset read.
import { Hono, type Context } from "hono";
import { adminOnly, visitorHash } from "../auth";
import type { Env } from "../env";
import { advanceLater } from "../search/advance";
import { importSearch, startAdminSearch, startPublicSearch } from "../search/create";
import { csvResponse } from "../search/csv-response";
import { listSearches, readSearch } from "../search/read";
import { checkInput } from "../search/spec";
import { TinyFishError } from "../tinyfish/client";

export const searchesRouter = new Hono<{ Bindings: Env }>();

const FINISHED = new Set(["ready", "failed"]);

async function jsonBody(c: Context<{ Bindings: Env }>): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A demo position, 1 to 3, or null. */
function demoOf(v: unknown): number | null | "bad" {
  if (v === undefined || v === null) return null;
  return v === 1 || v === 2 || v === 3 ? v : "bad";
}

searchesRouter.post("/api/searches", async (c) => {
  const body = await jsonBody(c);
  if (body === null) return c.json({ error: "invalid", field: null, message: "Send a JSON object with line, stage and country." }, 400);
  const input = checkInput(body);
  if (!input.ok) return c.json({ error: "invalid", field: input.field, message: input.message }, 400);
  const visitor = await visitorHash(c.env, c.req.header("CF-Connecting-IP"));
  const started = await startPublicSearch(c.env, input.input, visitor, new Date());
  if (!started.ok) return c.json({ error: started.error, message: started.message }, started.error === "spend_stop" ? 503 : 429);
  if (!FINISHED.has(started.state)) advanceLater(c.env, c.executionCtx, started.id);
  return c.json({ id: started.id, state: started.state, cached: started.cached }, 202);
});

searchesRouter.get("/api/searches", async (c) => c.json({ searches: await listSearches(c.env.DB) }));

searchesRouter.get("/api/searches/:id", async (c) => {
  const m = /^([a-z0-9]{12})(\.csv)?$/.exec(c.req.param("id"));
  const view = m === null ? null : await readSearch(c.env.DB, m[1]!);
  if (view === null) return c.json({ error: "not_found" }, 404);
  if (!FINISHED.has(view.search.state)) advanceLater(c.env, c.executionCtx, view.search.id);
  return m![2] === ".csv" ? csvResponse(view) : c.json(view);
});

searchesRouter.post("/api/admin/searches", adminOnly, async (c) => {
  const body = await jsonBody(c);
  if (body === null) return c.json({ error: "invalid", message: "Send a JSON object with line, stage and country." }, 400);
  const input = checkInput(body);
  if (!input.ok) return c.json({ error: "invalid", field: input.field, message: input.message }, 400);
  const demo = demoOf(body.demo);
  if (demo === "bad") return c.json({ error: "invalid", field: "demo", message: "demo is 1, 2 or 3." }, 400);
  const started = await startAdminSearch(c.env, input.input, demo, new Date());
  if (!started.ok) return c.json({ error: started.error, message: started.message }, 503);
  advanceLater(c.env, c.executionCtx, started.id);
  return c.json({ id: started.id, state: started.state, cached: false }, 202);
});

searchesRouter.post("/api/admin/import", adminOnly, async (c) => {
  const body = await jsonBody(c);
  if (body === null || typeof body.dataset_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.dataset_id)) {
    return c.json({ error: "invalid", field: "dataset_id", message: "Send dataset_id (a TinySet dataset id) with line, stage and country." }, 400);
  }
  const input = checkInput(body);
  if (!input.ok) return c.json({ error: "invalid", field: input.field, message: input.message }, 400);
  const demo = demoOf(body.demo);
  if (demo === "bad") return c.json({ error: "invalid", field: "demo", message: "demo is 1, 2 or 3." }, 400);
  try {
    const id = await importSearch(c.env, body.dataset_id, input.input, demo, new Date());
    advanceLater(c.env, c.executionCtx, id);
    return c.json({ id, state: "finding", cached: false }, 202);
  } catch (err) {
    if (err instanceof TinyFishError) return c.json({ error: "dataset_unreadable", code: err.code }, 502);
    throw err;
  }
});
