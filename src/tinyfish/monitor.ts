// TinyFish Monitor: a Topic (search) Monitor that re-runs one query on a schedule, used to watch a
// saved search for new rounds. Backed only ever touches the Monitors it created itself: it keeps
// their ids, and deletes by id.
import { PRICES } from "../core/limits";
import type { Env } from "../env";
import { readJson, TinyFishError, tinyfishFetch } from "./client";

const MONITORS_API = "https://agent.tinyfish.ai/v1/monitors";

const monitorUrl = (id: string) => `${MONITORS_API}/${encodeURIComponent(id)}`;

export type CreateTopicMonitorParams = {
  /** The search query the Monitor re-runs on its schedule. */
  query: string;
  name: string;
  scheduleCron: string;
  purpose: string;
  webhookUrl: string;
  /** Only results newer than this count as new. Default 1440 (one day). */
  recencyMinutes?: number;
  /** Results kept per run. Default 5. */
  resultLimit?: number;
};

/**
 * Creates a Topic Monitor. An empty first run is normal, so only the monitor id is required. The
 * first run is billed, so it records one `monitor_check` row; its ref is the Monitor's name.
 */
export async function createTopicMonitor(env: Env, p: CreateTopicMonitorParams): Promise<{ monitorId: string }> {
  const res = await tinyfishFetch(env, MONITORS_API, {
    method: "POST",
    body: JSON.stringify({
      type: "search",
      name: p.name,
      config: { query: p.query, recency_minutes: p.recencyMinutes ?? 1440, result_limit: p.resultLimit ?? 5 },
      schedule_cron: p.scheduleCron,
      purpose: p.purpose,
      webhook_url: p.webhookUrl,
    }),
    spend: { kind: "monitor_check", amountUsd: PRICES.monitor_check, ref: p.name },
  });
  const body = await readJson<{ monitor?: { id?: unknown } }>(res);
  const monitorId = typeof body.monitor?.id === "string" ? body.monitor.id : "";
  if (monitorId === "") {
    throw new TinyFishError(502, "no_monitor_id", "TinyFish answered 201 for the topic monitor but returned no monitor id");
  }
  return { monitorId };
}

/** A Monitor that is already gone (404) counts as deleted. */
export async function deleteMonitor(env: Env, id: string): Promise<void> {
  try {
    await tinyfishFetch(env, monitorUrl(id), { method: "DELETE" });
  } catch (err) {
    if (err instanceof TinyFishError && err.status === 404) return;
    throw err;
  }
}

export type MonitorSummary = { id: string; status: string; name: string | null };

/** Every Monitor on the account. Backed reads this only to check on the ids it holds. */
export async function listMonitors(env: Env): Promise<MonitorSummary[]> {
  const res = await tinyfishFetch(env, MONITORS_API, { method: "GET" });
  const body = await readJson<{ monitors?: unknown } | unknown[]>(res);
  const list = Array.isArray(body) ? body : (body as { monitors?: unknown }).monitors;
  if (!Array.isArray(list)) return [];
  const out: MonitorSummary[] = [];
  for (const m of list as Record<string, unknown>[]) {
    if (m === null || typeof m !== "object" || typeof m.id !== "string") continue;
    out.push({
      id: m.id,
      status: typeof m.status === "string" ? m.status : "unknown",
      name: typeof m.name === "string" ? m.name : null,
    });
  }
  return out;
}
