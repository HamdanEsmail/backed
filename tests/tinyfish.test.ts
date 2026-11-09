// The wallet, TinyFetch and the shared client, against invented answers.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TinyFishError } from "../src/tinyfish/client";
import { fetchPage } from "../src/tinyfish/fetch";
import { readBalance } from "../src/tinyfish/wallet";
import { fetchMock } from "./helpers/fetch-mock";

const WALLET_API = "https://agent.tinyfish.ai/v1/wallet";
const FETCH_API = "https://api.fetch.tinyfish.ai";
const PAGE = "https://news.example/2026/10/larder-loop-raises-seed";

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

describe("readBalance", () => {
  it("reads the balance string as dollars and books a $0 read", async () => {
    fetchMock.intercept({ method: "GET", url: WALLET_API, reply: { json: { available_balance: "21.44", currency: "USD" } } });
    expect(await readBalance(env)).toBe(21.44);
    expect(await spendRows()).toEqual([{ kind: "wallet", amount_usd: 0, ref: "wallet" }]);
  });

  it("reads an overdrawn wallet as a negative amount", async () => {
    fetchMock.intercept({ method: "GET", url: WALLET_API, reply: { json: { available_balance: "-0.35", currency: "USD" } } });
    expect(await readBalance(env)).toBe(-0.35);
  });

  it.each([
    { available_balance: 21.44, currency: "USD" },
    { available_balance: "21,44", currency: "USD" },
    { available_balance: "", currency: "USD" },
    { available_balance: "21.44", currency: "EUR" },
    { currency: "USD" },
  ])("refuses a balance that is not a USD amount: %j", async (body) => {
    fetchMock.intercept({ method: "GET", url: WALLET_API, reply: { json: body } });
    const err = await readBalance(env).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TinyFishError);
    expect((err as TinyFishError).code).toBe("bad_wallet");
  });
});

describe("fetchPage", () => {
  it("asks for a fresh markdown read that gives up inside the time allowed", async () => {
    fetchMock.intercept({
      method: "POST",
      url: FETCH_API,
      reply: { json: { results: [{ text: "Larder Loop raised $4M.", title: "Larder Loop raises", final_url: `${PAGE}/` }] } },
    });
    const page = await fetchPage(env, PAGE);
    expect(fetchMock.calls[0]!.body).toEqual({ urls: [PAGE], format: "markdown", ttl: 0, per_url_timeout_ms: 14_000 });
    expect(page).toEqual({ ok: true, text: "Larder Loop raised $4M.", title: "Larder Loop raises", finalUrl: `${PAGE}/`, links: [] });
    expect(await spendRows()).toEqual([{ kind: "fetch", amount_usd: 0, ref: PAGE }]);
  });

  it("answers a page that could not be read with TinyFetch's own code", async () => {
    fetchMock.intercept({ method: "POST", url: FETCH_API, reply: { json: { results: [], errors: [{ url: PAGE, error: "bot_blocked" }] } } });
    expect(await fetchPage(env, PAGE)).toEqual({ ok: false, error: "bot_blocked" });
  });

  it("keeps no upstream sentence as an error", async () => {
    fetchMock.intercept({
      method: "POST",
      url: FETCH_API,
      reply: { json: { results: [], errors: [{ url: PAGE, error: "Could not load https://news.example/?token=abc" }] } },
    });
    expect(await fetchPage(env, PAGE)).toEqual({ ok: false, error: "fetch_error" });
  });

  it("answers a failed call with its status, without throwing, and books the call", async () => {
    fetchMock.intercept({ method: "POST", url: FETCH_API, reply: { status: 503, json: { error: { code: "SERVICE_BUSY" } } } });
    expect(await fetchPage(env, PAGE)).toEqual({ ok: false, error: "SERVICE_BUSY", status: 503 });
    expect(await spendRows()).toEqual([{ kind: "fetch", amount_usd: 0, ref: PAGE }]);
  });

  it("gives up when the read runs out of time", async () => {
    fetchMock.intercept({
      method: "POST",
      url: FETCH_API,
      // Never answers; only the abort ends it.
      reply: (req) =>
        new Promise<Response>((_, reject) => {
          req.signal.addEventListener("abort", () => reject(req.signal.reason));
        }),
    });
    const started = Date.now();
    expect(await fetchPage(env, PAGE, { timeoutMs: 50 })).toEqual({ ok: false, error: "timeout" });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await spendRows()).toEqual([{ kind: "fetch", amount_usd: 0, ref: PAGE }]);
  });
});
