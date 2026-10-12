/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute. */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { canonicalJson } from "./hash.ts";
import { runGrokExchange } from "./grok-adapter.ts";
import {
  DEFAULT_LIMITS,
  MemoryQuotaStore,
  emptyBacking,
  readQuotaConfig,
  snapshotBacking,
  utcPeriod,
  type QuotaStore,
} from "./limits.ts";
import { accessConfigError, accessTokensMatch } from "./access.ts";
import { clientKeyFromHeaders, executePaidTurn, type PaidEnv } from "./paid-turn.ts";
import { packState, unpackState } from "./pack.ts";
import { commitResult, activeConversation, beginSend, deleteConversation } from "./session.ts";
import { loadStored, migrateLegacy, persistLatest, saveStored, STORAGE_KEY_V1, STORAGE_KEY_V2, type StorageLike } from "./storage.ts";
import { emptyState, type Clock, type Draft, type PersistedState } from "./types.ts";
import { runMockExchange } from "./mock.ts";
import { localBlockReason } from "./session.ts";
import { interpretImport } from "./session.ts";

const TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789ABCD";
const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T00:00:01.000Z";
let sequence = 0;

function clock(): Clock {
  return {
    now: () => NOW,
    conversationId: () => `conv-${++sequence}`,
    turnId: () => `turn-${++sequence}`,
  };
}

function withDraft(patch: Partial<Draft>): PersistedState {
  const state = emptyState();
  return { ...state, draft: { ...state.draft, ...patch } };
}

async function succeed(state: PersistedState, prompt: string): Promise<PersistedState> {
  const began = await beginSend(state, prompt, clock());
  assert.equal(began.ok, true);
  if (!began.ok) return state;
  const turn = activeConversation(began.state)?.turns.at(-1);
  assert.ok(turn);
  const result = runMockExchange({
    messages: turn.assembledMessages,
    contextText: turn.frozenContextText,
    promptSha256: turn.promptSha256,
    seed: turn.settings.seed,
    blockedReason: localBlockReason(turn),
  });
  return commitResult(began.state, began.conversationId, began.turnId, result, LATER);
}

function limits(patch: Partial<PaidEnv["quota"]> = {}) {
  return {
    ratePerMin: 10,
    dailyRequestCap: 20,
    dailyTokenCap: 500_000,
    concurrency: 2,
    ...patch,
  };
}

function env(patch: Partial<PaidEnv> = {}): PaidEnv {
  return {
    enableFlag: "1",
    apiKey: "xai-test-key-not-a-real-secret",
    contextFloor: "80",
    accessToken: TOKEN,
    quota: { ok: true, limits: limits() },
    sharedStore: true,
    ...patch,
  };
}

function callBody(accessToken = TOKEN, extra: Record<string, unknown> = {}) {
  return {
    accessToken,
    model: "grok-4.5",
    messages: [{ role: "user", content: "ping" }],
    timeoutSeconds: 30,
    maxOutputTokens: 16,
    temperature: null,
    topP: null,
    seed: null,
    contextText: "",
    ...extra,
  };
}

function scriptedFetch() {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("tokenize")) {
      return new Response(JSON.stringify({ token_ids: [{ token_id: 1 }] }), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        id: "resp-guard",
        model: "grok-4.5",
        choices: [{ finish_reason: "stop", message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200 },
    );
  };
  return { fetchImpl, calls };
}

function headers(forwarded: string) {
  return { get: (name: string) => (name.toLowerCase() === "x-forwarded-for" ? forwarded : null) };
}

function memoryDisk(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    storage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    } satisfies StorageLike,
  };
}

