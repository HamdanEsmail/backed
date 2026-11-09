// The site: pages rendered on the server from what is stored, over the same read functions as the
// JSON API. Behind SITE_ENABLED: switched off, every page path answers the API's JSON 404. A page
// never waits on TinyFish: it answers from the database and asks for an `advance` after the response.
import { Hono, type Context } from "hono";
import type { Child } from "hono/jsx";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { visitorHash } from "../auth";
import type { Env } from "../env";
import { advanceLater } from "../search/advance";
import { startPublicSearch } from "../search/create";
import { readSearch, type SearchView } from "../search/read";
import { checkInput } from "../search/spec";
import { isStage, type Stage } from "../core/stages";
import { isCountry } from "../core/countries";
import { Home, type HomeForm, type HomeProps } from "./views/home";
import { NotFoundPage, SearchPage } from "./views/search";

type AppContext = Context<{ Bindings: Env }>;

/** Sent with every page. Styles and fonts may come from this origin and from Fontshare only. */
export const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; style-src 'self' https://api.fontshare.com; font-src https://cdn.fontshare.com; img-src 'self' data:; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
} as const;

export const siteEnabled = (env: Env): boolean => env.SITE_ENABLED === "1";

const SEARCH_ID = /^[a-z0-9]{12}$/;

function render(c: AppContext, page: Child, status: ContentfulStatusCode = 200) {
  return c.html(page as unknown as string, status, { ...SECURITY_HEADERS, "cache-control": "no-store" });
}

/** The API, the hooks and the assets are never a page. */
const notAPage = (path: string): boolean => /^\/(?:api|hooks|assets)(?:\/|$)/.test(path);

/** The Worker's 404: the site's page for a page path while the site is on, else the JSON 404. */
export function notFound(c: AppContext) {
  if (siteEnabled(c.env) && !notAPage(c.req.path)) return render(c, <NotFoundPage />, 404);
  return c.json({ error: "not_found" }, 404);
}

async function savedCount(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM searches WHERE state = 'ready' AND demo IS NOT NULL").first<{ n: number }>();
  return row?.n ?? 0;
}

/** The search the home shows: the first demo search that is ready, else the newest ready one. */
async function featured(db: D1Database): Promise<{ view: SearchView; minutes: HomeProps["minutes"] } | null> {
  const row = await db
    .prepare(
      `SELECT id, origin, started_at, finished_at, run_started_at, run_finished_at FROM searches WHERE state = 'ready'
       ORDER BY demo IS NULL, demo, finished_at DESC LIMIT 1`,
    )
    .first<{ id: string; origin: string; started_at: string | null; finished_at: string | null; run_started_at: string | null; run_finished_at: string | null }>();
  if (row === null) return null;
  const view = await readSearch(db, row.id);
  if (view === null) return null;
  // An adopted dataset did not run here: its time is TinySet's own run, not line-to-list.
  const span = (a: string | null, b: string | null) => (a !== null && b !== null ? Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 60_000)) : null);
  const n = row.origin === "import" ? span(row.run_started_at, row.run_finished_at) : span(row.started_at, row.finished_at);
  return { view, minutes: n === null ? null : { n, what: row.origin === "import" ? "find" : "list" } };
}

async function homePage(c: AppContext, form: HomeForm | null, status: ContentfulStatusCode = 200) {
  const [shown, saved] = await Promise.all([featured(c.env.DB), savedCount(c.env.DB)]);
  const v = shown?.view ?? null;
  const filled: HomeForm = form ?? {
    line: v?.search.line ?? "",
    stage: v?.search.stage ?? "seed",
    country: v?.search.country ?? "United States",
    error: null,
  };
  return render(c, <Home featured={v} minutes={shown?.minutes ?? null} saved={saved} form={filled} />, status);
}

export const siteRouter = new Hono<{ Bindings: Env }>();

siteRouter.get("/", async (c) => (siteEnabled(c.env) ? homePage(c, null) : notFound(c)));

/** The form on the stage: starts a search, or opens the stored one, and goes to its page. */
siteRouter.post("/search", async (c) => {
  if (!siteEnabled(c.env)) return notFound(c);
  const body = await c.req.parseBody();
  const typed = {
    line: typeof body.line === "string" ? body.line.slice(0, 400) : "",
    stage: isStage(body.stage) ? body.stage : ("seed" as Stage),
    country: typeof body.country === "string" && isCountry(body.country) ? body.country : "United States",
  };
  const input = checkInput({ line: body.line, stage: body.stage, country: body.country });
  if (!input.ok) return homePage(c, { ...typed, error: input.message }, 400);
  const visitor = await visitorHash(c.env, c.req.header("CF-Connecting-IP"));
  const started = await startPublicSearch(c.env, input.input, visitor, new Date());
  if (!started.ok) return homePage(c, { ...typed, error: started.message }, started.error === "spend_stop" ? 503 : 429);
  if (started.state !== "ready" && started.state !== "failed") advanceLater(c.env, c.executionCtx, started.id);
  return c.redirect(`/searches/${started.id}`, 303);
});

siteRouter.get("/searches/:id", async (c) => {
  if (!siteEnabled(c.env)) return notFound(c);
  const id = c.req.param("id");
  if (!SEARCH_ID.test(id)) return notFound(c);
  const [view, saved] = await Promise.all([readSearch(c.env.DB, id), savedCount(c.env.DB)]);
  if (view === null) return notFound(c);
  if (view.search.state !== "ready" && view.search.state !== "failed") advanceLater(c.env, c.executionCtx, id);
  return render(c, <SearchPage view={view} saved={saved} />);
});
