/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256Text } from "./hash.ts";
import { assembleMessages, promptSha256, replayableHistory, serializeMessages } from "./messages.ts";
import { runMockExchange } from "./mock.ts";
import { hashRecord, serializeRecord } from "./records.ts";
import {
  activeConversation,
  beginSend,
  blockedLocally,
  commitResult,
  deleteConversation,
  divergenceReasons,
  localBlockReason,
  recoverInterrupted,
  startBaseline,
} from "./session.ts";
import {
  buildChatBody,
  grokPromptText,
  readUsage,
  runGrokExchange,
  type GrokEnv,
} from "./grok-adapter.ts";
import { cappedWindow, grokModelWindow } from "./windows.ts";
import { LOCAL_BYTE_CEILING, emptyState, type Clock, type Draft, type PersistedState } from "./types.ts";
import { VECTOR_HASH, VECTOR_RECORD, VECTOR_SERIAL } from "./vectors.ts";

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

describe("history assembly", () => {
  it("injects context once, then successful exchanges, then the new prompt", async () => {
    let state = withDraft({ text: "PROJECT", deliveryMode: "SYSTEM_SLOT" });
    state = await succeed(state, "first");
    state = await succeed(state, "second");
    const began = await beginSend(state, "third", clock());
    assert.equal(began.ok, true);
    if (!began.ok) return;
    const messages = activeConversation(began.state)?.turns.at(-1)?.assembledMessages;
    assert.deepEqual(messages, [
      { role: "system", content: "PROJECT" },
      { role: "user", content: "first" },
      { role: "assistant", content: messages?.[2]?.content },
      { role: "user", content: "second" },
      { role: "assistant", content: messages?.[4]?.content },
      { role: "user", content: "third" },
    ]);
    assert.equal(messages?.filter((message) => message.content === "PROJECT").length, 1);
  });

  it("uses a user message for USER_PASTE and no message for empty context", () => {
    assert.deepEqual(
      assembleMessages({
        contextText: "note",
        deliveryMode: "USER_PASTE",
        history: [],
        userPrompt: "ask",
      }),
      [
        { role: "user", content: "note" },
        { role: "user", content: "ask" },
      ],
    );
    assert.deepEqual(
      assembleMessages({ contextText: "", deliveryMode: "SYSTEM_SLOT", history: [], userPrompt: "ask" }),
      [{ role: "user", content: "ask" }],
    );
  });

  it("does not replay failed, pending, incomplete, or other-provider turns", async () => {
    let state = withDraft({ text: "PROJECT" });
    state = await succeed(state, "kept");
    const failedBegin = await beginSend(state, "lost", clock());
    assert.equal(failedBegin.ok, true);
    if (!failedBegin.ok) return;
    state = await commitResult(
      failedBegin.state,
      failedBegin.conversationId,
      failedBegin.turnId,
      blockedLocally("boom", "fixture-echo-v2"),
      LATER,
    );
    const pending = await beginSend(state, "open", clock());
    assert.equal(pending.ok, true);
    if (!pending.ok) return;
    const turns = activeConversation(pending.state)?.turns ?? [];
    turns[2] = { ...turns[2], executionStatus: "success", settings: { ...turns[2].settings, provider: "grok" }, responseText: "foreign" };
    const history = replayableHistory(turns, "mock");
    assert.equal(history.length, 1);
    assert.equal(history[0]?.user, "kept");
    assert.equal(history.some((item) => item.user === "lost" || item.assistant === "foreign"), false);
  });
});

