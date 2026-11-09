import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { visitorHash } from "../src/auth";
import worker from "../src/index";
import { callWorker } from "./helpers/app";

const ping = (headers?: Record<string, string>) => callWorker("/api/admin/ping", { method: "POST", headers });

describe("the Worker", () => {
  it("runs with the fixed test bindings, never the real TinyFish key", () => {
    expect(env.TINYFISH_API_KEY === "test-tinyfish-key").toBe(true);
    expect(env.ADMIN_TOKEN).toBe("test-admin");
    expect(env.PUBLIC_BASE_URL).toBe("https://backed.test");
  });

  it("has the schema, with the run slot free", async () => {
    const slot = await env.DB.prepare("SELECT id, search_id, since FROM run_slot").all();
    expect(slot.results).toEqual([{ id: 1, search_id: null, since: null }]);
  });

  it("answers an unknown API path with a JSON 404", async () => {
    const res = await callWorker("/api/nowhere");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("runs the minute job without error", async () => {
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "* * * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);
  });
});

describe("admin token", () => {
  it("refuses no token, a wrong one, a prefix, an extension and the wrong scheme", async () => {
    for (const headers of [
      undefined,
      { Authorization: "Bearer wrong-token" },
      { Authorization: "Bearer test-admi" },
      { Authorization: "Bearer test-admin-extra" },
      { Authorization: "Bearer " },
      { Authorization: "test-admin" },
      { Authorization: "Basic test-admin" },
    ]) {
      const res = await ping(headers);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "admin_required" });
    }
  });

  it("accepts the right token", async () => {
    const res = await ping({ Authorization: "Bearer test-admin" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("visitor hash", () => {
  it("is stable for an address, differs between addresses, and never holds the address", async () => {
    const a = await visitorHash(env, "203.0.113.7");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await visitorHash(env, "203.0.113.7")).toBe(a);
    expect(await visitorHash(env, "203.0.113.8")).not.toBe(a);
    expect(a).not.toContain("203.0.113.7");
    expect(await visitorHash(env, undefined)).toBe(await visitorHash(env, ""));
  });
});