describe("access token", () => {
  it("rejects missing, invalid, wrong, and oversized tokens before any provider call", async () => {
    assert.match(accessConfigError(undefined) ?? "", /not configured/);
    assert.match(accessConfigError("short") ?? "", /32/);
    assert.equal(accessConfigError(TOKEN), null);
    assert.equal(accessTokensMatch(TOKEN, TOKEN), true);
    assert.equal(accessTokensMatch(TOKEN, `${TOKEN}no`), false);
    assert.equal(accessTokensMatch(TOKEN, ""), false);
    assert.equal(accessTokensMatch(TOKEN, "a".repeat(300)), false);

    const { fetchImpl, calls } = scriptedFetch();
    const store = new MemoryQuotaStore();
    const request = { origin: "https://app.example", host: "app.example" };
    const cases: Array<{ env: PaidEnv; token: string; pattern: RegExp }> = [
      { env: env({ accessToken: undefined }), token: TOKEN, pattern: /not configured/ },
      { env: env({ accessToken: "too-short" }), token: "too-short", pattern: /32/ },
      { env: env(), token: `${TOKEN}no`, pattern: /not accepted/ },
      { env: env(), token: "a".repeat(300), pattern: /too long/ },
      { env: env(), token: "", pattern: /not accepted/ },
    ];
    for (const item of cases) {
      const result = await executePaidTurn({
        data: callBody(item.token),
        env: item.env,
        fetchImpl,
        store,
        request,
        headers: headers("1.2.3.4"),
        nowMs: Date.parse("2026-10-12T12:00:00.000Z"),
      });
      assert.equal(result.executionStatus, "blocked");
      assert.match(result.error?.message ?? "", item.pattern);
      assert.equal(JSON.stringify(result).includes(TOKEN), false);
      assert.equal(JSON.stringify(result).includes("xai-test-key"), false);
      assert.equal(JSON.stringify(result).includes("OFFLINE_FIXTURE"), false);
    }
    assert.equal(calls.length, 0);
  });

  it("does not treat a matching origin as authorization", async () => {
    const { fetchImpl, calls } = scriptedFetch();
    const denied = await executePaidTurn({
      data: callBody(""),
      env: env(),
      fetchImpl,
      store: new MemoryQuotaStore(),
      request: { origin: "https://app.example", host: "app.example" },
      headers: headers("203.0.113.8"),
      nowMs: Date.parse("2026-10-12T12:00:00.000Z"),
    });
    assert.equal(denied.executionStatus, "blocked");
    assert.equal(calls.length, 0);

    const allowed = await executePaidTurn({
      data: callBody(),
      env: env(),
      fetchImpl,
      store: new MemoryQuotaStore(),
      request: { origin: "https://app.example", host: "app.example" },
      headers: headers("203.0.113.9"),
      nowMs: Date.parse("2026-10-12T12:00:00.000Z"),
    });
    assert.equal(allowed.executionStatus, "success");
    assert.ok(calls.length > 0);
    assert.equal(JSON.stringify(allowed).includes(TOKEN), false);
    assert.equal(JSON.stringify(allowed).includes("xai-test-key"), false);
  });

  it("locks paid execution when the shared store or quota config is missing", async () => {
    const { fetchImpl, calls } = scriptedFetch();
    const locked = await executePaidTurn({
      data: callBody(),
      env: env({ sharedStore: false }),
      fetchImpl,
      store: new MemoryQuotaStore(),
      request: { origin: "https://app.example", host: "app.example" },
      nowMs: Date.parse("2026-10-12T12:00:00.000Z"),
    });
    assert.match(locked.error?.message ?? "", /shared quota store/);
    const broken = await executePaidTurn({
      data: callBody(),
      env: env({ quota: { ok: false, reason: "WORKBENCH_DAILY_TOKEN_CAP must be from 1 to 100000000" } }),
      fetchImpl,
      store: new MemoryQuotaStore(),
      request: { origin: "https://app.example", host: "app.example" },
      nowMs: Date.parse("2026-10-12T12:00:00.000Z"),
    });
    assert.match(broken.error?.message ?? "", /WORKBENCH_DAILY_TOKEN_CAP/);
    assert.equal(calls.length, 0);
  });

  it("rejects a contradictory injector before a provider call", async () => {
    const { fetchImpl, calls } = scriptedFetch();
    const result = await executePaidTurn({
      data: callBody(TOKEN, {
        contextText: "SPINE",
        contextRole: "system",
        messages: [{ role: "user", content: "ping" }],
      }),
      env: env(),
      fetchImpl,
      store: new MemoryQuotaStore(),
      request: { origin: "https://app.example", host: "app.example" },
      nowMs: Date.parse("2026-10-12T12:00:00.000Z"),
    });
    assert.equal(result.executionStatus, "error");
    assert.match(result.error?.message ?? "", /does not match/);
    assert.equal(calls.length, 0);
  });
});

