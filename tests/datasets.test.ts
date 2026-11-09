// The TinySet client against invented answers in the shape of the real ones. Every company,
// investor and person here is made up.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_ROW_PAGES, TARGET_ROWS } from "../src/core/limits";
import { TinyFishError } from "../src/tinyfish/client";
import { cancelRun, createDataset, getDataset, listRows, type DatasetSpec } from "../src/tinyfish/datasets";
import { fetchMock } from "./helpers/fetch-mock";

const API = "https://agent.tinyfish.ai/v1/datasets";
const DATASET_ID = "0c7e3a52-6f1d-4b8e-9a40-1d2f3e4a5b6c";
const RUN_ID = "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const SPEC: DatasetSpec = {
  name: "Startups like a pantry planner for school kitchens",
  description: "Startups similar to this one: \"pantry planning software for school kitchens\".",
  columns: [
    { name: "company", label: "Company", type: "string", is_primary_key: true },
    { name: "website", label: "Website", type: "url", is_primary_key: false, is_unique: true },
    { name: "in_scope", label: "In scope", type: "boolean", is_primary_key: false },
  ],
  keep_when: { column: "in_scope" },
};

const datasetBody = (over: Record<string, unknown> = {}) => ({
  id: DATASET_ID,
  name: SPEC.name,
  spec: SPEC,
  status: "populating",
  target_rows: TARGET_ROWS,
  row_count: 0,
  run: { id: RUN_ID, status: "queued", started_at: "2026-11-09T10:00:00.000Z" },
  created_at: "2026-11-09T10:00:00.000Z",
  ...over,
});

const row = (id: string, company: string, extra: Record<string, unknown> = {}) => ({
  _id: id,
  data: { company, website: `https://${company.toLowerCase().replace(/\s+/g, "")}.example`, in_scope: true, ...extra },
});

type SpendRow = { kind: string; amount_usd: number; ref: string };
async function spendRows(): Promise<SpendRow[]> {
  const { results } = await env.DB.prepare("SELECT kind, amount_usd, ref FROM spend ORDER BY at, rowid").all<SpendRow>();
  return results;
}

beforeEach(async () => {
  fetchMock.activate();
  await env.DB.prepare("DELETE FROM spend").run();
});
afterEach(() => fetchMock.reset());

