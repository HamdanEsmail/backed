// Watching a saved search: the admin routes, the Monitor's webhook, a new page read as one company
// and put through the proof check, and the search ranked again in place. Every company, investor
// and page is invented.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordSpend } from "../src/core/spend";
import { runCron } from "../src/cron";
import { advance } from "../src/search/advance";
import { startAdminSearch, startPublicSearch } from "../src/search/create";
import { committedSpend } from "../src/search/money";
import { readSearch } from "../src/search/read";
import type { SearchInput } from "../src/search/spec";
import { dateIn, factsFromAnnouncement, namesInHeadline } from "../src/watch/announcement";
import { readMonitorRun, startWatch, watchCron, watchQuery } from "../src/watch/watch";
import { callWorker } from "./helpers/app";
import { failingOn } from "./helpers/d1";
import { fetchMock } from "./helpers/fetch-mock";
import { companyRow, fakeTinyFish, type FakeTinyFish } from "./helpers/tinyset";

const MONITORS_API = "https://agent.tinyfish.ai/v1/monitors";
const MONITOR_ID = "mon-7f3a";
const T0 = new Date("2026-11-09T10:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const INPUT: SearchInput = { line: "Pantry planning software for school kitchens", stage: "seed", country: "United Kingdom" };

const URL_A = "https://news.example/larder-loop-seed";
const URL_NEW = "https://news.example/crumbline-seed";
const ADMIN = { Authorization: "Bearer test-admin", "content-type": "application/json" };

const PAGES = {
  [URL_A]: "# Larder Loop raises $4M\n\nLarder Loop today announced a $4M seed round led by Copperline Ventures, with participation from Northgate Seed Fund.",
  [URL_NEW]:
    "# Crumbline raises $2M seed round\n\n20 October 2026\n\nCrumbline, which plans school pantries, has raised a $2M seed round led by Copperline Ventures, with participation from Saltmarsh Capital and Fernhill Angels.\n\nThe company will hire two engineers.",
};

const ROWS = [
  companyRow("row-a", {
    company: "Larder Loop",
    round_type: "Seed",
    announcement_date: "2026-06-12",
    lead_investor: "Copperline Ventures",
    other_investors: "Northgate Seed Fund",
    lead_investor_website: "https://copperline.example",
    announcement_url: URL_A,
  }),
];

let tf: FakeTinyFish;
let monitorCreates: unknown[];
let monitorDeletes: string[];

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM searches"),
    env.DB.prepare("DELETE FROM spend"),
    env.DB.prepare("DELETE FROM public_use"),
    env.DB.prepare("DELETE FROM watch_runs"),
    env.DB.prepare("DELETE FROM investors"),
    env.DB.prepare("UPDATE run_slot SET search_id = NULL, since = NULL"),
  ]);
  fetchMock.activate();
  tf = fakeTinyFish();
  tf.pages = { ...PAGES };
  monitorCreates = [];
  monitorDeletes = [];
  fetchMock.intercept({
    method: "POST",
    url: MONITORS_API,
    times: Infinity,
    reply: (_req, body) => {
      monitorCreates.push(body);
      return Response.json({ monitor: { id: MONITOR_ID, status: "active" } }, { status: 201 });
    },
  });
  fetchMock.intercept({
    method: "DELETE",
    url: new RegExp(`^${MONITORS_API}/`),
    times: Infinity,
    reply: (req) => {
      monitorDeletes.push(new URL(req.url).pathname.split("/").pop()!);
      return Response.json({ ok: true });
    },
  });
});
afterEach(() => fetchMock.reset());

