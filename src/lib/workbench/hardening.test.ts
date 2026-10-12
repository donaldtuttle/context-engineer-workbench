/* Copyright (c) 2026 Donald Tuttle. All rights reserved. Proprietary. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadStored, saveStored, STORAGE_KEY_V1, STORAGE_KEY_V2 } from "./storage.ts";
import { packState } from "./pack.ts";
import { emptyState } from "./types.ts";
import { DEFAULT_LIMITS, MemoryQuotaStore, emptyBacking } from "./limits.ts";
import { billedTokens, sameSite, parsePaidCall, executePaidTurn } from "./paid-turn.ts";
import { readUsage } from "./grok-adapter.ts";
import { beginSend, commitResult, interpretImport } from "./session.ts";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

test("actual quota SQL holds concurrency across midnight and reconciles exactly once", async () => {
  const db = new PGlite();
  try {
    for (const name of ["0002_workbench_quota.sql", "0003_workbench_global_concurrency.sql"]) {
      await db.exec(readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
    }
    const reserve = async (day: string) => (await db.query<{ ok: boolean; reservation_id: string }>(
      "select * from workbench_reserve($1,$2,10,10,200,500000,1)", [day, day + ':minute'])).rows[0];
    const first = await reserve("2026-10-12");
    assert.equal(first.ok, true);
    assert.equal((await reserve("2026-10-13")).ok, false);
    await db.query("select workbench_reconcile($1,null)", [first.reservation_id]);
    await db.query("select workbench_reconcile($1,0)", [first.reservation_id]);
    const period = (await db.query<{ tokens: number; concurrency: number }>("select tokens, concurrency from workbench_quota_period where period='2026-10-12'")).rows[0];
    assert.equal(Number(period.tokens), 10);
    assert.equal(period.concurrency, 0);
    assert.equal((await reserve("2026-10-13")).ok, true);
  } finally { await db.close(); }
});

test("packed and legacy invalid nested values are preserved as corrupt", () => {
  for (const key of [STORAGE_KEY_V1, STORAGE_KEY_V2]) {
    const state = emptyState();
    const raw = JSON.stringify({ ...(key === STORAGE_KEY_V1 ? state : packState(state)), draft: { ...state.draft, text: null } });
    const found = loadStored({ getItem: (name) => name === key ? raw : null });
    assert.equal(found.status, "corrupt");
    if (found.status === "corrupt") assert.equal(found.raw, raw);
  }
  assert.equal(loadStored({ getItem: (key) => key === STORAGE_KEY_V2 ? "  " : null }).status, "corrupt");
});

test("serialization failures are surfaced rather than escaping the save boundary", () => {
  const state = emptyState();
  Object.defineProperty(state, "conversations", { get() { throw new Error("pack failed"); } });
  let writes = 0;
  const saved = saveStored({ getItem: () => null, setItem: () => { writes++; } }, state);
  assert.equal(saved.ok, false);
  assert.equal(writes, 0);
});

test("a valid v2 store does not require the obsolete legacy key to be readable", () => {
  const raw = JSON.stringify(packState(emptyState()));
  const loaded = loadStored({ getItem(key) { if (key === STORAGE_KEY_V1) throw new Error("obsolete read"); return raw; } });
  assert.equal(loaded.status, "ready");
});

test("concurrent requests on either side of midnight share one concurrency bound", async () => {
  const backing = emptyBacking();
  const first = new MemoryQuotaStore(backing);
  const second = new MemoryQuotaStore(backing);
  const limits = { ...DEFAULT_LIMITS, concurrency: 1 };
  const a = await first.reserve({ period: "2026-10-12", nowMs: 60_000, holdMs: 600_000, clientKey: "a", limits, tokens: 10 });
  assert.equal(a.ok, true);
  const b = await second.reserve({ period: "2026-10-13", nowMs: 120_000, holdMs: 600_000, clientKey: "b", limits, tokens: 10 });
  assert.equal(b.ok, false);
  if (!a.ok) return;
  await second.reconcile({ reservationId: a.reservation.id, actualTokens: null });
  assert.equal(backing.periods["2026-10-12"].tokens, 10);
  assert.equal((await second.reserve({ period: "2026-10-13", nowMs: 120_000, holdMs: 600_000, clientKey: "b", limits, tokens: 10 })).ok, true);
});

test("partial, negative, and unsafe usage cannot refund the reserved allowance", () => {
  assert.equal(billedTokens({ input_tokens: 1 }), null);
  assert.equal(billedTokens({ total_tokens: -2 }), null);
  assert.equal(billedTokens({ total_tokens: Number.MAX_SAFE_INTEGER + 1 }), null);
  assert.equal(readUsage({ prompt_tokens: -1, total_tokens: -2 }), null);
});

test("same-site rejects missing origin and protocol or authority confusion", () => {
  assert.equal(sameSite({ origin: null, host: "app.example" }), false);
  assert.equal(sameSite({ origin: "http://app.example", host: "app.example" }), false);
  assert.equal(sameSite({ origin: "https://user:pass@app.example", host: "app.example" }), false);
  assert.equal(sameSite({ origin: "https://app.example", host: "app.example" }), true);
});

test("the paid boundary rejects extra system messages and non-string hashes", async () => {
  const body = { model: "grok-4.5", messages: [{ role: "user", content: "hi" }], contextText: "", timeoutSeconds: 30, maxOutputTokens: 32, temperature: null, topP: null, seed: null };
  assert.ok("error" in await parsePaidCall({ ...body, contextSha256: 1 }));
  assert.ok("error" in await parsePaidCall({ ...body, messages: [{ role: "system", content: "hidden" }, ...body.messages] }));
});

test("an access refusal finalizes, saves, exports and imports without changing its hash", async () => {
  const state = emptyState();
  state.draft.provider = "grok";
  const began = await beginSend(state, "hello");
  assert.ok(began.ok);
  const result = await executePaidTurn({ data: {}, env: { enableFlag: "1", apiKey: "test-only", contextFloor: undefined, sharedStore: false }, fetchImpl: async () => { throw new Error("no network"); }, store: null, request: { origin: "https://app.example", host: "app.example" } });
  const ended = await commitResult(began.state, began.conversationId, began.turnId, result, new Date().toISOString());
  const turn = ended.conversations[0].turns[0];
  assert.equal(turn.executionStatus, "blocked");
  const disk = new Map<string, string>();
  assert.equal(saveStored({ getItem: (key) => disk.get(key) ?? null, setItem: (key, value) => { disk.set(key, value); } }, ended).ok, true);
  const restored = await interpretImport("turn.json", JSON.stringify(turn));
  assert.equal(restored.kind, "conversations");
  if (restored.kind === "conversations") assert.deepEqual(restored.conversations[0].turns[0], turn);
});

test("a timeout before completion releases the slot and a preflight refusal consumes no tokens", async () => {
  const token = "hardening-test-token-abcdefghijklmnopqrstuvwxyz";
  const data = { accessToken: token, model: "grok-4.5", messages: [{ role: "user", content: "hello" }], contextText: "", timeoutSeconds: 30, maxOutputTokens: 32, temperature: null, topP: null, seed: null };
  const env = { enableFlag: "1", apiKey: "fixture-key", contextFloor: undefined, accessToken: token, sharedStore: true, quota: { ok: true as const, limits: { ...DEFAULT_LIMITS, concurrency: 1 } } };
  const request = { origin: "https://app.example", host: "app.example" };
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls++; throw new DOMException("timeout", "TimeoutError"); };
  const store = new MemoryQuotaStore();
  const args = { data, env, request, store, fetchImpl, nowMs: Date.parse("2026-10-12T12:00:00Z") };
  assert.equal((await executePaidTurn(args)).executionStatus, "timeout");
  assert.equal(store.backing.periods["2026-10-12"].concurrency, 0);
  assert.equal(store.backing.periods["2026-10-12"].tokens, Buffer.byteLength("user\nhello"));
  assert.equal((await executePaidTurn({ ...args, nowMs: args.nowMs + 61_000 })).executionStatus, "timeout");
  assert.equal(calls, 2);
  const fresh = new MemoryQuotaStore();
  const denied = await executePaidTurn({ ...args, store: fresh, env: { ...env, contextFloor: "16" } });
  assert.equal(denied.contextBudget.budget, -16);
  assert.equal(denied.quotaAccounting?.settledTokens, 0);
  assert.equal(fresh.backing.periods["2026-10-12"].tokens, 0);
  assert.equal(calls, 2);
});
