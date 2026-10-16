/* Copyright (c) 2026 Donald Tuttle. All rights reserved. Proprietary. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildChatGptBody, runChatGptExchange } from "./chatgpt-adapter.ts";
import { executePaidTurn, type PaidEnv, type PaidRequest } from "./paid-turn.ts";
import { DEFAULT_LIMITS, MemoryQuotaStore } from "./limits.ts";
import { beginSend, commitResult, interpretImport } from "./session.ts";
import { emptyState, type Clock } from "./types.ts";

const TOKEN = "b".repeat(32);
const REQUEST: PaidRequest = {
  origin: "https://app.example",
  host: "app.example",
  expectedOrigin: "https://app.example",
};

function env(): PaidEnv {
  return {
    enableFlag: undefined,
    apiKey: undefined,
    contextFloor: undefined,
    accessToken: TOKEN,
    openaiFlag: "1",
    openaiKey: "sk-test-secret",
    quota: { ok: true, limits: DEFAULT_LIMITS },
    sharedStore: true,
  };
}

function data() {
  return {
    provider: "chatgpt",
    model: "gpt-4.1",
    messages: [{ role: "user" as const, content: "hi" }],
    timeoutSeconds: 30,
    maxOutputTokens: 512,
    temperature: null,
    topP: null,
    seed: null,
    accessToken: TOKEN,
    contextText: "",
  };
}

const clock = (): Clock => {
  let n = 0;
  return {
    now: () => "2026-10-15T12:00:00.000Z",
    conversationId: () => `c${n}`,
    turnId: () => `t${++n}`,
  };
};

test("chatgpt body asks for one stored-off completion and no tools", () => {
  const body = buildChatGptBody({
    model: "gpt-4.1",
    messages: [{ role: "user" as const, content: "hi" }],
    timeoutSeconds: 30,
    maxOutputTokens: 512,
    temperature: null,
    topP: null,
    seed: null,
    contextText: "",
  });
  assert.equal(body.store, false);
  assert.equal(body.stream, false);
  assert.equal("tools" in body, false);
  assert.equal(body.max_completion_tokens, 512);
});

test("a disabled chatgpt adapter does not call the network or invent a mock receipt", async () => {
  let called = 0;
  const result = await runChatGptExchange(data(), { openaiFlag: undefined, openaiKey: undefined }, async () => {
    called += 1;
    return new Response("no");
  });
  assert.equal(called, 0);
  assert.equal(result.executionStatus, "blocked");
  assert.equal(result.responseText, null);
  assert.match(result.error?.message ?? "", /OPENAI_API_KEY/);
});

test("chatgpt sends one completion to api.openai.com and does not count tokens itself", async () => {
  const store = new MemoryQuotaStore();
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const result = await executePaidTurn({
    data: data(),
    env: env(),
    store,
    request: REQUEST,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(
        JSON.stringify({
          id: "chatcmpl-1",
          model: "gpt-4.1",
          choices: [{ finish_reason: "stop", message: { content: "420 mm" } }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, completion_tokens_details: { reasoning_tokens: 1 } },
        }),
      );
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[0]?.body.store, false);
  assert.equal("tools" in (calls[0]?.body ?? {}), false);
  assert.equal(result.executionStatus, "success");
  assert.equal(result.responseText, "420 mm");
  assert.equal(result.countedInputTokens, null);
  assert.equal(result.countSource, "not_counted");
  assert.equal(result.providerUsage?.input_tokens, 10);
  assert.equal(result.providerUsage?.reasoning_tokens, 1);
  assert.equal(result.quotaAccounting?.settledTokens, 13);
  assert.doesNotMatch(result.responseText ?? "", /OFFLINE_FIXTURE/);
});

test("a chatgpt failure stays a failure", async () => {
  const result = await executePaidTurn({
    data: data(),
    env: env(),
    store: new MemoryQuotaStore(),
    request: REQUEST,
    fetchImpl: async () => new Response("nope", { status: 401 }),
  });
  assert.equal(result.executionStatus, "error");
  assert.equal(result.responseText, null);
  assert.match(result.error?.message ?? "", /401/);
});

test("an unpinned chatgpt model is refused before any request", async () => {
  let called = 0;
  const result = await executePaidTurn({
    data: { ...data(), model: "gpt-4o" },
    env: env(),
    store: new MemoryQuotaStore(),
    request: REQUEST,
    fetchImpl: async () => {
      called += 1;
      return new Response("no");
    },
  });
  assert.equal(called, 0);
  assert.equal(result.executionStatus, "error");
  assert.match(result.error?.message ?? "", /pinned window/);
});

test("beginSend records an openai transport and rejects a claude provider", async () => {
  const started = await beginSend(
    { ...emptyState(), draft: { ...emptyState().draft, provider: "chatgpt", model: "gpt-4.1", text: "" } },
    "hi",
    clock(),
  );
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const turn = started.state.conversations[0]?.turns[0];
  assert.equal(turn?.transport.kind, "openai-https");
  const finished = await commitResult(started.state, started.conversationId, started.turnId, {
    executionStatus: "blocked",
    responseText: null,
    responseStatus: null,
    error: { type: "AccessError", message: "locked" },
    returnedModel: null,
    providerResponseId: null,
    providerUsage: null,
    reasoningEncryptedOmitted: false,
    countedInputTokens: null,
    countSource: "not_counted",
    contextBudget: {
      model: "gpt-4.1",
      contextFloor: null,
      modelContextWindow: null,
      contextFloorSource: "unavailable",
      budget: null,
      countedInputTokens: null,
      countSource: "not_counted",
      blockedReason: "locked",
    },
  }, "2026-10-15T12:00:01.000Z");
  const saved = finished.conversations[0];
  assert.ok(saved);
  const imported = await interpretImport("turn.json", JSON.stringify(saved?.turns[0]));
  assert.equal(imported.kind, "conversations");
  const rejected = await interpretImport(
    "turn.json",
    JSON.stringify({ ...saved?.turns[0], settings: { ...saved?.turns[0]?.settings, provider: "claude" } }),
  );
  assert.equal(rejected.kind, "error");
});