describe("conversations", () => {
  it("keeps history when only the name changes", async () => {
    let state = await succeed(withDraft({ text: "PROJECT", name: "one" }), "hello");
    const id = state.activeId;
    state = { ...state, draft: { ...state.draft, name: "two" } };
    assert.deepEqual(divergenceReasons(activeConversation(state), state.draft), []);
    state = await succeed(state, "again");
    assert.equal(state.activeId, id);
    assert.equal(activeConversation(state)?.turns.length, 2);
    assert.equal(activeConversation(state)?.contextName, "two");
    assert.equal(activeConversation(state)?.turns[0]?.contextName, "one");
  });

  it("starts a new conversation when context, delivery, provider, or model changes, and keeps the old record", async () => {
    let state = await succeed(withDraft({ text: "PROJECT", name: "one" }), "hello");
    const original = state.activeId;
    for (const patch of [
      { text: "OTHER" },
      { deliveryMode: "USER_PASTE" as const },
      { provider: "grok" as const },
      { model: "grok-4" },
    ]) {
      const base = await succeed(withDraft({ text: "PROJECT", name: "one" }), "hello");
      const next = await beginSend({ ...base, draft: { ...base.draft, ...patch } }, "next", clock());
      assert.equal(next.ok, true);
      if (!next.ok) return;
      assert.notEqual(next.conversationId, base.activeId);
      assert.equal(next.state.conversations.some((conversation) => conversation.id === base.activeId), true);
      assert.equal(activeConversation(next.state)?.turns.length, 1);
    }
    assert.ok(original);
  });

  it("isolates baseline from inherited messages and keeps the prior conversation", async () => {
    const prior = await succeed(withDraft({ text: "PROJECT" }), "hello");
    const baselined = await startBaseline(prior, clock());
    const active = activeConversation(baselined);
    assert.notEqual(baselined.activeId, prior.activeId);
    assert.equal(active?.contextText, "");
    assert.equal(active?.turns.length, 0);
    assert.equal(baselined.draft.text, "");
    assert.equal(baselined.conversations.find((conversation) => conversation.id === prior.activeId)?.turns.length, 1);
    const began = await beginSend(baselined, "fresh", clock());
    assert.equal(began.ok, true);
    if (!began.ok) return;
    assert.deepEqual(activeConversation(began.state)?.turns[0]?.assembledMessages, [{ role: "user", content: "fresh" }]);
  });

  it("allows one outstanding send per conversation", async () => {
    const began = await beginSend(withDraft({ text: "PROJECT" }), "hello", clock());
    assert.equal(began.ok, true);
    if (!began.ok) return;
    const second = await beginSend(began.state, "again", clock());
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.match(second.reason, /already open/);
    assert.equal(activeConversation(began.state)?.turns.length, 1);
  });

  it("deletes one conversation without touching the others", async () => {
    const first = await succeed(withDraft({ text: "A" }), "one");
    const both = await beginSend({ ...first, draft: { ...first.draft, text: "B" } }, "two", clock());
    assert.equal(both.ok, true);
    if (!both.ok) return;
    const removed = deleteConversation(both.state, both.conversationId);
    assert.equal(removed.conversations.length, 1);
    assert.equal(removed.conversations[0]?.contextText, "A");
  });
});

