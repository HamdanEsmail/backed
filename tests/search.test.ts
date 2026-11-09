// A search driven through its states against a fake TinyFish, the public limits and the spend stop.
// Every company, investor and person is invented.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordSpend } from "../src/core/spend";
import { runCron } from "../src/cron";
import { advance } from "../src/search/advance";
import { importSearch, startAdminSearch } from "../src/search/create";
import { readSearch } from "../src/search/read";
import { readSlot } from "../src/search/slot";
import type { SearchInput } from "../src/search/spec";
import { callWorker } from "./helpers/app";
import { fetchMock } from "./helpers/fetch-mock";
import { companyRow, DATASET_ID, fakeTinyFish, type FakeTinyFish } from "./helpers/tinyset";

const T0 = new Date("2026-11-09T10:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

const INPUT: SearchInput = { line: "Pantry planning software for school kitchens", stage: "seed", country: "United Kingdom" };

const URL_A = "https://news.example/larder-loop-seed";
const URL_B = "https://news.example/shelfcount-series-a";
const URL_C = "https://news.example/pantrywise";

const ROW_A = companyRow("row-a", {
  company: "Larder Loop",
  round_type: "Seed",
  announcement_date: "2026-06-12",
  lead_investor: "Copperline Ventures",
  other_investors: "Northgate Seed Fund",
  lead_partner: "Tobias Quell",
  founders: "Mira Odhiambo",
  lead_investor_website: "https://copperline.example",
  announcement_url: URL_A,
});
const ROW_B = companyRow("row-b", {
  company: "Shelfcount",
  country: "Germany",
  round_type: "Series A",
  amount_raised: 9_000_000,
  announcement_date: "2025-09-01",
  lead_investor: "Northgate Seed Fund",
  other_investors: "Quiet Harbour Capital",
  announcement_url: URL_B,
});
const ROW_B_CHANGED = { ...ROW_B, data: { ...ROW_B.data, other_investors: "Quiet Harbour Capital; Copperline Ventures" } };
const ROW_C = companyRow("row-c", { company: "Pantrywise", round_type: "Seed", announcement_date: "2026-03-01", lead_investor: "Ashgrove", announcement_url: null });

const PAGES = {
  [URL_A]:
    "# Larder Loop raises $4M\n\nLarder Loop today announced a $4M seed round led by Copperline Ventures, with participation from Northgate Seed Fund.\n\n\"We plan pantries,\" said Tobias Quell of Copperline Ventures. Larder Loop was founded by Mira Odhiambo.",
  [URL_B]: "Shelfcount closed a $9M Series A round led by Northgate Seed Fund. Copperline Ventures also joined the round.",
};

async function clean() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM searches"),
    env.DB.prepare("DELETE FROM spend"),
    env.DB.prepare("DELETE FROM public_use"),
    env.DB.prepare("UPDATE run_slot SET search_id = NULL, since = NULL"),
  ]);
}

async function newSearch(now = T0): Promise<string> {
  const r = await startAdminSearch(env, INPUT, null, now);
  if (!r.ok) throw new Error(r.error);
  return r.id;
}

async function searchRow(id: string) {
  return env.DB.prepare("SELECT * FROM searches WHERE id = ?").bind(id).first<Record<string, unknown>>();
}

let tf: FakeTinyFish;
beforeEach(async () => {
  await clean();
  fetchMock.activate();
  tf = fakeTinyFish();
  tf.pages = { ...PAGES };
});
afterEach(() => fetchMock.reset());

