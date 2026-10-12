/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute. */

import { sha256Text, utf8ByteLength } from "./hash.ts";
import { assembleMessages, promptByteLength, promptSha256, replayableHistory } from "./messages.ts";
import { finalizeTurn } from "./records.ts";
import {
  LOCAL_BYTE_CEILING,
  MEASUREMENT_SCOPE,
  MOCK_MODEL,
  SCHEMA_VERSION,
  DEFAULT_TEMPERATURE,
  DEFAULT_TOP_P,
  emptyState,
  type Clock,
  type Conversation,
  type Draft,
  type ExchangeResult,
  type PersistedState,
  type TurnRecord,
} from "./types.ts";

export function systemClock(): Clock {
  return {
    now: () => new Date().toISOString(),
    conversationId: () => crypto.randomUUID(),
    turnId: () => crypto.randomUUID(),
  };
}

export function activeConversation(state: PersistedState): Conversation | null {
  return state.conversations.find((conversation) => conversation.id === state.activeId) ?? null;
}

export function sameBinding(conversation: Conversation, draft: Draft): boolean {
  return (
    conversation.contextText === draft.text &&
    conversation.deliveryMode === draft.deliveryMode &&
    conversation.provider === draft.provider &&
    conversation.model === draft.model
  );
}

export function divergenceReasons(conversation: Conversation | null, draft: Draft): string[] {
  if (!conversation) return ["No active conversation"];
  const reasons: string[] = [];
  if (conversation.contextText !== draft.text) reasons.push("context text");
  if (conversation.deliveryMode !== draft.deliveryMode) reasons.push("delivery mode");
  if (conversation.provider !== draft.provider) reasons.push("provider");
  if (conversation.model !== draft.model) reasons.push("model");
  return reasons;
}

function settingsFrom(draft: Draft) {
  return {
    provider: draft.provider,
    model: draft.model,
    deliveryMode: draft.deliveryMode,
    timeoutSeconds: draft.timeoutSeconds,
    maxOutputTokens: draft.maxOutputTokens,
    temperature: draft.temperature,
    topP: draft.topP,
    seed: draft.seed,
  };
}

function hasPending(conversation: Conversation): boolean {
  return conversation.turns.some((turn) => turn.executionStatus === "pending");
}

export type BeginResult =
  | { ok: true; state: PersistedState; conversationId: string; turnId: string }
  | { ok: false; reason: string };

export async function beginSend(state: PersistedState, userPrompt: string, clock: Clock = systemClock()): Promise<BeginResult> {
  const prompt = userPrompt.trim();
  if (!prompt) return { ok: false, reason: "Enter a prompt." };
  const draft = state.draft;
  if (draft.provider === "grok" && !draft.model.trim()) {
    return { ok: false, reason: "Enter a Grok model ID." };
  }
  if (
    !Number.isFinite(draft.timeoutSeconds) ||
    draft.timeoutSeconds < 0.05 ||
    draft.timeoutSeconds > 300
  ) {
    return { ok: false, reason: "Timeout must be between 0.05 and 300 seconds." };
  }
  if (
    !Number.isInteger(draft.maxOutputTokens) ||
    draft.maxOutputTokens < 16 ||
    draft.maxOutputTokens > 8192
  ) {
    return { ok: false, reason: "Max output must be an integer from 16 to 8192." };
  }
  if (draft.temperature !== null && (draft.temperature < 0 || draft.temperature > 2)) {
    return { ok: false, reason: "Temperature must be empty or between 0 and 2." };
  }
  if (draft.topP !== null && (draft.topP < 0 || draft.topP > 1)) {
    return { ok: false, reason: "Top-p must be empty or between 0 and 1." };
  }
  if (draft.seed !== null && !Number.isInteger(draft.seed)) {
    return { ok: false, reason: "Seed must be empty or an integer." };
  }

  const current = activeConversation(state);
  if (current && sameBinding(current, draft) && hasPending(current)) {
    return { ok: false, reason: "A send is already open on this conversation." };
  }

  const createdAt = clock.now();
  let conversation: Conversation;
  let conversations: Conversation[];
  if (current && sameBinding(current, draft)) {
    conversation = { ...current, contextName: draft.name };
    conversations = state.conversations.map((item) => (item.id === current.id ? conversation : item));
  } else {
    const contextSha256 = await sha256Text(draft.text);
    conversation = {
      id: clock.conversationId(),
      createdAt,
      contextName: draft.name,
      contextText: draft.text,
      contextSha256,
      deliveryMode: draft.deliveryMode,
      provider: draft.provider,
      model: draft.model,
      turns: [],
    };
    conversations = [...state.conversations, conversation];
  }

  const history = replayableHistory(conversation.turns, conversation.provider);
  const assembledMessages = assembleMessages({
    contextText: conversation.contextText,
    deliveryMode: conversation.deliveryMode,
    history,
    userPrompt: prompt,
  });
  const [contextSha256, promptHash] = await Promise.all([
    sha256Text(conversation.contextText),
    promptSha256(assembledMessages),
  ]);
  const promptBytes = promptByteLength(assembledMessages);
  const turn: TurnRecord = {
    id: clock.turnId(),
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    finalizedAt: null,
    executionStatus: "pending",
    requestedModel: draft.provider === "mock" ? MOCK_MODEL : draft.model,
    returnedModel: null,
    responseStatus: null,
    settings: settingsFrom(draft),
    contextName: draft.name,
    frozenContextText: conversation.contextText,
    contextSha256,
    promptSha256: promptHash,
    recordSha256: null,
    assembledMessages,
    userPrompt: prompt,
    responseText: null,
    error: null,
    preflight: {
      contextChars: conversation.contextText.length,
      contextUtf8Bytes: utf8ByteLength(conversation.contextText),
      messageCount: assembledMessages.length,
      promptUtf8Bytes: promptBytes,
      countedInputTokens: null,
      measurementScope: MEASUREMENT_SCOPE,
      countSource: "pending",
    },
    providerUsage: null,
    providerResponseId: null,
    reasoningEncryptedOmitted: false,
    contextBudget: {
      model: draft.provider === "mock" ? MOCK_MODEL : draft.model,
      contextFloor: null,
      modelContextWindow: null,
      contextFloorSource: "pending",
      budget: null,
      countedInputTokens: null,
      countSource: "pending",
      blockedReason: null,
    },
    transport:
      draft.provider === "mock"
        ? { kind: "OFFLINE_FIXTURE", network: "blocked" }
        : {
            kind: "xai-https",
            origin: "https://api.x.ai",
            tokenizePath: "/v1/tokenize-text",
            chatPath: "/v1/chat/completions",
            retries: 0,
            storeMessages: false,
            tools: false,
            encryptedContentStored: false,
          },
  };

  const withTurn: Conversation = { ...conversation, turns: [...conversation.turns, turn] };
  return {
    ok: true,
    conversationId: withTurn.id,
    turnId: turn.id,
    state: {
      ...state,
      conversations: conversations.map((item) => (item.id === withTurn.id ? withTurn : item)),
      activeId: withTurn.id,
    },
  };
}