/** A demo search, run to ready on the fake TinySet. */
async function readyDemo(): Promise<string> {
  const r = await startAdminSearch(env, INPUT, 1, T0);
  if (!r.ok) throw new Error(r.error);
  await advance(env, r.id, at(0));
  tf.status = "ready";
  tf.runStatus = "done";
  tf.rows = ROWS;
  for (let i = 1; i < 6; i++) await advance(env, r.id, at(i * 11));
  expect((await readSearch(env.DB, r.id))!.search.state).toBe("ready");
  return r.id;
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function watch(id: string) {
  return callWorker(`/api/admin/searches/${id}/watch`, {
    method: "POST",
    headers: ADMIN,
    body: JSON.stringify({ key_words: "pantry planning software", until: inDays(8) }),
  });
}

function hook(payload: unknown, secret = "test-secret") {
  return callWorker(`/hooks/monitor/${secret}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
}

const run = (runId: string, results: { url: string; title: string; date?: string }[]) => ({
  search_monitor_id: MONITOR_ID,
  id: runId,
  results,
  new_result_positions: results.map((_, i) => i),
});

async function monitorSpend() {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(amount_usd) AS usd FROM spend WHERE kind = 'monitor_check'").first<{ n: number; usd: number | null }>();
  return { n: r?.n ?? 0, usd: Math.round((r?.usd ?? 0) * 1000) / 1000 };
}

describe("watching a saved search", () => {
  it("adds one company from a new announcement, proved by the same check, and ranks the search again", async () => {
    const id = await readyDemo();
    const before = (await readSearch(env.DB, id))!;
    expect(before.investors.map((i) => i.name)).toEqual(["Copperline Ventures", "Northgate Seed Fund"]);

    const created = await watch(id);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ monitor_id: MONITOR_ID, query: "pantry planning software raises seed funding" });
    expect(monitorCreates).toHaveLength(1);
    expect(monitorCreates[0]).toMatchObject({ type: "search", name: `backed:${id}`, config: { query: "pantry planning software raises seed funding" } });
    expect(JSON.stringify(monitorCreates[0])).toContain("/hooks/monitor/test-secret");

    const res = await hook(run("run-1", [{ url: URL_NEW, title: "Crumbline raises $2M seed round", date: "Oct 20, 2026" }]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, new_results: 1 });

    const view = (await readSearch(env.DB, id))!;
    expect(view.search.state).toBe("ready");
    const crumb = view.companies.find((c) => c.name === "Crumbline")!;
    expect(crumb).toMatchObject({ state: "proved", found_by: "watch", round_type: "seed", amount_usd: 2_000_000, announced_on: "2026-10-20" });
    expect(crumb.named_investors.map((i) => [i.name, i.role]).sort()).toEqual([
      ["Copperline Ventures", "lead"],
      ["Fernhill Angels", "other"],
      ["Saltmarsh Capital", "other"],
    ]);
    expect(view.figures).toMatchObject({ found: 2, proved: 2, investors: 4 });
    const copper = view.investors.find((i) => i.name === "Copperline Ventures")!;
    expect(copper.companies).toBe(2);
    expect(copper.deals.map((d) => d.company).sort()).toEqual(["Crumbline", "Larder Loop"]);
    expect(copper.deals.find((d) => d.company === "Crumbline")!.quote).toContain("led by Copperline Ventures");
    expect(view.search.watch).toMatchObject({ active: true, query: "pantry planning software raises seed funding" });

    // Creating the Monitor runs it once; the delivered run is the second check.
    expect(await monitorSpend()).toEqual({ n: 2, usd: 0.01 });

    const page = await callWorker(`/searches/${id}`);
    const html = await page.text();
    expect(html).toContain("found by the watch and proved by its announcement");
    expect(html).toContain("Found by the watch");
  });

  it("adds nothing for a result the search already has, and books a run delivered twice once", async () => {
    const id = await readyDemo();
    await watch(id);
    tf.pages["https://other.example/larder-loop"] = PAGES[URL_A]!;
    const res = await hook(
      run("run-2", [
        { url: URL_A, title: "Larder Loop raises $4M", date: "Jun 12, 2026" },
        { url: "https://other.example/larder-loop", title: "Larder Loop raises $4M", date: "Jun 12, 2026" },
      ]),
    );
    expect(await res.json()).toEqual({ ok: true, new_results: 2 });
    const hits = await env.DB.prepare("SELECT url, state FROM watch_hits ORDER BY url").all();
    expect(hits.results).toEqual([
      { url: "https://news.example/larder-loop-seed", state: "known" },
      { url: "https://other.example/larder-loop", state: "known" },
    ]);
    expect((await readSearch(env.DB, id))!.figures).toMatchObject({ found: 1, proved: 1 });

    // The same run again: nothing more is booked or read.
    const again = await hook(run("run-2", [{ url: URL_NEW, title: "Crumbline raises $2M seed round" }]));
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    expect(await monitorSpend()).toEqual({ n: 2, usd: 0.01 });
    expect((await readSearch(env.DB, id))!.figures.found).toBe(1);
  });

  it("adds nothing for a page that is not a funding announcement, or one the proof check refuses", async () => {
    const id = await readyDemo();
    await watch(id);
    const TIPS = "https://blog.example/pantry-tips";
    const GRANT = "https://news.example/crumbline-grant";
    tf.pages[TIPS] = "# Ten tips for school pantries\n\nPlan the week. Label the shelves. Count stock on Fridays.";
    tf.pages[GRANT] =
      "# Crumbline secures $50,000 seed grant\n\n20 October 2026\n\nCrumbline has secured a $50,000 seed grant backed by Saltmarsh Capital, awarded to the winner of the Kitchen Pitch competition.";
    await hook(
      run("run-3", [
        { url: TIPS, title: "Ten tips for school pantries" },
        { url: GRANT, title: "Crumbline secures $50,000 seed grant", date: "Oct 20, 2026" },
      ]),
    );
    const hits = await env.DB.prepare("SELECT url, state, reason FROM watch_hits ORDER BY url").all();
    expect(hits.results).toEqual([
      { url: TIPS, state: "refused", reason: "not_an_announcement" },
      { url: GRANT, state: "refused", reason: "prize_not_round" },
    ]);
    const view = (await readSearch(env.DB, id))!;
    expect(view.figures).toMatchObject({ found: 1, proved: 1, investors: 2 });
    expect(view.companies.some((c) => c.found_by === "watch")).toBe(false);
  });

  it("refuses a wrong secret and an unknown Monitor, and books nothing", async () => {
    const id = await readyDemo();
    await watch(id);
    const wrong = await hook(run("run-4", [{ url: URL_NEW, title: "Crumbline raises $2M seed round" }]), "not-the-secret");
    expect(wrong.status).toBe(404);
    expect(await wrong.text()).toBe("");
    const unknown = await hook({ ...run("run-5", []), search_monitor_id: "someone-elses-monitor" });
    expect(unknown.status).toBe(404);
    expect(await monitorSpend()).toEqual({ n: 1, usd: 0.005 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_hits").first()).toEqual({ n: 0 });
  });
});

describe("the watch's limits", () => {
  it("is admin-only, watches demo searches only, and deletes only its own Monitor", async () => {
    const id = await readyDemo();
    const anonymous = await callWorker(`/api/admin/searches/${id}/watch`, { method: "POST", body: "{}" });
    expect(anonymous.status).toBe(401);

    const pub = await startPublicSearch(env, { ...INPUT, line: "Pantry planning software for care homes" }, "visitor-1", T0);
    if (!pub.ok) throw new Error(pub.error);
    await env.DB.prepare("UPDATE searches SET state = 'ready' WHERE id = ?").bind(pub.id).run();
    expect((await watch(pub.id)).status).toBe(400);

    expect((await watch(id)).status).toBe(201);
    expect((await watch(id)).status).toBe(409);

    const stopped = await callWorker(`/api/admin/searches/${id}/watch`, { method: "DELETE", headers: ADMIN });
    expect(await stopped.json()).toEqual({ search_id: id, stopped: true });
    expect(monitorDeletes).toEqual([MONITOR_ID]);
    expect((await readSearch(env.DB, id))!.search.watch).toMatchObject({ active: false });
  });

  it("ends a watch past its last day, deleting its Monitor, from the cron", async () => {
    const id = await readyDemo();
    await watch(id);
    await env.DB.prepare("UPDATE watches SET until = '2026-11-01' WHERE search_id = ?").bind(id).run();
    await runCron(env, new Date());
    expect(monitorDeletes).toEqual([MONITOR_ID]);
    expect(await env.DB.prepare("SELECT ended_reason FROM watches WHERE search_id = ?").bind(id).first()).toEqual({ ended_reason: "until" });
  });

  it("keeps a watch while new searches run under the stop, and ends it only when paid work stops", async () => {
    const id = await readyDemo();
    await watch(id);
    // About $4 spent and a visitor's search running, counted at its $3 budget: $7 of the $9 stop.
    // No third search could start, but a Monitor run costs half a cent and the watch goes on.
    await recordSpend(env.DB, "dataset_run", 3.9, "earlier searches");
    const pub = await startPublicSearch(env, { ...INPUT, line: "Pantry planning software for care homes" }, "visitor-1", T0);
    if (!pub.ok) throw new Error(pub.error);
    expect((await advance(env, pub.id, at(100))).state).toBe("finding");
    expect(await committedSpend(env.DB)).toBeCloseTo(7.005, 6);
    expect((await watchCron(env, at(200))).ended).toBe(0);
    expect(monitorDeletes).toEqual([]);
    expect((await readSearch(env.DB, id))!.search.watch).toMatchObject({ active: true });

    // At the stop itself every paid call ends, the watch's Monitor included.
    await recordSpend(env.DB, "dataset_run", 2, "more searches");
    expect((await watchCron(env, at(300))).ended).toBe(1);
    expect(monitorDeletes).toEqual([MONITOR_ID]);
    expect(await env.DB.prepare("SELECT ended_reason FROM watches WHERE search_id = ?").bind(id).first()).toEqual({ ended_reason: "spend_stop" });
  });

  it("deletes the Monitor it made when the watch cannot be stored", async () => {
    const id = await readyDemo();
    const broken = { ...env, DB: failingOn(env.DB, /INTO watches/) };
    await expect(startWatch(broken, id, "pantry planning software", inDays(8), new Date())).rejects.toThrow();
    expect(monitorCreates).toHaveLength(1);
    expect(monitorDeletes).toEqual([MONITOR_ID]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM watches").first()).toEqual({ n: 0 });
  });
});

describe("reading a page a watch found", () => {
  const now = new Date("2026-11-09T12:00:00Z");

  it("takes the company from the headline, dropping what describes it", () => {
    expect(namesInHeadline("Cairo AI startup Nanobyte raises $1M pre-seed")).toEqual(["Nanobyte"]);
    expect(namesInHeadline("Food Waste Monitor Grubbin Raises €1M | StartLife")).toEqual([
      "Food Waste Monitor Grubbin",
      "Waste Monitor Grubbin",
      "Monitor Grubbin",
      "Grubbin",
    ]);
    expect(namesInHeadline("Irish-founded tech start-up tackling food waste raises €1m")).toEqual([]);
    expect(namesInHeadline("Felix Harbour leads $8m seed round in Medlo")).toEqual([]);
  });

  it("reads dates as search results and pages write them", () => {
    expect(dateIn("Sep 16, 2026", now)).toBe("2026-09-16");
    expect(dateIn("16 September 2026", now)).toBe("2026-09-16");
    expect(dateIn("3 hours ago", now)).toBe("2026-11-09");
    expect(dateIn("2 days ago", now)).toBe("2026-11-07");
    expect(dateIn("1 year ago", now)).toBe(null);
    expect(dateIn("Dec 1, 2026", now)).toBe(null);
  });

  it("reads investors only from funding sentences about the company", () => {
    const f = factsFromAnnouncement(
      { url: "https://news.example/grubbin", title: "Food Waste Monitor Grubbin Raises $1.1M Seed Funding", date: "Aug 25, 2026" },
      {
        text:
          "Grubbin has closed a $1.1M seed round. The round was led by Quayside Ventures and Harrowgate Capital, with participation from the Eastbank Fund.\n\nIn other news, Pellet raised a round led by Brightwater Partners.",
      },
      now,
    );
    expect(f).toMatchObject({
      name: "Grubbin",
      roundType: "Seed",
      amountUsd: 1_100_000,
      announcedOn: "2026-08-25",
      leadInvestor: "Quayside Ventures; Harrowgate Capital",
      otherInvestors: null,
    });
  });

  it("drops the employers named after 'angel investors from'", () => {
    const f = factsFromAnnouncement(
      { url: "https://news.example/tutorly", title: "Tutorly raises $3M seed round", date: "Oct 2, 2026" },
      {
        text: "Tutorly has raised a $3M seed round led by Quayside Ventures, with participation from Harrowgate Capital and angel investors from Brightwater, Pellet, Grubbin.",
      },
      now,
    );
    expect(f).toMatchObject({ leadInvestor: "Quayside Ventures", otherInvestors: "Harrowgate Capital" });
  });

  it("builds the query from the key words and the stage, and reads a run's new results", () => {
    expect(watchQuery("  cold storage  for farmers ", "pre-seed")).toBe("cold storage for farmers raises seed funding");
    expect(watchQuery("dental software", "series-a")).toBe("dental software raises Series A funding");
    const r = readMonitorRun({
      request_id: "search-monitor:mon-1:run:run-9",
      results: [{ url: "https://a.example/1", title: "A" }, { url: "ftp://b.example" }, { url: "https://c.example/3", title: "C", date: "2 days ago" }],
      new_result_positions: [1, 2],
    });
    expect(r).toEqual({ monitorId: "mon-1", runId: "run-9", results: [{ url: "https://c.example/3", title: "C", date: "2 days ago" }] });
  });
});