describe("a search from queued to ready", () => {
  it("starts, reads rows as they arrive, checks again a row that changed, books the cost and ranks", async () => {
    const id = await newSearch();
    tf.wallet = ["10.00", "9.85"];

    // queued -> finding: the wallet is read and the dataset created with the spec built from the line.
    expect(await advance(env, id, at(0))).toMatchObject({ state: "finding", did: ["started"] });
    expect(tf.creates).toBe(1);
    expect(JSON.stringify(tf.spec)).toContain("Pantry planning software for school kitchens");
    expect((await readSlot(env.DB))?.search_id).toBe(id);

    // Rows arrive while the run is in progress; both are checked at once.
    tf.rows = [ROW_A, ROW_B];
    const second = await advance(env, id, at(11));
    expect(second.state).toBe("finding");
    expect(second.did).toEqual(["read:2", "proved:Larder Loop", "proved:Shelfcount"]);

    // Within the read interval nothing is read again.
    expect((await advance(env, id, at(15))).did).toEqual([]);

    // The run ends: one row changed its investors, one is new. The changed one is checked again.
    tf.status = "ready";
    tf.runStatus = "done";
    tf.rows = [ROW_A, ROW_B_CHANGED, ROW_C];
    const third = await advance(env, id, at(22));
    expect(third.did).toEqual(["read:3", "run_ended:ready", "proved:Shelfcount", "set_apart:Pantrywise", "ranking", "ready:2"]);
    expect(third.state).toBe("ready");
    expect(tf.reads).toEqual({ [URL_A]: 1, [URL_B]: 2 });

    // The cost is the wallet's difference, booked once, and the slot is free again.
    const s = await searchRow(id);
    expect(s).toMatchObject({ cost_usd: 0.15, cost_basis: "wallet", wallet_before_usd: 10, wallet_after_usd: 9.85, dataset_status: "ready" });
    const runs = await env.DB.prepare("SELECT amount_usd, ref FROM spend WHERE kind = 'dataset_run'").all();
    expect(runs.results).toEqual([{ amount_usd: 0.15, ref: id }]);
    expect((await readSlot(env.DB))?.search_id).toBe(null);

    const view = (await readSearch(env.DB, id))!;
    expect(view.figures).toEqual({ found: 3, proved: 2, set_apart: 1, checking: 0, investors: 2 });
    expect(view.investors.map((i) => [i.position, i.name, i.score, i.companies])).toEqual([
      [1, "Copperline Ventures", 13, 2],
      [2, "Northgate Seed Fund", 13, 2],
    ]);
    const copper = view.investors[0]!;
    expect(copper.deals.map((d) => [d.company, d.led, d.points])).toEqual([
      ["Larder Loop", true, 9],
      ["Shelfcount", false, 4],
    ]);
    expect(copper.deals[0]!.quote).toContain("led by Copperline Ventures");
    expect(copper.deals[0]!.partner).toBe("Tobias Quell");
    expect(copper.deals[0]!.parts.map((p) => p.part)).toEqual(["backed", "led", "same_stage", "same_country", "recent"]);
    expect(copper.site_hint).toBe("https://copperline.example/");
    expect(view.companies.find((c) => c.name === "Pantrywise")).toMatchObject({ state: "set_apart", set_apart_reason: "no_url" });
    expect(view.search.notice).toBe("Only 2 companies like this were proved. The list is thin: read it as a start.");

    // A finished search is left alone.
    expect(await advance(env, id, at(40))).toEqual({ state: "ready", did: [] });
  });

  it("does the same work once when two advance calls run at the same moment", async () => {
    const id = await newSearch();
    const [a, b] = await Promise.all([advance(env, id, at(0)), advance(env, id, at(0))]);
    expect(tf.creates).toBe(1);
    expect([...a.did, ...b.did]).toEqual(["started"]);

    tf.rows = [ROW_A, ROW_B];
    tf.status = "ready";
    tf.runStatus = "done";
    await Promise.all([advance(env, id, at(11)), advance(env, id, at(11)), advance(env, id, at(11))]);
    expect(tf.reads).toEqual({ [URL_A]: 1, [URL_B]: 1 });
    const runs = await env.DB.prepare("SELECT COUNT(*) AS n FROM spend WHERE kind = 'dataset_run'").first<{ n: number }>();
    expect(runs?.n).toBe(1);
    expect((await searchRow(id))?.state).toBe("ready");
  });

  it("runs one search at a time: a second waits in the queue until the first frees the slot", async () => {
    const first = await newSearch(at(0));
    const second = await newSearch(at(1));
    await advance(env, first, at(2));
    expect((await advance(env, second, at(3))).state).toBe("queued");
    tf.status = "empty";
    tf.runStatus = "done";
    await advance(env, first, at(20));
    expect((await searchRow(first))?.state).toBe("failed");
    expect((await advance(env, second, at(21))).state).toBe("finding");
  });

  it("puts a search back in the queue when TinySet says not now", async () => {
    fetchMock.reset();
    fetchMock.activate();
    fetchMock.intercept({ method: "GET", url: "https://agent.tinyfish.ai/v1/wallet", reply: { json: { available_balance: "10.00", currency: "USD" } } });
    fetchMock.intercept({ method: "POST", url: "https://agent.tinyfish.ai/v1/datasets", reply: { status: 429, json: { error: { code: "RATE_LIMIT_EXCEEDED" } } } });
    const id = await newSearch();
    expect(await advance(env, id, at(0))).toMatchObject({ state: "queued", did: ["start_later"] });
    expect((await readSlot(env.DB))?.search_id).toBe(null);
  });
});