describe("quota allowance", () => {
  it("rejects overflow and other non-integers", () => {
    assert.equal(readQuotaConfig({}).ok, true);
    for (const raw of ["0", "-1", "1.5", "1e3", "99999999999999999999", "1001"]) {
      const result = readQuotaConfig({ ratePerMin: raw });
      assert.equal(result.ok, false, raw);
    }
    assert.equal(readQuotaConfig({ concurrency: "0" }).ok, false);
    assert.equal(readQuotaConfig({ dailyTokenCap: `${Number.MAX_SAFE_INTEGER}` }).ok, false);
  });

  it("shares one allowance across instances, restarts, and spoofed forwarding headers", async () => {
    assert.equal(clientKeyFromHeaders(headers("1.1.1.1")), clientKeyFromHeaders(headers("8.8.8.8")));
    const backing = emptyBacking();
    const first = new MemoryQuotaStore(backing);
    const second = new MemoryQuotaStore(backing);
    const nowMs = Date.parse("2026-10-12T12:00:00.000Z");
    const period = utcPeriod(nowMs);
    const tight = { ...DEFAULT_LIMITS, ratePerMin: 1, dailyRequestCap: 2, dailyTokenCap: 30, concurrency: 2 };
    const admitted = await first.reserve({ period, clientKey: clientKeyFromHeaders(headers("1.1.1.1")), nowMs, holdMs: 600_000, limits: tight, tokens: 10 });
    assert.equal(admitted.ok, true);
    const spoofed = await second.reserve({ period, clientKey: clientKeyFromHeaders(headers("9.9.9.9")), nowMs, holdMs: 600_000, limits: tight, tokens: 10 });
    assert.equal(spoofed.ok, false);
    const restarted = new MemoryQuotaStore(snapshotBacking(first));
    const again = await restarted.reserve({ period, clientKey: "deployment", nowMs, holdMs: 600_000, limits: tight, tokens: 10 });
    assert.equal(again.ok, false);
  });

  it("serializes concurrent admission and keeps missing usage", async () => {
    const store = new MemoryQuotaStore();
    const nowMs = Date.parse("2026-10-12T12:00:00.000Z");
    const period = utcPeriod(nowMs);
    const tight = { ...DEFAULT_LIMITS, ratePerMin: 10, dailyRequestCap: 10, dailyTokenCap: 100, concurrency: 1 };
    const held = store.reserve({ period, clientKey: "deployment", nowMs, holdMs: 600_000, limits: tight, tokens: 5 });
    const raced = await store.reserve({ period, clientKey: "deployment", nowMs, holdMs: 600_000, limits: tight, tokens: 5 });
    const first = await held;
    assert.equal(first.ok, true);
    assert.equal(raced.ok, false);
    if (!first.ok) return;
    const before = store.backing.periods[period]?.tokens;
    await store.reconcile({ reservationId: first.reservation.id, actualTokens: null });
    await store.reconcile({ reservationId: first.reservation.id, actualTokens: 1 });
    assert.equal(store.backing.periods[period]?.tokens, before);
    assert.equal(store.backing.periods[period]?.concurrency, 0);
    const nextDay = Date.parse("2026-10-13T00:05:00.000Z");
    assert.notEqual(utcPeriod(nowMs), utcPeriod(nextDay));
    const rolled = await store.reserve({
      period: utcPeriod(nextDay),
      clientKey: "deployment",
      nowMs: nextDay,
      holdMs: 600_000,
      limits: { ...tight, ratePerMin: 1, dailyRequestCap: 1, dailyTokenCap: 5 },
      tokens: 5,
    });
    assert.equal(rolled.ok, true);
  });

  it("refuses paid work when the limiter throws and does not call the provider", async () => {
    let calls = 0;
    const store: QuotaStore = {
      async reserve() {
        throw new Error("database unavailable");
      },
      async reconcile() {
        throw new Error("database unavailable");
      },
    };
    const result = await executePaidTurn({
      data: callBody(),
      env: env(),
      fetchImpl: async () => {
        calls += 1;
        throw new Error("should not run");
      },
      store,
      request: { origin: "https://app.example", host: "app.example" },
      nowMs: Date.parse("2026-10-12T12:00:00.000Z"),
    });
    assert.equal(calls, 0);
    assert.match(result.error?.message ?? "", /limiter is unavailable/);
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
  });
});

