// A fake TinyFish for driving a search: one dataset whose status and rows a test changes between
// `advance` calls, a wallet, and announcement pages by address. Everything here is invented.
import { fetchMock } from "./fetch-mock";

export const DATASETS_API = "https://agent.tinyfish.ai/v1/datasets";
export const WALLET_API = "https://agent.tinyfish.ai/v1/wallet";
export const FETCH_API = "https://api.fetch.tinyfish.ai";
export const SEARCH_API = "https://api.search.tinyfish.ai/";
export const DATASET_ID = "0c7e3a52-6f1d-4b8e-9a40-1d2f3e4a5b6c";
export const RUN_ID = "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

export type FakeTinyFish = {
  status: string;
  runStatus: string;
  rows: { _id: string; data: Record<string, unknown> }[];
  /** Balances the wallet answers with, in order; the last one repeats. */
  wallet: string[];
  pages: Record<string, string>;
  /** Pages whose next read fails with this TinyFetch error code, once each. */
  failOnce: Record<string, string>;
  /** Links a page answers with, by address. */
  links: Record<string, string[]>;
  /** Search results by query. */
  results: Record<string, { url: string; title: string }[]>;
  queries: string[];
  /** Times each page was read. */
  reads: Record<string, number>;
  creates: number;
  cancels: number;
  spec: unknown;
  /** The next create answers this status with no dataset in it; `made` says whether TinySet made
   *  the dataset all the same. */
  createFails: { status: number; made: boolean } | null;
  /** The dataset is on the account's list: true after a create that made it. */
  listed: boolean;
  /** The dataset and its rows answer 404. */
  unreadable: boolean;
};

export function fakeTinyFish(): FakeTinyFish {
  const tf: FakeTinyFish = {
    status: "populating",
    runStatus: "running",
    rows: [],
    wallet: ["10.00"],
    pages: {},
    failOnce: {},
    links: {},
    results: {},
    queries: [],
    reads: {},
    creates: 0,
    cancels: 0,
    spec: null,
    createFails: null,
    listed: false,
    unreadable: false,
  };
  const gone = () => Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  const dataset = () => ({
    id: DATASET_ID,
    name: "Funding rounds",
    spec: tf.spec,
    status: tf.status,
    target_rows: 30,
    row_count: tf.rows.length,
    run: { id: RUN_ID, status: tf.runStatus, started_at: "2026-11-09T10:00:00.000Z" },
    created_at: "2026-11-09T10:00:00.000Z",
  });
  fetchMock.intercept({
    method: "GET",
    url: WALLET_API,
    times: Infinity,
    reply: () => Response.json({ available_balance: tf.wallet.length > 1 ? tf.wallet.shift() : tf.wallet[0], currency: "USD" }),
  });
  fetchMock.intercept({
    method: "POST",
    url: DATASETS_API,
    times: Infinity,
    reply: (_req, body) => {
      tf.creates++;
      tf.spec = (body as { spec: unknown }).spec;
      const failure = tf.createFails;
      if (failure !== null) {
        tf.createFails = null;
        tf.listed = failure.made;
        return new Response("upstream error", { status: failure.status });
      }
      tf.listed = true;
      return Response.json(dataset(), { status: 202 });
    },
  });
  fetchMock.intercept({
    method: "GET",
    url: new RegExp(`^${DATASETS_API}\\?`),
    times: Infinity,
    reply: () => Response.json({ data: tf.listed ? [dataset()] : [], pagination: { next_cursor: null, has_more: false } }),
  });
  fetchMock.intercept({
    method: "GET",
    url: new RegExp(`^${DATASETS_API}/${DATASET_ID}/rows\\?`),
    times: Infinity,
    reply: () => (tf.unreadable ? gone() : Response.json({ columns: [], rows: tf.rows, truncated: false, next_cursor: null })),
  });
  fetchMock.intercept({
    method: "GET",
    url: `${DATASETS_API}/${DATASET_ID}`,
    times: Infinity,
    reply: () => (tf.unreadable ? gone() : Response.json(dataset())),
  });
  fetchMock.intercept({
    method: "POST",
    url: `${DATASETS_API}/${DATASET_ID}/runs/${RUN_ID}/cancel`,
    times: Infinity,
    reply: () => {
      tf.cancels++;
      return Response.json({ run_id: RUN_ID, status: "cancelling" });
    },
  });
  fetchMock.intercept({
    method: "POST",
    url: FETCH_API,
    times: Infinity,
    reply: (_req, body) => {
      const url = (body as { urls: string[] }).urls[0]!;
      tf.reads[url] = (tf.reads[url] ?? 0) + 1;
      const failure = tf.failOnce[url];
      if (failure !== undefined) {
        delete tf.failOnce[url];
        return Response.json({ results: [], errors: [{ url, error: failure }] });
      }
      const text = tf.pages[url];
      return Response.json(
        text === undefined ? { results: [], errors: [{ url, error: "target_unreachable" }] } : { results: [{ text, final_url: url, links: tf.links[url] ?? [] }] },
      );
    },
  });
  fetchMock.intercept({
    method: "GET",
    url: new RegExp(`^${SEARCH_API.replace(/[.]/g, "\\.")}\\?`),
    times: Infinity,
    reply: (req) => {
      const q = new URL(req.url).searchParams.get("query") ?? "";
      tf.queries.push(q);
      return Response.json({ query: q, results: (tf.results[q] ?? []).map((r, i) => ({ position: i + 1, site_name: "", snippet: "", ...r })) });
    },
  });
  return tf;
}

/** A TinySet row for an invented company. */
export function companyRow(id: string, data: Record<string, unknown>) {
  return {
    _id: id,
    data: {
      website: `https://${id}.example`,
      country: "United Kingdom",
      description: "Software for school kitchens.",
      amount_raised: 3_000_000,
      lead_partner: null,
      founders: null,
      lead_investor_website: null,
      in_scope: true,
      ...data,
    },
  };
}
