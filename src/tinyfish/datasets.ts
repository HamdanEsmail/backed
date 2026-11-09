// TinySet (the Datasets API): describe the rows wanted as a spec, and TinySet fills the dataset
// from the web in the background. A run is paid for by the row; its cost is booked from the wallet
// when it ends (src/search), so each call here appends a $0 `dataset` ledger row.
//
// Shapes, as the API answers them: a dataset is { id, name, spec, status, target_rows, row_count,
// run: { id, status, started_at, finished_at?, error? } | null, created_at }. Rows are one page at a
// time: { columns, rows: [{ _id, data }], truncated, next_cursor }. Rows appear and change while a
// run is in progress: a row gains cells, two rows merge, a row is removed.
import { MAX_ROW_PAGES, PRICES } from "../core/limits";
import type { Env } from "../env";
import { errorCodeOrNull, noteSpend, readJson, TinyFishError, tinyfishFetch } from "./client";

const DATASETS_API = "https://agent.tinyfish.ai/v1/datasets";
const ROWS_PER_PAGE = 500;

export type ColumnType = "string" | "number" | "boolean" | "url" | "date";

export type SpecColumn = {
  name: string;
  label?: string;
  type: ColumnType;
  is_primary_key: boolean;
  retrieval_hint?: string;
  format?: string;
  examples?: string[];
  is_unique?: boolean;
};

export type DatasetSpec = {
  name: string;
  description: string;
  columns: SpecColumn[];
  /** Keep only rows where this boolean column is true. */
  keep_when?: { column: string };
};

export type DatasetStatus = "empty" | "populating" | "ready" | "failed" | "cancelled" | "unknown";
export type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled" | "unknown";

export type DatasetRun = {
  id: string;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  /** A short code when the run failed: TinySet's own when it is one, else `run_failed`. Never the
   *  upstream sentence. */
  error: string | null;
};

export type Dataset = {
  id: string;
  status: DatasetStatus;
  rowCount: number;
  targetRows: number | null;
  run: DatasetRun | null;
  /** The spec the dataset was made from, as TinySet holds it; null when the answer has none. */
  spec: DatasetSpec | null;
  createdAt: string | null;
};

export type DatasetRow = { id: string; data: Record<string, unknown> };

const DATASET_STATUSES: readonly DatasetStatus[] = ["empty", "populating", "ready", "failed", "cancelled"];
const RUN_STATUSES: readonly RunStatus[] = ["queued", "running", "done", "failed", "cancelled"];

const datasetUrl = (id: string) => `${DATASETS_API}/${encodeURIComponent(id)}`;

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function runError(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const code = value !== null && typeof value === "object" ? (value as { code?: unknown }).code : value;
  return errorCodeOrNull(code) ?? "run_failed";
}

function parseRun(value: unknown): DatasetRun | null {
  if (value === null || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const id = str(r.id);
  if (id === null) return null;
  const status = oneOf(r.status, RUN_STATUSES, "unknown");
  return {
    id,
    status,
    startedAt: str(r.started_at),
    finishedAt: str(r.finished_at),
    error: status === "failed" ? (runError(r.error) ?? "run_failed") : runError(r.error),
  };
}

/** Reads a dataset body. One without an id is not a dataset: `bad_dataset`. */
export function parseDataset(body: unknown): Dataset {
  const d = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const id = str(d.id);
  if (id === null) throw new TinyFishError(502, "bad_dataset", "TinyFish returned a dataset without an id");
  return {
    id,
    status: oneOf(d.status, DATASET_STATUSES, "unknown"),
    rowCount: typeof d.row_count === "number" && Number.isFinite(d.row_count) ? d.row_count : 0,
    targetRows: typeof d.target_rows === "number" && Number.isFinite(d.target_rows) ? d.target_rows : null,
    run: parseRun(d.run),
    spec: isSpec(d.spec) ? d.spec : null,
    createdAt: str(d.created_at),
  };
}

function isSpec(v: unknown): v is DatasetSpec {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.name === "string" && typeof s.description === "string" && Array.isArray(s.columns);
}

/**
 * Creates a dataset from `spec` and starts filling it to `targetRows` (TinySet answers 202). This
 * is the call that starts a paid run. The ledger row is written after the answer, so its ref is the
 * new dataset's id.
 */
export async function createDataset(env: Env, spec: DatasetSpec, targetRows: number): Promise<Dataset> {
  const res = await tinyfishFetch(env, DATASETS_API, {
    method: "POST",
    body: JSON.stringify({ spec, target_rows: targetRows }),
  });
  let dataset: Dataset;
  try {
    dataset = parseDataset(await readJson(res));
  } catch (err) {
    // A 2xx may have started a run even when its body cannot be read: the call still goes in the ledger.
    await noteSpend(env, { kind: "dataset", amountUsd: PRICES.dataset, ref: "create" });
    throw err;
  }
  await noteSpend(env, { kind: "dataset", amountUsd: PRICES.dataset, ref: dataset.id });
  return dataset;
}

/** The dataset's status, row count and latest run. */
export async function getDataset(env: Env, id: string): Promise<Dataset> {
  const res = await tinyfishFetch(env, datasetUrl(id), {
    method: "GET",
    spend: { kind: "dataset", amountUsd: PRICES.dataset, ref: id },
  });
  return parseDataset(await readJson(res));
}

/**
 * Every row of the dataset, page by page, at most MAX_ROW_PAGES pages. `complete` is false when
 * more rows were left unread. A row met twice (rows move while a run is in progress) is kept once,
 * as last read. Rows without an `_id` or without `data` are skipped.
 */
export async function listRows(env: Env, id: string): Promise<{ rows: DatasetRow[]; complete: boolean }> {
  const byId = new Map<string, DatasetRow>();
  let after: string | null = null;
  for (let page = 0; page < MAX_ROW_PAGES; page++) {
    const u = new URL(`${datasetUrl(id)}/rows`);
    u.searchParams.set("limit", String(ROWS_PER_PAGE));
    if (after !== null) u.searchParams.set("after", after);
    const res = await tinyfishFetch(env, u.toString(), {
      method: "GET",
      spend: { kind: "dataset", amountUsd: PRICES.dataset, ref: id },
    });
    const body = await readJson<{ rows?: unknown; truncated?: unknown; next_cursor?: unknown }>(res);
    if (Array.isArray(body.rows)) {
      for (const r of body.rows as unknown[]) {
        if (r === null || typeof r !== "object") continue;
        const row = r as { _id?: unknown; data?: unknown };
        const rowId = str(row._id);
        if (rowId === null || row.data === null || typeof row.data !== "object" || Array.isArray(row.data)) continue;
        byId.set(rowId, { id: rowId, data: row.data as Record<string, unknown> });
      }
    }
    after = str(body.next_cursor);
    if (body.truncated !== true || after === null) return { rows: [...byId.values()], complete: true };
  }
  return { rows: [...byId.values()], complete: false };
}

/** Asks TinySet to stop a run. Rows added before the cancel are kept. Answers the run's status as
 *  TinySet gives it (`cancelling` until it stops). */
export async function cancelRun(env: Env, datasetId: string, runId: string): Promise<string> {
  const res = await tinyfishFetch(env, `${datasetUrl(datasetId)}/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
    spend: { kind: "dataset", amountUsd: PRICES.dataset, ref: datasetId },
  });
  const body = await readJson<{ status?: unknown }>(res);
  return errorCodeOrNull(body.status) ?? "unknown";
}
