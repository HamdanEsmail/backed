// A fake TinyFish for driving a search: one dataset whose status and rows a test changes between
// `advance` calls, a wallet, and announcement pages by address. Everything here is invented.
import { fetchMock } from "./fetch-mock";

export const DATASETS_API = "https://agent.tinyfish.ai/v1/datasets";
export const WALLET_API = "https://agent.tinyfish.ai/v1/wallet";
export const FETCH_API = "https://api.fetch.tinyfish.ai";
export const DATASET_ID = "0c7e3a52-6f1d-4b8e-9a40-1d2f3e4a5b6c";
export const RUN_ID = "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

export type FakeTinyFish = {
  status: string;
  runStatus: string;
  rows: { _id: string; data: Record<string, unknown> }[];
  /** Balances the wallet answers with, in order; the last one repeats. */
  wallet: string[];
  pages: Record<string, string>;
  /** Times each page was read. */
  reads: Record<string, number>;
  creates: number;
  cancels: number;
  spec: unknown;
};

export function fakeTinyFish(): FakeTinyFish {
  const tf: FakeTinyFish = {
    status: "populating",
    runStatus: "running",
    rows: [],
    wallet: ["10.00"],
    pages: {},
    reads: {},
    creates: 0,
    cancels: 0,
    spec: null,
  };
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
      return Response.json(dataset(), { status: 202 });
    },
  });
  fetchMock.intercept({
    method: "GET",
    url: new RegExp(`^${DATASETS_API}/${DATASET_ID}/rows\\?`),
    times: Infinity,
    reply: () => Response.json({ columns: [], rows: tf.rows, truncated: false, next_cursor: null }),
  });
  fetchMock.intercept({ method: "GET", url: `${DATASETS_API}/${DATASET_ID}`, times: Infinity, reply: () => Response.json(dataset()) });
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
      const text = tf.pages[url];
      return Response.json(text === undefined ? { results: [], errors: [{ url, error: "target_unreachable" }] } : { results: [{ text, final_url: url }] });
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
