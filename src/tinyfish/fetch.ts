// TinyFetch: one public page as markdown. Free, but each call still appends a $0 ledger row.
// Used to read every announcement (the proof check) and an investor's own site (the way in).
import { PRICES, READ_TIMEOUT_MS } from "../core/limits";
import type { Env } from "../env";
import { errorCodeOrNull, noteSpend, readJson, TinyFishError, tinyfishFetch } from "./client";

const FETCH_API = "https://api.fetch.tinyfish.ai";
/** TinyFetch is asked to give up on the page this much before the call itself is abandoned, so a
 *  slow page comes back as TinyFetch's own error while there is still time to receive it. */
const UPSTREAM_MARGIN_MS = 1_000;

export type FetchPageOptions = {
  /** The longest the read may take, in milliseconds. Default READ_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Also return the page's link addresses, in page order. */
  links?: boolean;
};

export type FetchPageResult =
  | { ok: true; text: string; title: string | null; finalUrl: string; links: string[] }
  | { ok: false; error: string; status?: number };

type FetchBody = {
  results?: { text?: unknown; title?: unknown; final_url?: unknown; links?: unknown }[];
  errors?: { error?: unknown }[];
};

// Only a short token (`bot_blocked`, `target_unreachable`) is kept. Upstream text of any other shape
// becomes `fetch_error`.
function errorText(entry: { error?: unknown } | undefined): string {
  const e = entry?.error;
  if (e !== null && typeof e === "object") return errorCodeOrNull((e as { code?: unknown }).code) ?? "fetch_error";
  return errorCodeOrNull(e) ?? "fetch_error";
}

// The abort reason is a DOMException, which is not an Error in every runtime: look at its name.
function isAbort(err: unknown): boolean {
  const name = err !== null && typeof err === "object" ? (err as { name?: unknown }).name : undefined;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Reads one page, always fresh (`ttl: 0`). It never throws for a page that cannot be read: a
 * per-URL failure comes back as `{ ok: false, error }` with TinyFetch's own code, a failed call as
 * its HTTP error code with `status`, and a read that ran out of time as `timeout`. The caller must
 * never treat a failed read as an empty page. Every call, whatever came of it, is one $0 ledger row,
 * so the ledger shows each read, the ones tried again included.
 */
export async function fetchPage(env: Env, url: string, opts: FetchPageOptions = {}): Promise<FetchPageResult> {
  const timeoutMs = opts.timeoutMs ?? READ_TIMEOUT_MS;
  let body: FetchBody;
  try {
    const res = await tinyfishFetch(env, FETCH_API, {
      method: "POST",
      body: JSON.stringify({
        urls: [url],
        format: "markdown",
        ttl: 0,
        per_url_timeout_ms: Math.max(1_000, timeoutMs - UPSTREAM_MARGIN_MS),
        ...(opts.links ? { links: true } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    body = await readJson<FetchBody>(res);
  } catch (err) {
    if (err instanceof TinyFishError) {
      await noteSpend(env, { kind: "fetch", amountUsd: PRICES.fetch, ref: url });
      return { ok: false, error: err.code, status: err.status };
    }
    if (isAbort(err)) {
      await noteSpend(env, { kind: "fetch", amountUsd: PRICES.fetch, ref: url });
      return { ok: false, error: "timeout" };
    }
    throw err;
  }
  await noteSpend(env, { kind: "fetch", amountUsd: PRICES.fetch, ref: url });

  if (body.errors && body.errors.length > 0) return { ok: false, error: errorText(body.errors[0]) };
  const first = body.results?.[0];
  if (!first || typeof first.text !== "string") return { ok: false, error: "no_result" };
  return {
    ok: true,
    text: first.text,
    title: typeof first.title === "string" ? first.title : null,
    finalUrl: typeof first.final_url === "string" && first.final_url !== "" ? first.final_url : url,
    links: Array.isArray(first.links) ? first.links.filter((l): l is string => typeof l === "string") : [],
  };
}