describe("packed storage", () => {
  it("round-trips unicode, whitespace, null usage, an incomplete turn, and budget -16", async () => {
    const unicode = await succeed(withDraft({ text: " café\n\t日本語 ", name: "lamp" }), " ask ");
    const began = await beginSend(withDraft({ provider: "grok", model: "grok-4.5", maxOutputTokens: 32, text: "" }), "ping", clock());
    assert.equal(began.ok, true);
    if (!began.ok) return;
    const negative = await runGrokExchange(
      {
        model: "grok-4.5",
        messages: [{ role: "user", content: "ping" }],
        timeoutSeconds: 30,
        maxOutputTokens: 32,
        temperature: null,
        topP: null,
        seed: null,
        contextText: "",
      },
      { enableFlag: "1", apiKey: "xai-test-key-not-a-real-secret", contextFloor: "16" },
      async () => {
        throw new Error("network");
      },
    );
    assert.equal(negative.contextBudget.budget, -16);
    const negativeState = await commitResult(began.state, began.conversationId, began.turnId, negative, LATER);
    const cutBegin = await beginSend(withDraft({ provider: "grok", model: "grok-4.5", text: "" }), "ping", clock());
    assert.equal(cutBegin.ok, true);
    if (!cutBegin.ok) return;
    const incomplete = await runGrokExchange(
      {
        model: "grok-4.5",
        messages: [{ role: "user", content: "ping" }],
        timeoutSeconds: 30,
        maxOutputTokens: 32,
        temperature: null,
        topP: null,
        seed: null,
        contextText: "",
      },
      { enableFlag: "1", apiKey: "xai-test-key-not-a-real-secret", contextFloor: undefined },
      async (input) => {
        const url = String(input);
        if (url.includes("tokenize")) return new Response(JSON.stringify({ token_ids: [{ token_id: 1 }] }), { status: 200 });
        return new Response(
          JSON.stringify({ id: "cut", model: "grok-4.5", choices: [{ finish_reason: "length", message: { content: "cut off" } }] }),
          { status: 200 },
        );
      },
    );
    assert.equal(incomplete.executionStatus, "incomplete");
    const cutState = await commitResult(cutBegin.state, cutBegin.conversationId, cutBegin.turnId, incomplete, LATER);
    const merged: PersistedState = {
      ...unicode,
      conversations: [...unicode.conversations, ...negativeState.conversations, ...cutState.conversations],
    };
    const back = unpackState(packState(merged));
    assert.equal(canonicalJson(back), canonicalJson(merged));
    const turns = back.conversations.flatMap((conversation) => conversation.turns);
    assert.equal(turns.some((turn) => turn.frozenContextText === " café\n\t日本語 "), true);
    assert.equal(turns.some((turn) => turn.providerUsage === null), true);
    assert.equal(turns.some((turn) => turn.executionStatus === "incomplete"), true);
    assert.equal(turns.some((turn) => turn.contextBudget.budget === -16), true);
    for (const turn of turns) {
      if (turn.recordSha256) {
        const found = merged.conversations.flatMap((conversation) => conversation.turns).find((item) => item.id === turn.id);
        assert.equal(turn.contextSha256, found?.contextSha256);
        assert.equal(turn.promptSha256, found?.promptSha256);
        assert.equal(turn.recordSha256, found?.recordSha256);
      }
    }
  });

  it("shrinks repeated context and still grows when turns are unique", async () => {
    const text = "PROJECT CONTEXT ".repeat(400);
    let state = withDraft({ text, name: "bulk" });
    state = await succeed(state, "one");
    const single = JSON.stringify(packState(state)).length;
    const rawSingle = JSON.stringify(state).length;
    assert.ok(single < rawSingle);
    for (const prompt of ["two", "three", "four"]) state = await succeed(state, prompt);
    const packed = JSON.stringify(packState(state));
    const raw = JSON.stringify(state);
    assert.ok(packed.length < raw.length);
    assert.ok(packed.length > single);
    const unique = emptyState();
    unique.conversations = [
      {
        ...state.conversations[0],
        id: "unique",
        turns: state.conversations[0].turns.map((turn, index) => ({
          ...turn,
          id: `unique-${index}`,
          userPrompt: `unique prompt ${index} ${"x".repeat(5000)}`,
          responseText: `unique reply ${index} ${"y".repeat(5000)}`,
        })),
      },
    ];
    const grown = JSON.stringify(packState(unique)).length;
    assert.ok(grown > packed.length);
  });

  it("rejects bad references and unsupported versions", () => {
    const state = emptyState();
    const packed = packState(state);
    assert.throws(() => unpackState({ ...packed, version: 2 as 1 }), /Unsupported/);
    assert.throws(() => unpackState({ ...packed, pack: "other" as "cew-pack-v1" }), /Unsupported/);
  });

  it("keeps both measured counts across pack, export, and import", async () => {
    const began = await beginSend(withDraft({ provider: "grok", model: "grok-4.5", text: "SPINE", deliveryMode: "SYSTEM_SLOT" }), "ask", clock());
    assert.equal(began.ok, true);
    if (!began.ok) return;
    const turn = activeConversation(began.state)?.turns[0];
    assert.ok(turn);
    const result = await runGrokExchange(
      {
        model: "grok-4.5",
        messages: turn.assembledMessages,
        timeoutSeconds: 30,
        maxOutputTokens: 64,
        temperature: null,
        topP: null,
        seed: null,
        contextText: "SPINE",
        contextRole: "system",
      },
      { enableFlag: "1", apiKey: "xai-test-key-not-a-real-secret", contextFloor: "1000" },
      async (input, init) => {
        const url = String(input);
        if (url.includes("tokenize")) {
          const body = JSON.parse(String(init?.body)) as { text?: string };
          const count = String(body.text ?? "").includes("ask") ? 4 : 2;
          const ids = Array.from({ length: count }, (_, index) => ({ token_id: index + 1 }));
          return new Response(JSON.stringify({ token_ids: ids }), { status: 200 });
        }
        return new Response(JSON.stringify({ id: "ok", model: "grok-4.5", choices: [{ finish_reason: "stop", message: { content: "yes" } }] }), { status: 200 });
      },
    );
    assert.equal(result.contextBudget.injectionTokens, 2);
    assert.equal(result.countedInputTokens, 4);
    assert.notEqual(result.contextBudget.injectionCountSource, result.countSource);
    const sealed = await commitResult(began.state, began.conversationId, began.turnId, result, LATER);
    const back = unpackState(packState(sealed));
    const stored = activeConversation(back)?.turns[0];
    assert.equal(stored?.contextBudget.injectionTokens, 2);
    assert.equal(stored?.preflight.countedInputTokens, 4);
    const imported = await interpretImport("turn.json", JSON.stringify(stored));
    assert.equal(imported.kind, "conversations");
    if (imported.kind !== "conversations") return;
    const again = imported.conversations[0]?.turns[0];
    assert.equal(again?.contextBudget.injectionTokens, 2);
    assert.equal(again?.preflight.countedInputTokens, 4);
    assert.equal(again?.contextBudget.injectionCountSource, stored?.contextBudget.injectionCountSource);
    assert.equal(again?.preflight.countSource, stored?.preflight.countSource);
  });

  it("loads legacy data, keeps v1, and does not restore a deleted conversation from it", async () => {
    const state = await succeed(withDraft({ text: "PROJECT", name: "one" }), "hello");
    const disk = memoryDisk({ [STORAGE_KEY_V1]: JSON.stringify(state) });
    const loaded = loadStored(disk.storage);
    assert.equal(loaded.status, "legacy");
    if (loaded.status !== "legacy") return;
    const migrated = migrateLegacy(disk.storage, loaded.state);
    assert.equal(migrated.ok, true);
    assert.equal(disk.data.has(STORAGE_KEY_V1), true);
    const removed = deleteConversation(loaded.state, loaded.state.activeId ?? "");
    assert.equal(saveStored(disk.storage, removed).ok, true);
    const next = loadStored(disk.storage);
    assert.equal(next.status, "ready");
    if (next.status !== "ready") return;
    assert.equal(next.state.conversations.length, 0);
    assert.equal(disk.data.get(STORAGE_KEY_V1)?.includes("PROJECT"), true);
  });

  it("does not overwrite corrupt data and reports storage exceptions", async () => {
    const disk = memoryDisk({ [STORAGE_KEY_V2]: "{not-json" });
    const loaded = loadStored(disk.storage);
    assert.equal(loaded.status, "corrupt");
    assert.equal(disk.data.get(STORAGE_KEY_V2), "{not-json");
    const throwing: StorageLike = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("quota");
      },
    };
    assert.equal(loadStored(throwing).status, "unavailable");
    const state = await succeed(withDraft({ text: "keep" }), "hello");
    const failed = saveStored(throwing, state);
    assert.equal(failed.ok, false);
    assert.match(failed.ok ? "" : failed.message, /not been saved/);
  });

  it("writes the latest state after a delete or edit during persistence", async () => {
    const state = await succeed(withDraft({ text: "PROJECT", name: "one" }), "hello");
    let current = state;
    let written: PersistedState | null = null;
    let release: () => void = () => undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = persistLatest(
      () => current,
      (next) => {
        written = next;
      },
      wait,
    );
    current = deleteConversation(current, current.activeId ?? "");
    current = { ...current, draft: { ...current.draft, name: "edited-during-save" } };
    release();
    await pending;
    const saved = written as PersistedState | null;
    assert.ok(saved);
    assert.equal(saved.conversations.length, 0);
    assert.equal(saved.draft.name, "edited-during-save");
  });
});

describe("client credential surface", () => {
  it("does not read server credentials from client modules", () => {
    const files = [
      "src/components/workbench/WorkbenchApp.tsx",
      "src/components/workbench/InjectorPanel.tsx",
      "src/components/workbench/DialogPanel.tsx",
      "src/components/workbench/DiagnosticsPanel.tsx",
      "src/lib/workbench/grok-api.ts",
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      assert.equal(text.includes("process.env.XAI_API_KEY"), false, file);
      assert.equal(text.includes("process.env.WORKBENCH_ACCESS_TOKEN"), false, file);
      assert.equal(text.includes(TOKEN), false, file);
    }
    const clientDirs = ["dist/client", ".output/public", ".vercel/output/static"].filter((dir) => existsSync(dir));
    for (const dir of clientDirs) {
      const stack = [dir];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        for (const name of readdirSync(current)) {
          const path = join(current, name);
          if (statSync(path).isDirectory()) stack.push(path);
          else if (/\.(js|mjs|css|html|map)$/.test(name)) {
            const text = readFileSync(path, "utf8");
            assert.equal(text.includes(TOKEN), false, path);
            assert.equal(text.includes("xai-test-key-not-a-real-secret"), false, path);
          }
        }
      }
    }
  });
});