export function localBlockReason(turn: TurnRecord): string | null {
  if (turn.preflight.promptUtf8Bytes > LOCAL_BYTE_CEILING) {
    return `Request exceeds the local size ceiling (${turn.preflight.promptUtf8Bytes} UTF-8 bytes of messages-json-v1, ceiling ${LOCAL_BYTE_CEILING}). Nothing was truncated or sent.`;
  }
  return null;
}

export function blockedLocally(reason: string, model: string): ExchangeResult {
  return {
    executionStatus: "blocked",
    responseText: null,
    responseStatus: null,
    error: { type: "ContextWindowError", message: reason },
    returnedModel: null,
    providerResponseId: null,
    providerUsage: null,
    reasoningEncryptedOmitted: false,
    countedInputTokens: null,
    countSource: "not_counted",
    contextBudget: {
      model,
      contextFloor: null,
      modelContextWindow: null,
      contextFloorSource: "local_byte_ceiling",
      budget: null,
      countedInputTokens: null,
      countSource: "not_counted",
      blockedReason: reason,
    },
  };
}

export async function commitResult(
  state: PersistedState,
  conversationId: string,
  turnId: string,
  result: ExchangeResult,
  finalizedAt: string,
): Promise<PersistedState> {
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) return state;
  const turn = conversation.turns.find((item) => item.id === turnId);
  if (!turn || turn.executionStatus !== "pending") return state;
  const finalized = await finalizeTurn(turn, result, finalizedAt);
  const nextConversation: Conversation = {
    ...conversation,
    turns: conversation.turns.map((item) => (item.id === turnId ? finalized : item)),
  };
  return {
    ...state,
    conversations: state.conversations.map((item) => (item.id === conversationId ? nextConversation : item)),
  };
}

export async function startBaseline(state: PersistedState, clock: Clock = systemClock()): Promise<PersistedState> {
  const draft: Draft = { ...state.draft, text: "" };
  const contextSha256 = await sha256Text("");
  const conversation: Conversation = {
    id: clock.conversationId(),
    createdAt: clock.now(),
    contextName: draft.name,
    contextText: "",
    contextSha256,
    deliveryMode: draft.deliveryMode,
    provider: draft.provider,
    model: draft.model,
    turns: [],
  };
  return {
    ...state,
    draft,
    conversations: [...state.conversations, conversation],
    activeId: conversation.id,
  };
}

export function deleteConversation(state: PersistedState, id: string): PersistedState {
  const conversations = state.conversations.filter((conversation) => conversation.id !== id);
  const activeId =
    state.activeId === id ? (conversations[conversations.length - 1]?.id ?? null) : state.activeId;
  return { ...state, conversations, activeId };
}

export async function recoverInterrupted(state: PersistedState, finalizedAt: string): Promise<PersistedState> {
  let next = state;
  for (const conversation of state.conversations) {
    for (const turn of conversation.turns) {
      if (turn.executionStatus !== "pending") continue;
      next = await commitResult(
        next,
        conversation.id,
        turn.id,
        {
          executionStatus: "error",
          responseText: null,
          responseStatus: null,
          error: {
            type: "Interrupted",
            message: "This turn was still open when the session reloaded. It was not retried and is not conversation history.",
          },
          returnedModel: null,
          providerResponseId: null,
          providerUsage: null,
          reasoningEncryptedOmitted: false,
          countedInputTokens: null,
          countSource: "not_counted",
          contextBudget: {
            ...turn.contextBudget,
            contextFloorSource: "interrupted",
            countSource: "not_counted",
            blockedReason: null,
          },
        },
        finalizedAt,
      );
    }
  }
  return next;
}

export function parsePersisted(raw: string | null): PersistedState {
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (parsed.version !== 1 || !parsed.draft || !Array.isArray(parsed.conversations)) return emptyState();
    return {
      version: 1,
      draft: {
        ...emptyState().draft,
        ...parsed.draft,
        temperature: parsed.draft.temperature ?? DEFAULT_TEMPERATURE,
        topP: parsed.draft.topP ?? DEFAULT_TOP_P,
      },
      conversations: parsed.conversations,
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
    };
  } catch {
    return emptyState();
  }
}
