import { Hono } from "hono";
import { adminOnly } from "./auth";
import { runCron } from "./cron";
import type { Env } from "./env";
import { searchesRouter } from "./handlers/searches";
import { statsRouter } from "./handlers/stats";

const app = new Hono<{ Bindings: Env }>();

app.route("/", searchesRouter);
app.route("/", statsRouter);

app.post("/api/admin/ping", adminOnly, (c) => c.json({ ok: true }));

app.notFound((c) => c.json({ error: "not_found" }, 404));

/** Every minute: expire old public searches and move unfinished ones forward. */
async function scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(runCron(env));
}

export { app };

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>;
