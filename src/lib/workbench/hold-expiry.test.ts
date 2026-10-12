/* Copyright (c) 2026 Donald Tuttle. All rights reserved. Proprietary. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { beginSend, commitResult, interpretImport } from "./session.ts";
import { emptyState } from "./types.ts";
import {
  DEFAULT_LIMITS,
  MemoryQuotaStore,
  QUOTA_HOLD_GRACE_MS,
  type QuotaLimits,
} from "./limits.ts";
import { executePaidTurn, parsePaidCall, type PaidEnv, type PaidRequest } from "./paid-turn.ts";

const TOKEN = "a".repeat(32);
const REQUEST: PaidRequest = {
  origin: "https://app.example",
  host: "app.example",
  expectedOrigin: "https://app.example",
};

function env(): PaidEnv {
  return {
    enableFlag: "1",
    apiKey: "test-key",
    contextFloor: undefined,
    accessToken: TOKEN,
    quota: { ok: true, limits: DEFAULT_LIMITS },
    sharedStore: true,
  };
}

function data(timeoutSeconds: number) {
  return {
    model: "grok-4.5",
    messages: [{ role: "user", content: "hi" }],
    timeoutSeconds,
    maxOutputTokens: 512,
    temperature: null,
    topP: null,
    seed: null,
    accessToken: TOKEN,
    contextText: "",
  };
}

const slow: typeof fetch = async () => {
  throw new DOMException("timeout", "TimeoutError");
};

const completionTimeout: typeof fetch = async (url) => {
  if (String(url).includes("tokenize")) return new Response(JSON.stringify({ token_ids: [1, 2, 3] }));
  throw new DOMException("timeout", "TimeoutError");
};

const ok: typeof fetch = async (url) =>
  new Response(
    String(url).includes("tokenize")
      ? JSON.stringify({ token_ids: [1, 2, 3] })
      : JSON.stringify({
          id: "r",
          model: "grok-4.5",
          choices: [{ finish_reason: "stop", message: { content: "hi" } }],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        }),
  );

function migration(name: string) {
  return readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), "utf8");
}

test("two tokenize-stage timeouts leave the next request free to succeed", async () => {
  const store = new MemoryQuotaStore();
  const now = Date.UTC(2026, 9, 12, 12);
  const statuses: string[] = [];
  let index = 0;
  for (const [fetchImpl, timeoutSeconds] of [
    [slow, 5],
    [slow, 5],
    [ok, 30],
  ] as const) {
    const result = await executePaidTurn({
      data: data(timeoutSeconds),
      env: env(),
      fetchImpl,
      store,
      request: REQUEST,
      nowMs: now + index++ * 61_000,
    });
    statuses.push(result.executionStatus);
  }
  assert.deepEqual(statuses, ["timeout", "timeout", "success"]);
});

test("a timeout after the completion call holds the slot until the grace expires", async () => {
  const store = new MemoryQuotaStore();
  const now = Date.UTC(2026, 9, 12, 12);
  const timeoutSeconds = 5;
  const first = await executePaidTurn({
    data: data(timeoutSeconds),
    env: env(),
    fetchImpl: completionTimeout,
    store,
    request: REQUEST,
    nowMs: now,
  });
  const second = await executePaidTurn({
    data: data(timeoutSeconds),
    env: env(),
    fetchImpl: completionTimeout,
    store,
    request: REQUEST,
    nowMs: now,
  });
  assert.equal(first.executionStatus, "timeout");
  assert.equal(second.executionStatus, "timeout");
  const period = new Date(now).toISOString().slice(0, 10);
  const held = store.backing.periods[period]?.tokens;
  const blocked = await executePaidTurn({
    data: data(30),
    env: env(),
    fetchImpl: ok,
    store,
    request: REQUEST,
    nowMs: now + 60_000,
  });
  assert.equal(blocked.executionStatus, "blocked");
  assert.equal(store.backing.periods[period]?.tokens, held);
  const healthy = await executePaidTurn({
    data: data(30),
    env: env(),
    fetchImpl: ok,
    store,
    request: REQUEST,
    nowMs: now + timeoutSeconds * 1000 + QUOTA_HOLD_GRACE_MS + 1,
  });
  assert.equal(healthy.executionStatus, "success");
  assert.equal(store.backing.periods[period]?.concurrency, 0);
  assert.equal(store.backing.periods[period]?.tokens, held + (healthy.quotaAccounting?.settledTokens ?? 0));
});

const parityLimits: QuotaLimits = {
  ...DEFAULT_LIMITS,
  concurrency: 1,
  ratePerMin: 10,
  dailyRequestCap: 20,
  dailyTokenCap: 1_000_000,
};

async function memoryExpiryTotals() {
  const store = new MemoryQuotaStore();
  const now = 1_700_000_000_000;
  const holdMs = 1_000;
  const first = await store.reserve({
    period: "2026-10-12",
    clientKey: "deployment",
    nowMs: now,
    holdMs,
    limits: parityLimits,
    tokens: 100,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return { concurrency: -1, tokens: -1 };
  const stillHeld = await store.reserve({
    period: "2026-10-12",
    clientKey: "deployment",
    nowMs: now + holdMs - 1,
    holdMs: 5_000,
    limits: parityLimits,
    tokens: 50,
  });
  assert.equal(stillHeld.ok, false);
  const released = await store.reserve({
    period: "2026-10-12",
    clientKey: "deployment",
    nowMs: now + holdMs,
    holdMs: 5_000,
    limits: parityLimits,
    tokens: 50,
  });
  assert.equal(released.ok, true);
  await store.reconcile({ reservationId: first.reservation.id, actualTokens: 40 });
  await store.reconcile({ reservationId: first.reservation.id, actualTokens: 1 });
  const row = store.backing.periods["2026-10-12"];
  assert.ok(row);
  assert.ok(row.concurrency >= 0);
  return { concurrency: row.concurrency, tokens: row.tokens };
}

test("an expired hold releases concurrency once and still settles tokens once", async () => {
  const totals = await memoryExpiryTotals();
  assert.deepEqual(totals, { concurrency: 1, tokens: 90 });
});

test("postgres expiry matches the memory store and drops the 7-argument reserve", async () => {
  const expected = await memoryExpiryTotals();
  const db = new PGlite();
  try {
    for (const name of ["0002_workbench_quota.sql", "0003_workbench_global_concurrency.sql", "0004_workbench_hold_expiry.sql"]) {
      await db.exec(migration(name));
    }
    const now = 1_700_000_000_000;
    const holdMs = 1_000;
    const reserve = (nowMs: number, tokens: number, hold: number) =>
      db.query<{ ok: boolean; reservation_id: string | null }>(
        "select ok, reservation_id from workbench_reserve($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        ["2026-10-12", `deployment:${Math.floor(nowMs / 60_000)}`, tokens, 10, 20, 1_000_000, 1, nowMs, hold],
      );
    const first = (await reserve(now, 100, holdMs)).rows[0];
    assert.equal(first?.ok, true);
    assert.equal((await reserve(now + holdMs - 1, 50, 5_000)).rows[0]?.ok, false);
    assert.equal((await reserve(now + holdMs, 50, 5_000)).rows[0]?.ok, true);
    await db.query("select workbench_reconcile($1, $2)", [first?.reservation_id, 40]);
    await db.query("select workbench_reconcile($1, $2)", [first?.reservation_id, 1]);
    const row = (
      await db.query<{ tokens: string | number; concurrency: number }>(
        "select tokens, concurrency from workbench_quota_period where period = '2026-10-12'",
      )
    ).rows[0];
    assert.deepEqual(
      { concurrency: Number(row?.concurrency), tokens: Number(row?.tokens) },
      expected,
    );
    const overloads = (
      await db.query<{ count: string | number }>("select count(*)::int as count from pg_proc where proname = 'workbench_reserve'")
    ).rows[0];
    assert.equal(Number(overloads?.count), 1);
    await assert.rejects(db.query("select * from workbench_reserve($1,$2,10,10,200,500000,1)", ["2026-10-12", "old"]));
  } finally {
    await db.close();
  }
});

test("migration 0004 backfills unsettled holds so the next reserve can clear them", async () => {
  const db = new PGlite();
  try {
    await db.exec(migration("0002_workbench_quota.sql"));
    await db.exec(migration("0003_workbench_global_concurrency.sql"));
    await db.exec(`
      insert into workbench_quota_period (period, requests, tokens, concurrency)
      values ('2026-10-12', 1, 10, 1);
      insert into workbench_quota_reservation (id, period, reserved_tokens, settled)
      values ('stuck', '2026-10-12', 10, false);
    `);
    await db.exec(migration("0004_workbench_hold_expiry.sql"));
    const stamped = (
      await db.query<{ expires_ms: string | number | null }>(
        "select expires_ms from workbench_quota_reservation where id = 'stuck'",
      )
    ).rows[0];
    assert.ok(stamped?.expires_ms !== null && stamped?.expires_ms !== undefined);
    const expires = Number(stamped?.expires_ms);
    const admitted = (
      await db.query<{ ok: boolean }>("select ok from workbench_reserve($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
        "2026-10-12",
        "2026-10-12:later",
        10,
        10,
        200,
        500_000,
        1,
        expires,
        1_000,
      ])
    ).rows[0];
    assert.equal(admitted?.ok, true);
  } finally {
    await db.close();
  }
});

test("new sends require 5 seconds and saved records may still say 0.05", async () => {
  const body = {
    model: "grok-4.5",
    messages: [{ role: "user", content: "hi" }],
    contextText: "",
    timeoutSeconds: 4.9,
    maxOutputTokens: 32,
    temperature: null,
    topP: null,
    seed: null,
  };
  const rejected = await parsePaidCall(body);
  assert.equal("error" in rejected, true);
  if ("error" in rejected) assert.match(rejected.error, /5 and 300/);
  const accepted = await parsePaidCall({ ...body, timeoutSeconds: 5 });
  assert.equal("input" in accepted, true);

  const began = await beginSend(emptyState(), "hello");
  assert.equal(began.ok, true);
  if (!began.ok) return;
  const result = await executePaidTurn({
    data: {},
    env: { enableFlag: "1", apiKey: "test-only", contextFloor: undefined, sharedStore: false },
    fetchImpl: async () => {
      throw new Error("no network");
    },
    store: null,
    request: REQUEST,
  });
  const ended = await commitResult(began.state, began.conversationId, began.turnId, result, "2026-10-12T12:00:00.000Z");
  const turn = structuredClone(ended.conversations[0]?.turns[0]);
  assert.ok(turn);
  turn.settings.timeoutSeconds = 0.05;
  const imported = await interpretImport("turn.json", JSON.stringify(turn));
  assert.equal(imported.kind, "conversations");
  if (imported.kind === "conversations") {
    assert.equal(imported.conversations[0]?.turns[0]?.settings.timeoutSeconds, 0.05);
  }
});
