// The pages: the switch, the form, the states of a search's page, and the line escaped on output.
// Every company, investor and person is invented.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { advance } from "../src/search/advance";
import { importSearch, startAdminSearch } from "../src/search/create";
import { callWorker } from "./helpers/app";
import { fetchMock } from "./helpers/fetch-mock";
import { companyRow, DATASET_ID, fakeTinyFish, type FakeTinyFish } from "./helpers/tinyset";

const T0 = new Date("2026-11-09T10:00:00.000Z");
const INPUT = { line: "Pantry planning software for school kitchens", stage: "seed" as const, country: "United Kingdom" as const };
const URL_A = "https://news.example/larder-loop-seed";

let tf: FakeTinyFish;
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM searches"),
    env.DB.prepare("DELETE FROM investors"),
    env.DB.prepare("DELETE FROM public_use"),
    env.DB.prepare("DELETE FROM spend"),
    env.DB.prepare("UPDATE run_slot SET search_id = NULL, since = NULL"),
  ]);
  fetchMock.activate();
  tf = fakeTinyFish();
});
afterEach(() => fetchMock.reset());

async function readySearch(): Promise<string> {
  tf.status = "ready";
  tf.runStatus = "done";
  tf.rows = [
    companyRow("row-a", {
      company: "Larder Loop",
      round_type: "Seed",
      announcement_date: "2026-06-12",
      lead_investor: "Copperline Ventures",
      founders: "Mira Odhiambo",
      announcement_url: URL_A,
    }),
  ];
  tf.pages[URL_A] = "Larder Loop raised a $3M seed round led by Copperline Ventures. Larder Loop was founded by Mira Odhiambo.";
  const id = await importSearch(env, DATASET_ID, INPUT, 1, T0);
  await advance(env, id, T0);
  return id;
}

const page = async (path: string, init?: RequestInit) => {
  const res = await callWorker(path, init);
  return { res, html: await res.text() };
};

