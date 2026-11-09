import { Hono } from "hono";
import { adminOnly } from "./auth";
import { runCron } from "./cron";
import type { Env } from "./env";
import { searchesRouter } from "./handlers/searches";
import { statsRouter } from "./handlers/stats";
import { notFound, siteRouter } from "./site/router";

const app = new Hono<{ Bindings: Env }>();

app.route("/", searchesRouter);
app.route("/", statsRouter);

app.post("/api/admin/ping", adminOnly, (c) => c.json({ ok: true }));

// The pages, last, so every API route keeps its answer. Static files (public/) are served before
// the Worker runs at all.
app.route("/", siteRouter);

app.notFound(notFound);

/** Every minute: expire old public searches and move unfinished ones forward. */
async function scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(runCron(env));
}

export { app };

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>;
