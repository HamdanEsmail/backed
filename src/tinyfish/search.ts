// TinySearch: ranked web results for a query. Used to find an investor's own site when the row
// gives none. Free, but each call appends a $0 ledger row.
import { PRICES, READ_TIMEOUT_MS } from "../core/limits";
import type { Env } from "../env";
import { readJson, tinyfishFetch } from "./client";

const SEARCH_API = "https://api.search.tinyfish.ai";
const SEARCH_PURPOSE = "find the official website of a venture capital firm or angel investor";

export type SearchHit = { url: string; title: string; snippet: string };

/** One search. Results without an address are skipped; a missing title or snippet becomes "". The
 *  ledger row's ref is "web", never the query. */
export async function searchWeb(env: Env, query: string): Promise<SearchHit[]> {
  const u = new URL(SEARCH_API);
  u.searchParams.set("query", query);
  u.searchParams.set("purpose", SEARCH_PURPOSE);

  const res = await tinyfishFetch(env, u.toString(), {
    method: "GET",
    // A search that runs out of time throws (a TimeoutError); the caller tries again later.
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    spend: { kind: "search", amountUsd: PRICES.search, ref: "web" },
  });
  // Shape: { query, results: [{ position, site_name, snippet, title, url, date? }], ... }
  const body = await readJson<{ results?: unknown }>(res);
  if (!Array.isArray(body.results)) return [];
  const hits: SearchHit[] = [];
  for (const r of body.results as unknown[]) {
    if (r === null || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.url !== "string" || o.url === "") continue;
    hits.push({
      url: o.url,
      title: typeof o.title === "string" ? o.title : "",
      snippet: typeof o.snippet === "string" ? o.snippet : "",
    });
  }
  return hits;
}