describe("the site", () => {
  it("answers nothing while it is switched off", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://backed.test/"), { ...env, SITE_ENABLED: "0" }, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("serves the home with the form, its security headers, and no stored search yet", async () => {
    const { res, html } = await page("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("style-src 'self' https://api.fontshare.com");
    expect(html).toContain('<form class="stage" method="post" action="/search"');
    expect(html).toContain('name="stage"');
    // One script, from this site, and the page works without it: it shows a pressed button working.
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('<script src="/assets/wait.js" defer=""></script>');
    expect(html).toMatch(/<button class="go" type="submit" data-busy="Starting the search…">\s*Find who backed companies like this\s*<\/button>/);
  });

  it("shows the featured search on the home: its line in the form, its first investor and the quote marked", async () => {
    await readySearch();
    const { html } = await page("/");
    expect(html).toContain(INPUT.line);
    expect(html).toContain("Copperline Ventures");
    expect(html).toContain("<mark>Copperline Ventures</mark>");
    expect(html).toContain("You led Larder Loop&#39;s seed round in June 2026");
  });

  it("leads from the home to how it works and the score, and names them in every page's menu", async () => {
    await readySearch();
    const home = (await page("/")).html;
    expect(home).toContain('<a href="/about">One match followed through');
    expect(home).toContain('<a href="/score">How the order is set</a>');
    expect(home).toContain('<a href="#how">How it works</a>');
    for (const path of ["/about", "/score", "/api", "/searches"]) {
      const { res, html } = await page(path);
      expect(res.status).toBe(200);
      expect(html).toContain('<a href="/about">How it works</a>');
      expect(html).toContain('<a href="/score">The score</a>');
      // The one script is the site's own; nothing is inline and nothing comes from another host.
      expect(html.match(/<script[^>]*>/g)).toEqual(['<script src="/assets/wait.js" defer="">']);
    }
  });

  it("says how it works: the four TinyFish services with the ledger's figures, and one match followed through", async () => {
    await readySearch();
    const { html } = await page("/about");
    for (const name of ["TinySet", "Fetch", "Search", "Monitor"]) expect(html).toContain(`<h3>${name}</h3>`);
    expect(html).toContain("<span>search stored, free to open</span>");
    expect(html).toContain("One match, followed from TinySet&#39;s row to its points");
    expect(html).toContain("Lead investor: Copperline Ventures.");
    expect(html).toContain("<mark>Copperline Ventures</mark>");
    expect(html).toContain("backed it <b>3</b>");
  });

  it("counts one investor out on the score's page, and shows a real answer on the API's", async () => {
    const id = await readySearch();
    const score = (await page("/score")).html;
    expect(score).toContain("A sum you can check.");
    expect(score).toContain("counted out");
    expect(score).toContain(`/searches/${id}/investors/copperline-ventures`);
    const api = (await page("/api")).html;
    expect(api).toContain(`/api/searches/${id}`);
    expect(api).toContain("&quot;name&quot;: &quot;Copperline Ventures&quot;");
    expect(api).toContain("&quot;points&quot;");
  });

  it("lists each saved search as a band with its figures, and says so when there is none", async () => {
    expect((await page("/searches")).html).toContain("No search has finished yet.");
    const id = await readySearch();
    const { html } = await page("/searches");
    expect(html).toContain(`<a href="/searches/${id}">${INPUT.line}</a>`);
    expect(html).toContain("first <b>Copperline Ventures</b>");
    expect(html).toContain("1 company proved by its own announcement.");
  });

  it("shows the other pages with nothing stored yet", async () => {
    for (const path of ["/about", "/score", "/api"]) {
      const { res, html } = await page(path);
      expect(res.status).toBe(200);
      expect(html).not.toContain("undefined");
    }
  });

  it("keeps what was typed and says why when the form is refused", async () => {
    const body = new URLSearchParams({ line: "Too short", stage: "seed", country: "Kenya" });
    const { res, html } = await page("/search", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(res.status).toBe(400);
    expect(html).toContain("Say a little more");
    expect(html).toContain(">Too short</textarea>");
    expect(html).toContain('<option value="Kenya" selected="">Kenya</option>');
  });

  it("starts a search from the form and goes to its page", async () => {
    const body = new URLSearchParams({ line: INPUT.line, stage: "seed", country: "United Kingdom" });
    const res = await callWorker("/search", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "203.0.113.5" } });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^\/searches\/[a-z0-9]{12}$/);
  });

  it("shows a running search alive without script: a refresh, the companies so far, and the line escaped", async () => {
    const r = await startAdminSearch(env, { ...INPUT, line: "Tools for <b>school</b> kitchens & canteens" }, null, T0);
    if (!r.ok) throw new Error(r.error);
    await advance(env, r.id, T0);
    tf.rows = [companyRow("row-a", { company: "Larder Loop", round_type: "Seed", announcement_date: "2026-06-12", lead_investor: "Copperline Ventures", announcement_url: URL_A })];
    tf.pages[URL_A] = "Larder Loop raised a seed round led by Copperline Ventures.";
    await advance(env, r.id, new Date(T0.getTime() + 11_000));
    const { html } = await page(`/searches/${r.id}`);
    expect(html).toContain('<meta http-equiv="refresh" content="5"/>');
    expect(html).toContain("Tools for &lt;b&gt;school&lt;/b&gt; kitchens &amp; canteens");
    expect(html).not.toContain("<b>school</b>");
    expect(html).toContain("Proved: led by Copperline Ventures");
  });

  it("shows a running search working: its steps, how far it is, a clock, and how long a search takes", async () => {
    const now = new Date();
    const r = await startAdminSearch(env, INPUT, null, now);
    if (!r.ok) throw new Error(r.error);
    const set = (sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).run();
    const steps = (html: string) => /<ol class="wait-steps"[^>]*>([\s\S]*?)<\/ol>/.exec(html)?.[1] ?? "";

    // Waiting its turn: no step has begun, and the bar only says the page is alive.
    const queued = (await page(`/searches/${r.id}`)).html;
    expect(steps(queued)).toBe("<li>Find companies</li><li>Check announcements</li><li>Rank investors</li>");
    expect(queued).toContain('<div class="bar" role="progressbar" aria-label="Waiting its turn"></div>');

    // Finding: the bar is how many companies TinySet has found of the 30 it looks for.
    await advance(env, r.id, now);
    tf.rows = [companyRow("row-a", { company: "Larder Loop", round_type: "Seed", announcement_date: "2026-06-12", lead_investor: "Copperline Ventures", announcement_url: URL_A })];
    tf.pages[URL_A] = "Larder Loop raised a seed round led by Copperline Ventures.";
    await advance(env, r.id, new Date(now.getTime() + 11_000));
    await set("UPDATE searches SET created_at = ? WHERE id = ?", new Date(Date.now() - 9.5 * 60_000).toISOString(), r.id);
    const finding = (await page(`/searches/${r.id}`)).html;
    expect(steps(finding)).toBe('<li aria-current="step">Find companies</li><li>Check announcements</li><li>Rank investors</li>');
    expect(finding).toContain('<progress class="meter" value="1" max="30">1 of 30</progress>');
    expect(finding).toContain("1 of up to 30 companies found.");
    expect(finding).toMatch(/<span class="clock" data-since="[^"]+">9:3\d<\/span> so far\. A search usually takes 5 to 20 minutes\./);
    expect(finding).toContain("TinySet is searching the live web for up to 30 companies like this");

    // Checking: the bar is how many announcements are read of those found.
    await set("UPDATE searches SET state = 'checking' WHERE id = ?", r.id);
    await set("UPDATE companies SET state = 'unchecked' WHERE search_id = ?", r.id);
    const checking = (await page(`/searches/${r.id}`)).html;
    expect(steps(checking)).toBe('<li class="done">Find companies</li><li aria-current="step">Check announcements</li><li>Rank investors</li>');
    expect(checking).toContain('<progress class="meter" value="0" max="1">0 of 1</progress>');
    expect(checking).toContain("0 of 1 announcements checked.");

    // Ranking: the last step has no count to show, so the bar only moves.
    await set("UPDATE searches SET state = 'ranking' WHERE id = ?", r.id);
    const ranking = (await page(`/searches/${r.id}`)).html;
    expect(steps(ranking)).toBe('<li class="done">Find companies</li><li class="done">Check announcements</li><li aria-current="step">Rank investors</li>');
    expect(ranking).toContain('<div class="bar" role="progressbar" aria-label="Ranking the investors"></div>');
  });

  it("shows a ready search in full with no refresh, and a failed one with its sentence", async () => {
    const id = await readySearch();
    const ready = await page(`/searches/${id}`);
    expect(ready.html).not.toContain('http-equiv="refresh"');
    // A finished search shows no steps, bar or clock.
    expect(ready.html).not.toContain('class="wait-steps"');
    expect(ready.html).not.toContain("data-since");
    expect(ready.html).toContain("Only 1 company like this was proved. The list is thin: read it as a start.");
    expect(ready.html).toContain("What TinySet was asked");
    expect(ready.html).not.toContain("None of these companies");
    // No proved company in the founder's country: the page says so above the list.
    await env.DB.prepare("UPDATE companies SET country = 'Germany' WHERE search_id = ?").bind(id).run();
    const elsewhere = await page(`/searches/${id}`);
    expect(elsewhere.html).toContain("None of these companies is in the United Kingdom. This list shows who funds companies like this elsewhere.");
    await env.DB.prepare("UPDATE searches SET state = 'failed', failed_reason = 'run_failed' WHERE id = ?").bind(id).run();
    const failed = await page(`/searches/${id}`);
    expect(failed.html).toContain("This search did not finish: TinySet stopped early and too few companies were proved. Nothing was ranked.");
  });

  it("writes stages as pre-seed, seed and Series A, and the footer for one saved search", async () => {
    tf.status = "ready";
    tf.runStatus = "done";
    tf.rows = [
      companyRow("row-b", { company: "Shelfcount", round_type: "Series A", announcement_date: "2026-03-01", lead_investor: "Copperline Ventures", announcement_url: URL_A }),
    ];
    tf.pages[URL_A] = "Shelfcount raised a $9M Series A round led by Copperline Ventures.";
    const id = await importSearch(env, DATASET_ID, { ...INPUT, stage: "series-a" }, 1, T0);
    await advance(env, id, T0);
    const { html } = await page(`/searches/${id}`);
    expect(html).toContain("Series A");
    expect(html).not.toMatch(/series a/);
    expect(html).toContain("One saved search is free to open, with every investor");
  });

  it("names who built it, with a link to his GitHub, in the footer of every page and on How it works", async () => {
    const credit = 'Built by <a href="https://github.com/HamdanEsmail" rel="author">Hamdan Esmail</a> for the TinyFish Funding Radar bounty.';
    for (const path of ["/", "/score", "/api", "/searches"]) {
      const { html } = await page(path);
      expect(html.split(credit).length - 1).toBe(1);
      expect(html).toContain('<meta name="author" content="Hamdan Esmail"/>');
    }
    const about = await page("/about");
    expect(about.html.split(credit).length - 1).toBe(2);
  });

  it("refuses a second search from the same visitor with its sentence", async () => {
    const post = (line: string) =>
      callWorker("/search", {
        method: "POST",
        body: new URLSearchParams({ line, stage: "seed", country: "Kenya" }),
        headers: { "content-type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "203.0.113.7" },
      });
    expect((await post("Cold storage for smallholder farmers in villages")).status).toBe(303);
    const second = await post("Solar dryers for mango farmers and their cooperatives");
    expect(second.status).toBe(429);
    expect(await second.text()).toContain("You have started today&#39;s search from here already.");
  });

  it("answers an unknown search with the not-found page", async () => {
    const { res, html } = await page("/searches/zzzzzzzzzzzz");
    expect(res.status).toBe(404);
    expect(html).toContain("Nothing is stored at this address.");
  });
});