describe("createDataset", () => {
  it("sends the spec and the row target with the key, and books a $0 call under the new id", async () => {
    let apiKey: string | null = null;
    fetchMock.intercept({
      method: "POST",
      url: API,
      reply: (req) => {
        apiKey = req.headers.get("X-API-Key");
        return Response.json(datasetBody(), { status: 202 });
      },
    });

    const ds = await createDataset(env, SPEC, TARGET_ROWS);

    expect(fetchMock.calls[0]!.body).toEqual({ spec: SPEC, target_rows: 30 });
    expect(apiKey).toBe("test-tinyfish-key");
    expect(ds).toEqual({
      id: DATASET_ID,
      status: "populating",
      rowCount: 0,
      targetRows: 30,
      run: { id: RUN_ID, status: "queued", startedAt: "2026-11-09T10:00:00.000Z", finishedAt: null, error: null },
      spec: SPEC,
      createdAt: "2026-11-09T10:00:00.000Z",
    });
    expect(await spendRows()).toEqual([{ kind: "dataset", amount_usd: 0, ref: DATASET_ID }]);
  });

  it("throws a 429 at once, without waiting or trying again, and books nothing", async () => {
    fetchMock.intercept({
      method: "POST",
      url: API,
      reply: { status: 429, json: { error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many runs in progress" } } },
      times: 5,
    });
    const err = await createDataset(env, SPEC, TARGET_ROWS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TinyFishError);
    expect((err as TinyFishError).code).toBe("RATE_LIMIT_EXCEEDED");
    expect(fetchMock.calls).toHaveLength(1);
    expect(await spendRows()).toEqual([]);
  });

  it("still books the call when a 2xx carries no dataset id", async () => {
    fetchMock.intercept({ method: "POST", url: API, reply: { status: 202, json: { status: "populating" } } });
    const err = await createDataset(env, SPEC, TARGET_ROWS).catch((e: unknown) => e);
    expect((err as TinyFishError).code).toBe("bad_dataset");
    expect(await spendRows()).toEqual([{ kind: "dataset", amount_usd: 0, ref: "create" }]);
  });
});

describe("getDataset", () => {
  it("reads a run in progress", async () => {
    fetchMock.intercept({
      method: "GET",
      url: `${API}/${DATASET_ID}`,
      reply: { json: datasetBody({ row_count: 7, run: { id: RUN_ID, status: "running", started_at: "2026-11-09T10:00:00.000Z" } }) },
    });
    const ds = await getDataset(env, DATASET_ID);
    expect(ds.status).toBe("populating");
    expect(ds.rowCount).toBe(7);
    expect(ds.run).toMatchObject({ status: "running", finishedAt: null, error: null });
    expect(await spendRows()).toEqual([{ kind: "dataset", amount_usd: 0, ref: DATASET_ID }]);
  });

  it("reads a failed run as a short code, never the upstream sentence", async () => {
    fetchMock.intercept({
      method: "GET",
      url: `${API}/${DATASET_ID}`,
      reply: {
        json: datasetBody({
          status: "failed",
          run: {
            id: RUN_ID,
            status: "failed",
            started_at: "2026-11-09T10:00:00.000Z",
            finished_at: "2026-11-09T10:04:00.000Z",
            error: { code: "SOURCES_EXHAUSTED", message: "Could not find rows for https://example.test/?q=secret" },
          },
        }),
      },
    });
    const ds = await getDataset(env, DATASET_ID);
    expect(ds.status).toBe("failed");
    expect(ds.run).toMatchObject({ status: "failed", finishedAt: "2026-11-09T10:04:00.000Z", error: "SOURCES_EXHAUSTED" });

    fetchMock.intercept({
      method: "GET",
      url: `${API}/${DATASET_ID}`,
      reply: { json: datasetBody({ status: "failed", run: { id: RUN_ID, status: "failed", error: "The run stopped: no sources answered." } }) },
    });
    expect((await getDataset(env, DATASET_ID)).run?.error).toBe("run_failed");

    fetchMock.intercept({
      method: "GET",
      url: `${API}/${DATASET_ID}`,
      reply: { json: datasetBody({ status: "failed", run: { id: RUN_ID, status: "failed" } }) },
    });
    expect((await getDataset(env, DATASET_ID)).run?.error).toBe("run_failed");
  });

  it("names a status it does not know `unknown` rather than trusting it", async () => {
    fetchMock.intercept({
      method: "GET",
      url: `${API}/${DATASET_ID}`,
      reply: { json: datasetBody({ status: "archived", run: { id: RUN_ID, status: "paused" } }) },
    });
    const ds = await getDataset(env, DATASET_ID);
    expect(ds.status).toBe("unknown");
    expect(ds.run?.status).toBe("unknown");
  });

  it("reads a dataset that never ran", async () => {
    fetchMock.intercept({ method: "GET", url: `${API}/${DATASET_ID}`, reply: { json: datasetBody({ status: "empty", run: null }) } });
    const ds = await getDataset(env, DATASET_ID);
    expect(ds).toMatchObject({ status: "empty", run: null });
  });
});

describe("listRows", () => {
  const rowsUrl = (after?: string) => `${API}/${DATASET_ID}/rows?limit=500${after ? `&after=${after}` : ""}`;

  it("reads rows across two pages, keeps a row met twice once (as last read), and skips rows without an id", async () => {
    fetchMock.intercept({
      method: "GET",
      url: rowsUrl(),
      reply: {
        json: {
          columns: [],
          rows: [
            row("r-1", "Larder Loop"),
            row("r-2", "Pantrywise", { lead_investor: null }),
            { data: { company: "No Id Foods" } },
            { _id: "r-x", data: null },
          ],
          truncated: true,
          next_cursor: "c-page-2",
        },
      },
    });
    fetchMock.intercept({
      method: "GET",
      url: rowsUrl("c-page-2"),
      reply: {
        json: {
          columns: [],
          rows: [row("r-2", "Pantrywise", { lead_investor: "Copperline Ventures" }), row("r-3", "Shelfcount")],
          truncated: false,
          next_cursor: null,
        },
      },
    });

    const { rows, complete } = await listRows(env, DATASET_ID);

    expect(complete).toBe(true);
    expect(rows.map((r) => r.id)).toEqual(["r-1", "r-2", "r-3"]);
    expect(rows[1]!.data.lead_investor).toBe("Copperline Ventures");
    expect(await spendRows()).toEqual([
      { kind: "dataset", amount_usd: 0, ref: DATASET_ID },
      { kind: "dataset", amount_usd: 0, ref: DATASET_ID },
    ]);
  });

  it("stops after the page cap and says the list is not complete", async () => {
    fetchMock.intercept({
      method: "GET",
      url: new RegExp(`^${API}/${DATASET_ID}/rows\\?`),
      reply: () => Response.json({ columns: [], rows: [row(crypto.randomUUID(), "Again")], truncated: true, next_cursor: "more" }),
      times: Infinity,
    });
    const { rows, complete } = await listRows(env, DATASET_ID);
    expect(complete).toBe(false);
    expect(fetchMock.calls).toHaveLength(MAX_ROW_PAGES);
    expect(rows).toHaveLength(MAX_ROW_PAGES);
  });

  it("reads an empty first page as no rows", async () => {
    fetchMock.intercept({ method: "GET", url: rowsUrl(), reply: { json: { columns: [], rows: [], truncated: false, next_cursor: null } } });
    expect(await listRows(env, DATASET_ID)).toEqual({ rows: [], complete: true });
  });
});

describe("cancelRun", () => {
  it("posts to the run's cancel address and answers its status", async () => {
    fetchMock.intercept({
      method: "POST",
      url: `${API}/${DATASET_ID}/runs/${RUN_ID}/cancel`,
      reply: { json: { run_id: RUN_ID, status: "cancelling" } },
    });
    expect(await cancelRun(env, DATASET_ID, RUN_ID)).toBe("cancelling");
    expect(await spendRows()).toEqual([{ kind: "dataset", amount_usd: 0, ref: DATASET_ID }]);
  });
});
