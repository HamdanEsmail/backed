// The one place every TinyFish HTTP call goes through. It adds the API key, records spend after a
// 2xx, and turns a non-2xx into a TinyFishError. The key is read here and nowhere else, and never
// appears in an error or a log.
import { recordSpend, type SpendKind } from "../core/spend";
import type { Env } from "../env";

export class TinyFishError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "TinyFishError";
    this.status = status;
    this.code = code;
  }
}

export type SpendNote = { kind: SpendKind; amountUsd: number; ref: string };

/** An upstream error code is a short token. Anything else (a sentence that echoes our request, a
 *  webhook address with its secret) is not trusted and never reaches a code, a message or a log. */
const ERROR_CODE_SHAPE = /^[A-Za-z0-9_.-]{1,64}$/;

/** `value` when it is a string in the shape of an error code, else null. */
export function errorCodeOrNull(value: unknown): string | null {
  return typeof value === "string" && ERROR_CODE_SHAPE.test(value) ? value : null;
}

function pickString(...values: unknown[]): string | null {
  for (const v of values) if (typeof v === "string" && v !== "") return v;
  return null;
}

// Reads an error response tolerantly: JSON with `error.code` or `code` in the shape of a code, else
// `http_<status>`. The message carries the status and the code and nothing else from the response.
async function errorFrom(res: Response): Promise<TinyFishError> {
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON: there is no code in it
  }
  const obj = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const inner = obj.error !== null && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : {};
  const code = errorCodeOrNull(pickString(inner.code, obj.code)) ?? `http_${res.status}`;
  return new TinyFishError(res.status, code, `TinyFish HTTP ${res.status} ${code}`);
}

/** Reads a 2xx body as JSON. A body that is not JSON becomes a TinyFishError `bad_json`; nothing
 *  from the body is carried into the error. */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new TinyFishError(res.status, "bad_json", `TinyFish HTTP ${res.status} bad_json`);
  }
}

/** Appends a ledger row for a call that succeeded. A failed write must not lose the response (a
 *  2xx may have created something), so it is logged by kind only and swallowed. */
export async function noteSpend(env: Env, note: SpendNote): Promise<void> {
  try {
    await recordSpend(env.DB, note.kind, note.amountUsd, note.ref);
  } catch {
    console.error("spend write failed", note.kind);
  }
}

export type TinyFishInit = RequestInit & {
  /** Appended to the spend ledger after a 2xx. */
  spend?: SpendNote;
};

/**
 * One call. A 429 is thrown like any other error: nothing here waits and retries, because a
 * Worker request must stay short. The caller tries again on its next turn.
 */
export async function tinyfishFetch(env: Env, url: string, init: TinyFishInit = {}): Promise<Response> {
  const { spend, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("X-API-Key", env.TINYFISH_API_KEY);
  headers.set("Content-Type", "application/json");

  const res = await fetch(url, { ...rest, headers });
  if (!res.ok) throw await errorFrom(res);
  if (spend) await noteSpend(env, spend);
  return res;
}
