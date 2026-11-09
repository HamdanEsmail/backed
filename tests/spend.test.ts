import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSpend, spendByKind, totalSpend } from "../src/core/spend";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM spend").run();
});

describe("the spend ledger", () => {
  it("appends one row per call with an id and a time", async () => {
    await recordSpend(env.DB, "fetch", 0, "https://news.example/a");
    const { results } = await env.DB.prepare("SELECT id, kind, amount_usd, ref, at FROM spend").all<{
      id: string;
      kind: string;
      amount_usd: number;
      ref: string;
      at: string;
    }>();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: "fetch", amount_usd: 0, ref: "https://news.example/a" });
    expect(results[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(results[0]!.at).toISOString()).toBe(results[0]!.at);
  });

  it("sums every row, free calls and run costs alike", async () => {
    expect(await totalSpend(env.DB)).toBe(0);
    await recordSpend(env.DB, "dataset", 0, "ds-1");
    await recordSpend(env.DB, "dataset_run", 0.8, "search-1");
    await recordSpend(env.DB, "dataset_run", 1.05, "search-2");
    await recordSpend(env.DB, "monitor_check", 0.005, "watch-1");
    expect(await totalSpend(env.DB)).toBeCloseTo(1.855, 10);
  });

  it("gives dollars and rows for every kind, zero for kinds with none", async () => {
    expect(await spendByKind(env.DB)).toEqual({
      dataset: { usd: 0, rows: 0 },
      dataset_run: { usd: 0, rows: 0 },
      fetch: { usd: 0, rows: 0 },
      search: { usd: 0, rows: 0 },
      monitor_check: { usd: 0, rows: 0 },
      wallet: { usd: 0, rows: 0 },
      correction: { usd: 0, rows: 0 },
    });
    await recordSpend(env.DB, "fetch", 0, "a");
    await recordSpend(env.DB, "fetch", 0, "b");
    await recordSpend(env.DB, "dataset_run", 0.4, "search-1");
    const by = await spendByKind(env.DB);
    expect(by.fetch).toEqual({ usd: 0, rows: 2 });
    expect(by.dataset_run).toEqual({ usd: 0.4, rows: 1 });
    expect(by.search).toEqual({ usd: 0, rows: 0 });
  });

  it("refuses a negative or non-numeric amount", async () => {
    await expect(recordSpend(env.DB, "dataset_run", -1, "x")).rejects.toThrow();
    await expect(recordSpend(env.DB, "dataset_run", Number.NaN, "x")).rejects.toThrow();
    expect(await totalSpend(env.DB)).toBe(0);
  });
});
