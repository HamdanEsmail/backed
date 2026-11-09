// The exports and the other pages, on an invented search.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordSpend } from "../src/core/spend";
import { advance } from "../src/search/advance";
import { importSearch } from "../src/search/create";
import { CSV_COLUMNS, csvCell } from "../src/search/exports";
import { callWorker } from "./helpers/app";
import { fetchMock } from "./helpers/fetch-mock";
import { companyRow, DATASET_ID, fakeTinyFish, type FakeTinyFish } from "./helpers/tinyset";

const T0 = new Date("2026-11-09T10:00:00.000Z");
const INPUT = { line: "Pantry planning software for school kitchens", stage: "seed" as const, country: "United Kingdom" as const };
const URL_A = "https://news.example/larder-loop-seed";
const URL_B = "https://news.example/shelfcount-series-a";

let tf: FakeTinyFish;
let id: string;
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM searches"),
    env.DB.prepare("DELETE FROM investors"),
    env.DB.prepare("DELETE FROM spend"),
    env.DB.prepare("UPDATE run_slot SET search_id = NULL, since = NULL"),
  ]);
  fetchMock.activate();
  tf = fakeTinyFish();
  tf.status = "ready";
  tf.runStatus = "done";
  tf.rows = [
    companyRow("row-a", { company: "Larder Loop", round_type: "Seed", announcement_date: "2026-06-12", lead_investor: "Copperline Ventures", other_investors: "=Northgate", founders: "Mira Odhiambo", announcement_url: URL_A }),
    companyRow("row-b", { company: "Shelfcount", round_type: "Series A", amount_raised: 9_000_000, announcement_date: "2025-09-01", lead_investor: "Northgate", other_investors: "Copperline Ventures", announcement_url: URL_B }),
  ];
  tf.pages[URL_A] = 'Larder Loop raised a $3M seed round led by Copperline Ventures, with "=Northgate" joining. Larder Loop was founded by Mira Odhiambo.';
  tf.pages[URL_B] = "Shelfcount closed a $9M Series A round led by Northgate, and Copperline Ventures joined the round.";
  id = await importSearch(env, DATASET_ID, INPUT, 1, T0);
  await advance(env, id, T0);
});
afterEach(() => fetchMock.reset());

/** Splits one CSV line, honouring quotes. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") out.push(cur), (cur = "");
    else cur += ch;
  }
  out.push(cur);
  return out;
}

describe("the CSV export", () => {
  it("quotes what needs quoting and keeps a formula as text", () => {
    expect(csvCell('He said "led", then left')).toBe('"He said ""led"", then left"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-1 + 2")).toBe("'-1 + 2");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(null)).toBe("");
  });

  it("has one row per investor and company, with the quotation, the proof link, the read time and the points", async () => {
    const res = await callWorker(`/api/searches/${id}.csv`);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    const rows = lines.slice(1).map(cells);
    expect(rows).toHaveLength(4);
    const col = (r: string[], name: (typeof CSV_COLUMNS)[number]) => r[CSV_COLUMNS.indexOf(name)];
    const first = rows.find((r) => col(r, "investor") === "Copperline Ventures" && col(r, "company") === "Larder Loop")!;
    expect(col(first, "round")).toBe("seed");
    expect(col(first, "proof_url")).toBe(URL_A);
    expect(col(first, "quotation")).toContain("led by Copperline Ventures");
    expect(col(first, "sum")).toBe("backed it 3 + led the round 2 + your stage 2 + your country 1 + in the last six months 1 = 9");
    expect(rows.some((r) => col(r, "round") === "Series A")).toBe(true);
    expect(rows.some((r) => col(r, "investor") === "'=Northgate")).toBe(true);
    // The site's own export is the same file.
    expect(await (await callWorker(`/searches/${id}.csv`)).text()).toBe(lines.join("\r\n") + "\r\n");
  });

  it("downloads the JSON export as the API gives it", async () => {
    const res = await callWorker(`/searches/${id}.json`);
    expect(res.headers.get("content-disposition")).toContain(`backed-${id}.json`);
    const api = await (await callWorker(`/api/searches/${id}`)).json();
    expect(await res.json()).toEqual(api);
  });
});

describe("the other pages", () => {
  it("shows an investor's sheet in full, and a 404 for an investor not in the search", async () => {
    const view = (await (await callWorker(`/api/searches/${id}`)).json()) as { investors: { slug: string; name: string }[] };
    const copper = view.investors.find((i) => i.name === "Copperline Ventures")!;
    const res = await callWorker(`/searches/${id}/investors/${copper.slug}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Rounds they joined here:</b> seed and Series A rounds of $3M to $9M.");
    expect(html).toContain("<mark>Copperline Ventures</mark>");
    expect((await callWorker(`/searches/${id}/investors/nobody`)).status).toBe(404);
  });

  it("lists the saved searches and gives absolute link-preview tags", async () => {
    const html = await (await callWorker("/searches")).text();
    expect(html).toContain(`href="/searches/${id}"`);
    expect(html).toContain('<meta property="og:image" content="https://backed.test/assets/social.png"/>');
    expect(html).toContain('<meta property="og:url" content="https://backed.test/searches"/>');
  });

  it("shows the spend from the ledger on the about page", async () => {
    await recordSpend(env.DB, "dataset_run", 0.8, "earlier");
    const html = await (await callWorker("/about")).text();
    expect(html).toContain("$0.80 spent");
  });

  it("serves the score and the API pages", async () => {
    expect((await callWorker("/score")).status).toBe(200);
    const api = await (await callWorker("/api")).text();
    expect(api).toContain(`https://backed.test/api/searches/${id}`);
  });
});