describe("a search that does not finish", () => {
  it("fails with no companies when TinySet finds none", async () => {
    const id = await newSearch();
    await advance(env, id, at(0));
    tf.status = "ready";
    tf.runStatus = "done";
    expect((await advance(env, id, at(11))).state).toBe("failed");
    const view = (await readSearch(env.DB, id))!;
    expect(view.search.failed_reason).toBe("none_found");
    expect(view.search.notice).toBe(
      "TinySet found no companies like this that raised since 1 May 2025. Try describing the product and its customer in other words.",
    );
  });

  it("ranks nothing from a failed run with fewer than 5 companies proved", async () => {
    const id = await newSearch();
    await advance(env, id, at(0));
    tf.status = "failed";
    tf.runStatus = "failed";
    tf.rows = [ROW_A, ROW_B, ROW_C];
    expect((await advance(env, id, at(11))).state).toBe("failed");
    const view = (await readSearch(env.DB, id))!;
    expect(view.search.notice).toBe("This search did not finish: TinySet stopped before it finished, and too few companies were proved. Nothing was ranked.");
    expect(view.investors).toEqual([]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM ranking").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("ranks a failed run that still proved at least 5 companies", async () => {
    const id = await newSearch();
    await advance(env, id, at(0));
    tf.status = "failed";
    tf.runStatus = "failed";
    tf.rows = [];
    for (let i = 1; i <= 5; i++) {
      const url = `https://news.example/kitchen-${i}`;
      tf.rows.push(companyRow(`row-${i}`, { company: `Kitchen Tool ${i}`, round_type: "Seed", announcement_date: "2026-01-10", lead_investor: "Copperline Ventures", announcement_url: url }));
      tf.pages[url] = `Kitchen Tool ${i} raised a seed round led by Copperline Ventures.`;
    }
    expect((await advance(env, id, at(11))).state).toBe("ready");
  });

  it("gives up on a run that takes too long, cancelling it", async () => {
    const id = await newSearch();
    await advance(env, id, at(0));
    tf.rows = [ROW_A];
    const late = await advance(env, id, at(41 * 60));
    expect(tf.cancels).toBe(1);
    expect(late.state).toBe("failed");
    expect((await searchRow(id))?.failed_reason).toBe("timeout");
    expect((await readSlot(env.DB))?.search_id).toBe(null);
  });
});

describe("the admin import", () => {
  it("adopts a finished dataset without paying for it again", async () => {
    tf.status = "ready";
    tf.runStatus = "done";
    tf.spec = { name: "Restaurant software rounds", description: "Startups for restaurants.", columns: [{ name: "company", type: "string", is_primary_key: true }] };
    tf.rows = [ROW_A];
    const id = await importSearch(env, DATASET_ID, INPUT, 1, T0);
    expect((await advance(env, id, at(1))).state).toBe("ready");
    const s = await searchRow(id);
    expect(s).toMatchObject({ origin: "import", demo: 1, cost_usd: 0, cost_basis: "import", expires_at: null });
    expect(JSON.parse(String(s?.spec_json))).toMatchObject({ name: "Restaurant software rounds" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM spend WHERE kind IN ('dataset_run', 'wallet')").first()).toEqual({ n: 0 });
    expect(tf.creates).toBe(0);
  });
});

// --- The API: input rules, the public limits and the spend stop ---------------------------------

const post = (body: unknown, ip = "203.0.113.1") =>
  callWorker("/api/searches", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify(body),
  });

describe("POST /api/searches", () => {
  it.each([
    [{ ...INPUT, line: "Too short" }, "line"],
    [{ ...INPUT, line: "x".repeat(141) }, "line"],
    [{ ...INPUT, line: "Pantry planning software, see https://larder.example" }, "line"],
    [{ ...INPUT, line: "Pantry planning software at larderloop.ai for kitchens" }, "line"],
    [{ ...INPUT, line: "Pantry planning, write to founder@larder.example today" }, "line"],
    [{ ...INPUT, stage: "series-c" }, "stage"],
    [{ ...INPUT, country: "Atlantis" }, "country"],
  ])("refuses %j", async (body, field) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid", field });
  });

  it("allows 3 new searches a day in total and 1 per visitor, and reopens a stored one for free", async () => {
    const line = (n: number) => `Pantry planning software for school kitchens, number ${n}`;
    const a = await post({ ...INPUT, line: line(1) }, "203.0.113.1");
    expect(a.status).toBe(202);
    const first = (await a.json()) as { id: string; state: string; cached: boolean };
    expect(first.cached).toBe(false);

    const again = await post({ ...INPUT, line: line(2) }, "203.0.113.1");
    expect(again.status).toBe(429);
    expect(await again.json()).toMatchObject({ error: "visitor_limit" });

    expect((await post({ ...INPUT, line: line(3) }, "203.0.113.2")).status).toBe(202);
    expect((await post({ ...INPUT, line: line(4) }, "203.0.113.3")).status).toBe(202);
    const fourth = await post({ ...INPUT, line: line(5) }, "203.0.113.4");
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({ error: "daily_limit", message: "Today's 3 new searches are used. Stored searches still open." });

    // The same line, stage and country (spacing and case aside) opens the stored search.
    const reused = await post({ ...INPUT, line: `  ${line(1).toUpperCase()}. ` }, "203.0.113.9");
    expect(reused.status).toBe(202);
    expect(await reused.json()).toMatchObject({ id: first.id, cached: true });
  });

  it("closes new searches at the spend stop, counting open runs at their budget", async () => {
    await recordSpend(env.DB, "dataset_run", 3.5, "earlier");
    const open = await newSearch();
    await advance(env, open, at(0));
    // 3.50 spent + 3 for the open run + 3 for a new one is past 9.
    const res = await post({ ...INPUT, line: "Inventory counting app for hospital kitchens" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "spend_stop",
      message: "New searches are closed: this demo has spent its budget. Stored searches still open.",
    });
    const stats = (await (await callWorker("/api/stats")).json()) as { limits: { new_searches_open: boolean } };
    expect(stats.limits.new_searches_open).toBe(false);
  });

  it("fails a queued search when the stop is reached before it starts", async () => {
    const id = await newSearch();
    await recordSpend(env.DB, "dataset_run", 6.5, "earlier");
    expect(await advance(env, id, at(0))).toMatchObject({ state: "failed", did: ["failed:spend_stop"] });
    expect(tf.creates).toBe(0);
  });
});

describe("reading", () => {
  it("answers a search at once and a missing one with 404", async () => {
    const id = await newSearch();
    const res = await callWorker(`/api/searches/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ search: { id, line: INPUT.line, stage: "seed" }, figures: { found: 0 } });
    expect((await callWorker("/api/searches/nope")).status).toBe(404);
  });
});

describe("the minute job", () => {
  it("deletes public searches past their time with their companies, and keeps demo searches", async () => {
    const id = await newSearch();
    tf.rows = [ROW_A];
    tf.status = "ready";
    tf.runStatus = "done";
    await advance(env, id, at(0));
    await advance(env, id, at(11));
    const kept = await importSearch(env, DATASET_ID, { ...INPUT, line: "A kept demo search about school kitchens" }, 2, T0);
    await env.DB.prepare("UPDATE searches SET origin = 'public', expires_at = ? WHERE id IN (?, ?)").bind(at(60).toISOString(), id, kept).run();
    await advance(env, kept, at(1));

    const out = await runCron(env, at(120));
    expect(out.expired).toBe(1);
    expect(await searchRow(id)).toBe(null);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM companies WHERE search_id = ?").bind(id).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM company_investors WHERE search_id = ?").bind(id).first()).toEqual({ n: 0 });
    expect((await searchRow(kept))?.state).toBe("ready");
  });

  it("moves unfinished searches forward", async () => {
    const id = await newSearch();
    const out = await runCron(env, at(0));
    expect(out.advanced).toBe(1);
    expect((await searchRow(id))?.state).toBe("finding");
  });
});