describe("snapshots and hashes", () => {
  it("freezes the snapshot and leaves the finalized record unchanged when the draft changes", async () => {
    const began = await beginSend(withDraft({ text: "ALPHA", name: "named" }), "hello", clock());
    assert.equal(began.ok, true);
    if (!began.ok) return;
    const pending = activeConversation(began.state)?.turns[0];
    assert.equal(pending?.recordSha256, null);
    assert.equal(pending?.frozenContextText, "ALPHA");
    const edited: PersistedState = { ...began.state, draft: { ...began.state.draft, text: "BETA" } };
    assert.equal(activeConversation(edited)?.turns[0]?.frozenContextText, "ALPHA");
    const before = structuredClone(began.state);
    const turn = activeConversation(began.state)?.turns[0];
    assert.ok(turn);
    const result = runMockExchange({
      messages: turn.assembledMessages,
      contextText: turn.frozenContextText,
      promptSha256: turn.promptSha256,
      seed: null,
      blockedReason: null,
    });
    const finalized = await commitResult(edited, began.conversationId, began.turnId, result, LATER);
    assert.deepEqual(began.state, before);
    const record = activeConversation(finalized)?.turns[0];
    assert.ok(record?.recordSha256);
    assert.equal(record?.executionStatus, "success");
    assert.equal(record?.providerUsage, null);
    assert.equal(await sha256Text("ALPHA"), record?.contextSha256);
    assert.equal(await promptSha256(record.assembledMessages), record.promptSha256);
    assert.equal(serializeMessages(record.assembledMessages).startsWith('[{"role":"system","content":"ALPHA"}'), true);
    assert.equal(await hashRecord(record), record.recordSha256);
    const moved: PersistedState = { ...finalized, draft: { ...finalized.draft, text: "GAMMA" } };
    assert.equal(activeConversation(moved)?.turns[0]?.recordSha256, record.recordSha256);
    assert.equal(activeConversation(moved)?.turns[0]?.frozenContextText, "ALPHA");
  });

  it("locks messages-json-v1, the empty-string hash, and the record vector", async () => {
    assert.equal(serializeMessages([{ role: "user", content: "ping" }]), '[{"role":"user","content":"ping"}]');
    assert.equal(await sha256Text(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert.equal(await promptSha256([{ role: "user", content: "ping" }]), "6217260849970e705f9941eb50b16e392958fa686c0faca51c073081a22672f1");
    assert.equal(serializeRecord(VECTOR_RECORD), VECTOR_SERIAL);
    assert.equal(await hashRecord(VECTOR_RECORD), VECTOR_HASH);
    assert.equal(serializeRecord({ ...VECTOR_RECORD, recordSha256: null }), VECTOR_SERIAL);
    assert.notEqual(serializeRecord({ ...VECTOR_RECORD, contextSha256: "different" }), VECTOR_SERIAL);
    assert.equal(serializeRecord(VECTOR_RECORD).includes('"providerUsage":null'), true);
    assert.equal(serializeRecord(VECTOR_RECORD).includes("recordSha256"), false);
    assert.equal(serializeRecord(VECTOR_RECORD).includes(VECTOR_RECORD.contextSha256), true);
    assert.equal(serializeRecord(VECTOR_RECORD).includes(VECTOR_RECORD.promptSha256), true);
  });

  it("blocks an oversized request without truncating it or calling the network", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("network");
    };
    try {
      const began = await beginSend(withDraft({ text: "x".repeat(LOCAL_BYTE_CEILING) }), "hello", clock());
      assert.equal(began.ok, true);
      if (!began.ok) return;
      const turn = activeConversation(began.state)?.turns[0];
      assert.ok(turn);
      const reason = localBlockReason(turn);
      assert.match(reason ?? "", /Nothing was truncated or sent/);
      assert.equal(turn.frozenContextText.length, LOCAL_BYTE_CEILING);
      const finalized = await commitResult(
        began.state,
        began.conversationId,
        began.turnId,
        blockedLocally(reason ?? "", "fixture-echo-v2"),
        LATER,
      );
      const record = activeConversation(finalized)?.turns[0];
      assert.equal(record?.executionStatus, "blocked");
      assert.equal(record?.responseText, null);
      assert.equal(replayableHistory(activeConversation(finalized)?.turns ?? [], "mock").length, 0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("runs the offline mock while fetch is blocked, and leaves usage null", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = () => {
      calls += 1;
      throw new Error("network");
    };
    try {
      const state = await succeed(withDraft({ text: "PROJECT" }), "hello");
      const record = activeConversation(state)?.turns[0];
      assert.equal(calls, 0);
      assert.equal(record?.providerUsage, null);
      assert.equal(record?.transport.kind, "OFFLINE_FIXTURE");
      assert.match(record?.responseText ?? "", /OFFLINE_FIXTURE/);
      assert.equal(record?.returnedModel, "fixture-echo-v2");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("finalizes an interrupted pending turn as an error that is not replayed", async () => {
    const began = await beginSend(withDraft({ text: "PROJECT" }), "hello", clock());
    assert.equal(began.ok, true);
    if (!began.ok) return;
    const recovered = await recoverInterrupted(began.state, LATER);
    const turn = activeConversation(recovered)?.turns[0];
    assert.equal(turn?.executionStatus, "error");
    assert.equal(turn?.error?.type, "Interrupted");
    assert.ok(turn?.recordSha256);
    assert.equal(replayableHistory(activeConversation(recovered)?.turns ?? [], "mock").length, 0);
  });
});

describe("grok adapter", () => {
  const enabled: GrokEnv = { enableFlag: "1", apiKey: "xai-test-secret-value", contextFloor: undefined };

  function fetchSpy(handler: (url: string, body: unknown, nth: number) => unknown) {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as unknown;
      calls.push({ url, body });
      const json = handler(url, body, calls.length);
      return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    return { fetchImpl, calls };
  }

  it("pins known windows and refuses to raise them", () => {
    assert.equal(grokModelWindow("grok-4.7"), 500_000);
    assert.equal(grokModelWindow("grok-4"), 256_000);
    assert.equal(grokModelWindow("grok-4.5-latest"), 500_000);
    assert.throws(() => grokModelWindow("grok-4.1"), /No pinned context window/);
    assert.deepEqual(cappedWindow(500_000, undefined), { floor: 500_000, source: "model" });
    assert.deepEqual(cappedWindow(500_000, "1000"), { floor: 1000, source: "env_cap" });
    assert.deepEqual(cappedWindow(500_000, "900000"), { floor: 500_000, source: "model" });
    assert.throws(() => cappedWindow(500_000, "0"), /positive/);
    assert.throws(() => cappedWindow(500_000, "nope"), /integer/);
  });

  it("does not call the network or invent a mock receipt when Grok is disabled", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      throw new Error("network");
    };
    const result = await runGrokExchange(
      { model: "grok-4.5", messages: [{ role: "user", content: "hi" }], timeoutSeconds: 30, maxOutputTokens: 512, temperature: null, topP: null, seed: null },
      { enableFlag: undefined, apiKey: "xai-present", contextFloor: undefined },
      fetchImpl,
    );
    assert.equal(calls, 0);
    assert.equal(result.executionStatus, "error");
    assert.match(result.error?.message ?? "", /disabled or XAI_API_KEY/);
    assert.equal(result.responseText, null);
    assert.doesNotMatch(JSON.stringify(result), /OFFLINE_FIXTURE/);
  });

  it("refuses an unpinned model before any request", async () => {
    let calls = 0;
    const result = await runGrokExchange(
      { model: "grok-4.1", messages: [{ role: "user", content: "hi" }], timeoutSeconds: 30, maxOutputTokens: 512, temperature: null, topP: null, seed: null },
      enabled,
      async () => {
        calls += 1;
        throw new Error("network");
      },
    );
    assert.equal(calls, 0);
    assert.equal(result.executionStatus, "blocked");
    assert.match(result.error?.message ?? "", /No pinned context window/);
  });

  it("sends one tokenize and one tool-free sample to api.x.ai, with storage off and no retry", async () => {
    const { fetchImpl, calls } = fetchSpy((_url, _body, nth) => {
      if (nth === 1) return { token_ids: [{ token_id: 1 }, { token_id: 2 }] };
      return { id: "resp-1", model: "grok-4.5", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "pong" } }] };
    });
    const input = {
      model: "grok-4.5",
      messages: [{ role: "user" as const, content: "ping" }],
      timeoutSeconds: 30,
      maxOutputTokens: 64,
      temperature: null,
      topP: null,
      seed: 7,
    };
    const body = buildChatBody(input);
    assert.equal(body.store, false);
    assert.equal("tools" in body, false);
    assert.equal("temperature" in body, false);
    assert.equal(body.seed, 7);
    const result = await runGrokExchange(input, { ...enabled, contextFloor: "900000" }, fetchImpl);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, "https://api.x.ai/v1/tokenize-text");
    assert.equal(calls[1]?.url, "https://api.x.ai/v1/chat/completions");
    assert.equal((calls[0]?.body as { text: string }).text, grokPromptText(input.messages));
    assert.equal((calls[1]?.body as { store: boolean }).store, false);
    assert.equal(result.executionStatus, "success");
    assert.equal(result.responseText, "pong");
    assert.equal(result.providerUsage, null);
    assert.equal(result.returnedModel, "grok-4.5");
    assert.equal(result.contextBudget.contextFloor, 500_000);
    assert.equal(result.contextBudget.contextFloorSource, "model");
    assert.equal(result.countedInputTokens, 2);
  });

  it("does not sample when the tokenize count is over the budget", async () => {
    const { fetchImpl, calls } = fetchSpy(() => ({ token_ids: [{ token_id: 1 }, { token_id: 2 }, { token_id: 3 }] }));
    const result = await runGrokExchange(
      { model: "grok-4.5", messages: [{ role: "user", content: "ping" }], timeoutSeconds: 30, maxOutputTokens: 16, temperature: null, topP: null, seed: null },
      { ...enabled, contextFloor: "18" },
      fetchImpl,
    );
    assert.equal(calls.length, 1);
    assert.equal(result.executionStatus, "blocked");
    assert.match(result.error?.message ?? "", /exceeds the context window/);
    assert.equal(result.contextBudget.budget, 2);
  });

  it("fails the turn when server usage exceeds the budget and keeps a null usage null", async () => {
    const { fetchImpl } = fetchSpy((_url, _body, nth) => {
      if (nth === 1) return { token_ids: [{ token_id: 4 }] };
      return {
        id: "resp-2",
        model: "grok-4.5",
        choices: [{ finish_reason: "stop", message: { content: "secret-cipher-should-not-matter", encrypted_content: "cipher-blob-abc" } }],
        usage: { prompt_tokens: 50, completion_tokens: 3, total_tokens: 53, completion_tokens_details: { reasoning_tokens: 1 } },
      };
    });
    const over = await runGrokExchange(
      { model: "grok-4", messages: [{ role: "user", content: "ping" }], timeoutSeconds: 30, maxOutputTokens: 16, temperature: null, topP: null, seed: null },
      { ...enabled, contextFloor: "40" },
      fetchImpl,
    );
    assert.equal(over.executionStatus, "error");
    assert.equal(over.providerUsage?.input_tokens, 50);
    assert.equal(over.providerUsage?.reasoning_tokens, 1);
    assert.equal(readUsage(undefined), null);
    assert.equal(readUsage({}), null);
  });

  it("omits encrypted content from the stored response", async () => {
    const { fetchImpl } = fetchSpy((_url, _body, nth) => {
      if (nth === 1) return { token_ids: [{ token_id: 4 }] };
      return {
        id: "resp-3",
        model: "grok-4.5",
        choices: [{ finish_reason: "stop", message: { content: "visible", encrypted_content: "cipher-blob-abc" } }],
      };
    });
    const result = await runGrokExchange(
      { model: "grok-4.5", messages: [{ role: "user", content: "ping" }], timeoutSeconds: 30, maxOutputTokens: 32, temperature: null, topP: null, seed: null },
      enabled,
      fetchImpl,
    );
    assert.equal(result.executionStatus, "success");
    assert.equal(result.responseText, "visible");
    assert.equal(result.reasoningEncryptedOmitted, true);
    assert.equal(result.providerUsage, null);
    assert.equal(JSON.stringify(result).includes("cipher-blob-abc"), false);
  });

  it("records a transport error once and does not fall through to another call", async () => {
    let calls = 0;
    const result = await runGrokExchange(
      { model: "grok-4.5", messages: [{ role: "user", content: "ping" }], timeoutSeconds: 30, maxOutputTokens: 32, temperature: null, topP: null, seed: null },
      enabled,
      async () => {
        calls += 1;
        return new Response("nope xai-super-secret-key", { status: 500 });
      },
    );
    assert.equal(calls, 1);
    assert.equal(result.executionStatus, "error");
    assert.match(result.error?.message ?? "", /500/);
    assert.equal((result.error?.message ?? "").includes("xai-super-secret-key"), false);
  });
});
