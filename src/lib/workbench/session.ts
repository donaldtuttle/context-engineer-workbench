/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute. */

import { canonicalJson, sha256Text, utf8ByteLength } from "./hash.ts";
import { assembleMessages, promptByteLength, promptSha256, replayableHistory, turnHashesMatch } from "./messages.ts";
import { finalizeTurn } from "./records.ts";
import {
  LOCAL_BYTE_CEILING,
  MEASUREMENT_SCOPE,
  MOCK_MODEL,
  SCHEMA_VERSION,
  emptyState,
  type Clock,
  type Conversation,
  type DeliveryMode,
  type Draft,
  type ExchangeResult,
  type PersistedState,
  type ProviderId,
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

const sendGate = new Set<string>();

export async function beginSend(state: PersistedState, userPrompt: string, clock: Clock = systemClock()): Promise<BeginResult> {
  const prompt = userPrompt.trim();
  if (!prompt) return { ok: false, reason: "Enter a prompt." };
  const draft = state.draft;
  if ((draft.provider === "grok" || draft.provider === "chatgpt") && !draft.model.trim()) {
    return { ok: false, reason: draft.provider === "chatgpt" ? "Enter a ChatGPT model ID." : "Enter a Grok model ID." };
  }
  if (
    !Number.isFinite(draft.timeoutSeconds) ||
    draft.timeoutSeconds < 5 ||
    draft.timeoutSeconds > 300
  ) {
    return { ok: false, reason: "Timeout must be between 5 and 300 seconds." };
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
  const reserve =
    current && sameBinding(current, draft)
      ? `conv:${current.id}`
      : `new:${draft.provider}\u0000${draft.model}\u0000${draft.deliveryMode}\u0000${draft.text}`;
  if ((current && sameBinding(current, draft) && hasPending(current)) || sendGate.has(reserve)) {
    return { ok: false, reason: "A send is already open on this conversation." };
  }
  sendGate.add(reserve);
  try {
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

  const history = await replayableHistory(conversation.turns, conversation.provider);
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
        : draft.provider === "chatgpt"
          ? {
              kind: "openai-https",
              origin: "https://api.openai.com",
              chatPath: "/v1/chat/completions",
              retries: 0,
              storeMessages: false,
              tools: false,
            }
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
  } finally {
    sendGate.delete(reserve);
  }
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

export function applySealedTurn(
  state: PersistedState,
  conversationId: string,
  turnId: string,
  sealed: TurnRecord,
): PersistedState {
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) return state;
  const turn = conversation.turns.find((item) => item.id === turnId);
  if (!turn || turn.executionStatus !== "pending") return state;
  const nextConversation: Conversation = {
    ...conversation,
    turns: conversation.turns.map((item) => (item.id === turnId ? sealed : item)),
  };
  return {
    ...state,
    conversations: state.conversations.map((item) => (item.id === conversationId ? nextConversation : item)),
  };
}

function overlayCompleted(base: PersistedState, previous: PersistedState | null): PersistedState {
  if (!previous) return base;
  let next = base;
  for (const conversation of previous.conversations) {
    for (const turn of conversation.turns) {
      if (turn.executionStatus === "pending") continue;
      next = applySealedTurn(next, conversation.id, turn.id, turn);
    }
  }
  return next;
}

let sealChain: Promise<PersistedState | null> = Promise.resolve(null);

export async function commitResult(
  state: PersistedState,
  conversationId: string,
  turnId: string,
  result: ExchangeResult,
  finalizedAt: string,
  readLatest?: () => PersistedState,
): Promise<PersistedState> {
  const latestNow = () => readLatest?.() ?? state;
  const conversation = state.conversations.find((item) => item.id === conversationId);
  const turn = conversation?.turns.find((item) => item.id === turnId);
  if (!conversation || !turn || turn.executionStatus !== "pending") return latestNow();
  const sealed = await finalizeTurn(turn, result, finalizedAt);
  const apply = sealChain.then((previous) => {
    const base = overlayCompleted(latestNow(), previous);
    return applySealedTurn(base, conversationId, turnId, sealed);
  });
  sealChain = apply.then(
    (next) => next,
    () => null,
  );
  return apply;
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
      },
      conversations: parsed.conversations,
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
    };
  } catch {
    return emptyState();
  }
}

export type ImportResult =
  | { kind: "context"; text: string; name: string | null; note: string }
  | { kind: "conversations"; conversations: Conversation[]; note: string }
  | { kind: "error"; note: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isProvider(value: unknown): value is ProviderId {
  return value === "mock" || value === "grok" || value === "chatgpt";
}

function isDelivery(value: unknown): value is DeliveryMode {
  return value === "SYSTEM_SLOT" || value === "USER_PASTE";
}

const TURN_FIELDS = [
  "id",
  "schemaVersion",
  "createdAt",
  "finalizedAt",
  "executionStatus",
  "requestedModel",
  "returnedModel",
  "responseStatus",
  "settings",
  "contextName",
  "frozenContextText",
  "contextSha256",
  "promptSha256",
  "recordSha256",
  "assembledMessages",
  "userPrompt",
  "responseText",
  "error",
  "preflight",
  "providerUsage",
  "providerResponseId",
  "reasoningEncryptedOmitted",
  "contextBudget",
  "transport",
] as const;

const PREFLIGHT_FIELDS = [
  "contextChars",
  "contextUtf8Bytes",
  "messageCount",
  "promptUtf8Bytes",
  "countedInputTokens",
  "measurementScope",
  "countSource",
] as const;

const BUDGET_FIELDS = [
  "model",
  "contextFloor",
  "modelContextWindow",
  "contextFloorSource",
  "budget",
  "countedInputTokens",
  "countSource",
  "blockedReason",
] as const;

const EXECUTION = new Set(["pending", "success", "error", "timeout", "blocked", "incomplete"]);

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function nullableNumber(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function nonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nullableNonNegativeInt(value: unknown): boolean {
  return value === null || nonNegativeInt(value);
}

function missingKeys(record: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.filter((key) => !Object.hasOwn(record, key));
}

function problemsForTurn(value: unknown, label: string): string[] {
  const record = asRecord(value);
  if (!record) return [`${label} is missing a turn object`];
  const id = typeof record.id === "string" && record.id ? record.id : label;
  const missing = missingKeys(record, TURN_FIELDS);
  if (missing.length > 0) return [`${id} is missing ${missing.join(", ")}`];
  const problems: string[] = [];
  if (record.schemaVersion !== SCHEMA_VERSION) problems.push(`${id} has the wrong schema`);
  if (typeof record.id !== "string" || record.id.length === 0) problems.push(`${id} id is invalid`);
  if (typeof record.createdAt !== "string") problems.push(`${id} createdAt is invalid`);
  if (!nullableString(record.finalizedAt)) problems.push(`${id} finalizedAt is invalid`);
  if (typeof record.executionStatus !== "string" || !EXECUTION.has(record.executionStatus)) {
    problems.push(`${id} executionStatus is invalid`);
  }
  if (typeof record.requestedModel !== "string") problems.push(`${id} requestedModel is invalid`);
  if (!nullableString(record.returnedModel)) problems.push(`${id} returnedModel is invalid`);
  if (!nullableString(record.responseStatus)) problems.push(`${id} responseStatus is invalid`);
  if (typeof record.contextName !== "string") problems.push(`${id} contextName is invalid`);
  if (typeof record.frozenContextText !== "string") problems.push(`${id} frozenContextText is invalid`);
  if (typeof record.contextSha256 !== "string") problems.push(`${id} contextSha256 is invalid`);
  if (typeof record.promptSha256 !== "string") problems.push(`${id} promptSha256 is invalid`);
  if (!nullableString(record.recordSha256)) problems.push(`${id} recordSha256 is invalid`);
  if (typeof record.userPrompt !== "string") problems.push(`${id} userPrompt is invalid`);
  if (!nullableString(record.responseText)) problems.push(`${id} responseText is invalid`);
  if (typeof record.reasoningEncryptedOmitted !== "boolean") problems.push(`${id} reasoningEncryptedOmitted is invalid`);
  if (!nullableString(record.providerResponseId)) problems.push(`${id} providerResponseId is invalid`);
  const settings = asRecord(record.settings);
  if (!settings) problems.push(`${id} settings are missing`);
  else {
    const settingsMissing = missingKeys(settings, ["provider", "model", "deliveryMode", "timeoutSeconds", "maxOutputTokens", "temperature", "topP", "seed"]);
    if (settingsMissing.length > 0) problems.push(`${id} settings are missing ${settingsMissing.join(", ")}`);
    else if (!isProvider(settings.provider) || !isDelivery(settings.deliveryMode) || typeof settings.model !== "string" || settings.model.length === 0) {
      problems.push(`${id} settings are invalid`);
    } else if (typeof settings.timeoutSeconds !== "number" || !Number.isFinite(settings.timeoutSeconds) || settings.timeoutSeconds < 0.05 || settings.timeoutSeconds > 300) {
      problems.push(`${id} settings timeoutSeconds is invalid`);
    } else if (!nonNegativeInt(settings.maxOutputTokens) || settings.maxOutputTokens < 16 || settings.maxOutputTokens > 8192) {
      problems.push(`${id} settings maxOutputTokens is invalid`);
    } else if (!nullableNumber(settings.temperature) || (typeof settings.temperature === "number" && (settings.temperature < 0 || settings.temperature > 2))) {
      problems.push(`${id} settings temperature is invalid`);
    } else if (!nullableNumber(settings.topP) || (typeof settings.topP === "number" && (settings.topP < 0 || settings.topP > 1))) {
      problems.push(`${id} settings topP is invalid`);
    } else if (settings.seed !== null && !Number.isSafeInteger(settings.seed)) {
      problems.push(`${id} settings seed is invalid`);
    }
  }
  if (!Array.isArray(record.assembledMessages)) problems.push(`${id} assembledMessages is invalid`);
  else {
    const messagesOk = record.assembledMessages.every((item) => {
      const message = asRecord(item);
      return message !== null && (message.role === "system" || message.role === "user" || message.role === "assistant") && typeof message.content === "string";
    });
    if (!messagesOk) problems.push(`${id} assembledMessages is invalid`);
  }
  if (record.error !== null) {
    const error = asRecord(record.error);
    if (!error || typeof error.type !== "string" || typeof error.message !== "string") problems.push(`${id} error is invalid`);
  }
  const preflight = asRecord(record.preflight);
  if (!preflight) problems.push(`${id} preflight is missing`);
  else {
    const preflightMissing = missingKeys(preflight, PREFLIGHT_FIELDS);
    if (preflightMissing.length > 0) problems.push(`${id} preflight is missing ${preflightMissing.join(", ")}`);
    else if (!nonNegativeInt(preflight.contextChars) || !nonNegativeInt(preflight.contextUtf8Bytes) || !nonNegativeInt(preflight.messageCount) || !nonNegativeInt(preflight.promptUtf8Bytes)) {
      problems.push(`${id} preflight contextUtf8Bytes is invalid`);
    } else if (!nullableNonNegativeInt(preflight.countedInputTokens)) {
      problems.push(`${id} preflight countedInputTokens is invalid`);
    } else if (typeof preflight.measurementScope !== "string" || typeof preflight.countSource !== "string") {
      problems.push(`${id} preflight countSource is invalid`);
    }
  }
  const budget = asRecord(record.contextBudget);
  if (!budget) problems.push(`${id} contextBudget is missing`);
  else {
    const budgetMissing = missingKeys(budget, BUDGET_FIELDS);
    if (budgetMissing.length > 0) problems.push(`${id} contextBudget is missing ${budgetMissing.join(", ")}`);
    else if (typeof budget.model !== "string" || budget.model.length === 0) problems.push(`${id} contextBudget model is invalid`);
    else if (!nullableNonNegativeInt(budget.contextFloor) || !nullableNonNegativeInt(budget.modelContextWindow)) {
      problems.push(`${id} contextBudget contextFloor is invalid`);
    } else if (!nullableNonNegativeInt(budget.countedInputTokens)) {
      problems.push(`${id} contextBudget countedInputTokens is invalid`);
    } else if (!(budget.budget === null || (typeof budget.budget === "number" && Number.isInteger(budget.budget)))) {
      problems.push(`${id} contextBudget budget is invalid`);
    } else if (Object.hasOwn(budget, "injectionTokens") && !nullableNonNegativeInt(budget.injectionTokens)) {
      problems.push(`${id} contextBudget injectionTokens is invalid`);
    } else if (typeof budget.contextFloorSource !== "string" || typeof budget.countSource !== "string" || !nullableString(budget.blockedReason)) {
      problems.push(`${id} contextBudget countSource is invalid`);
    }
  }
  if (record.providerUsage !== null) {
    const usage = asRecord(record.providerUsage);
    if (!usage) problems.push(`${id} providerUsage is invalid`);
    else {
      for (const key of ["input_tokens", "output_tokens", "total_tokens", "reasoning_tokens"]) {
        if (Object.hasOwn(usage, key) && !nonNegativeInt(usage[key])) problems.push(`${id} providerUsage ${key} is invalid`);
      }
    }
  }
  const transport = asRecord(record.transport);
  if (!transport) problems.push(`${id} transport is missing`);
  else if (transport.kind === "OFFLINE_FIXTURE") {
    if (transport.network !== "blocked") problems.push(`${id} transport is invalid`);
  } else if (transport.kind === "xai-https") {
    if (transport.origin !== "https://api.x.ai" || transport.retries !== 0 || transport.storeMessages !== false || transport.tools !== false) {
      problems.push(`${id} transport is invalid`);
    }
  } else if (transport.kind === "openai-https") {
    if (
      transport.origin !== "https://api.openai.com" ||
      transport.chatPath !== "/v1/chat/completions" ||
      transport.retries !== 0 ||
      transport.storeMessages !== false ||
      transport.tools !== false
    ) {
      problems.push(`${id} transport is invalid`);
    }
  } else problems.push(`${id} transport is invalid`);
  if (Object.hasOwn(record, "budgetWarning") && typeof record.budgetWarning !== "string") {
    problems.push(`${id} budgetWarning is invalid`);
  }
  if (Object.hasOwn(record, "quotaAccounting")) {
    const quota = asRecord(record.quotaAccounting);
    if (!quota || typeof quota.period !== "string" || !nonNegativeInt(quota.reservedTokens) || !nullableNonNegativeInt(quota.settledTokens)) {
      problems.push(`${id} quotaAccounting is invalid`);
    }
  }
  if (Object.hasOwn(budget ?? {}, "injectionCountSource") && typeof budget?.injectionCountSource !== "string") {
    problems.push(`${id} contextBudget injectionCountSource is invalid`);
  }
  if (Object.hasOwn(budget ?? {}, "budgetWarning") && typeof budget?.budgetWarning !== "string") {
    problems.push(`${id} contextBudget budgetWarning is invalid`);
  }
  return problems;
}

function conversationProblems(value: unknown): string[] {
  const record = asRecord(value);
  if (!record) return ["A conversation was not an object"];
  const id = typeof record.id === "string" && record.id ? record.id : "conversation";
  const missing = missingKeys(record, ["id", "createdAt", "contextName", "contextText", "contextSha256", "deliveryMode", "provider", "model", "turns"]);
  if (missing.length > 0) return [`${id} is missing ${missing.join(", ")}`];
  const problems: string[] = [];
  if (typeof record.createdAt !== "string") problems.push(`${id} createdAt is invalid`);
  if (typeof record.contextName !== "string") problems.push(`${id} contextName is invalid`);
  if (typeof record.contextText !== "string") problems.push(`${id} contextText is invalid`);
  if (typeof record.contextSha256 !== "string") problems.push(`${id} contextSha256 is invalid`);
  if (!isDelivery(record.deliveryMode)) problems.push(`${id} delivery is invalid`);
  if (!isProvider(record.provider)) problems.push(`${id} provider is invalid`);
  if (typeof record.model !== "string") problems.push(`${id} model is invalid`);
  if (!Array.isArray(record.turns)) problems.push(`${id} turns is not a list`);
  else record.turns.forEach((turn, index) => problems.push(...problemsForTurn(turn, `${id} turn ${index + 1}`)));
  return problems;
}

/** Validate saved data without normalizing or rehashing historical records. */
export function assertPersistedState(value: unknown): asserts value is PersistedState {
  const state = asRecord(value);
  if (!state || state.version !== 1 || !Array.isArray(state.conversations)) throw new Error("Saved session envelope is invalid");
  const draft = asRecord(state.draft);
  if (!draft || typeof draft.name !== "string" || typeof draft.text !== "string" ||
      typeof draft.model !== "string" || !isProvider(draft.provider) || !isDelivery(draft.deliveryMode)) {
    throw new Error("Saved draft is invalid");
  }
  // A draft may contain unfinished numeric edits; preserve finite values, never coerce them.
  for (const key of ["timeoutSeconds", "maxOutputTokens"]) {
    if (typeof draft[key] !== "number" || !Number.isFinite(draft[key])) throw new Error(`Saved draft ${key} is invalid`);
  }
  for (const key of ["temperature", "topP", "seed"]) {
    if (!nullableNumber(draft[key])) throw new Error(`Saved draft ${key} is invalid`);
  }
  if (state.activeId !== null && typeof state.activeId !== "string") throw new Error("Saved active conversation is invalid");
  const ids = new Set<string>();
  for (const conversation of state.conversations) {
    const problems = conversationProblems(conversation);
    if (problems.length) throw new Error(problems.join("; "));
    const item = conversation as Conversation;
    if (!item.id || ids.has(item.id)) throw new Error("Saved conversation ID is missing or duplicated");
    ids.add(item.id);
    const turns = new Set<string>();
    for (const turn of item.turns) {
      if (turns.has(turn.id)) throw new Error("Saved turn ID is duplicated");
      turns.add(turn.id);
    }
  }
  if (state.activeId !== null && !ids.has(state.activeId)) throw new Error("Saved active conversation does not exist");
}

function conversationFromTurn(turn: TurnRecord): Conversation {
  return {
    id: `imported-${turn.id}`,
    createdAt: turn.createdAt,
    contextName: turn.contextName,
    contextText: turn.frozenContextText,
    contextSha256: turn.contextSha256,
    deliveryMode: turn.settings.deliveryMode,
    provider: turn.settings.provider,
    model: turn.settings.model,
    turns: [turn],
  };
}

async function withHashNote(conversations: Conversation[], base: string): Promise<string> {
  const lines: string[] = [];
  for (const conversation of conversations) {
    const contextHash = await sha256Text(conversation.contextText);
    if (contextHash !== conversation.contextSha256) lines.push(`${conversation.id} context hash does not match`);
    for (const turn of conversation.turns) {
      if (!(await turnHashesMatch(turn))) lines.push(`${turn.id} failed a hash check and will not be replayed`);
    }
  }
  return lines.length > 0 ? `${base} ${lines.join(" ")}` : base;
}

export async function interpretImport(filename: string, text: string): Promise<ImportResult> {
  const trimmed = text.replace(/^\uFEFF/, "");
  if (!trimmed.trim()) return { kind: "error", note: "That file was empty." };
  const lower = filename.toLowerCase();
  const looksJson = lower.endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!looksJson) return { kind: "context", text: trimmed, name: null, note: "Imported the file as injector text." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: "error", note: "That file was not valid JSON." };
  }

  const record = asRecord(parsed);
  if (record?.exportSchema === "cew-session-v1" && Array.isArray(record.conversations)) {
    const problems = record.conversations.flatMap((item) => conversationProblems(item));
    if (problems.length > 0) return { kind: "error", note: `Did not import. ${problems.join(" ")}` };
    const conversations = record.conversations as Conversation[];
    if (conversations.length === 0) return { kind: "error", note: "The session file had no conversations." };
    const count = conversations.length;
    const note = await withHashNote(conversations, `Imported ${count} conversation${count === 1 ? "" : "s"}.`);
    return { kind: "conversations", conversations, note };
  }

  if (Array.isArray(parsed)) {
    const problems = parsed.flatMap((item, index) => problemsForTurn(item, `turn ${index + 1}`));
    if (parsed.length === 0) return { kind: "error", note: "That file had no turns." };
    if (problems.length > 0) return { kind: "error", note: `Did not import. ${problems.join(" ")}` };
    const conversations = (parsed as TurnRecord[]).map(conversationFromTurn);
    const note = await withHashNote(conversations, `Imported ${parsed.length} turn${parsed.length === 1 ? "" : "s"}.`);
    return { kind: "conversations", conversations, note };
  }

  if (record?.schemaVersion === SCHEMA_VERSION) {
    const problems = problemsForTurn(parsed, "turn");
    if (problems.length > 0) return { kind: "error", note: `Did not import. ${problems.join(" ")}` };
    const turn = parsed as TurnRecord;
    const base = turn.frozenContextText ? "Imported 1 turn and its injector text." : "Imported 1 turn. Its injector text was empty.";
    const conversations = [conversationFromTurn(turn)];
    return { kind: "conversations", conversations, note: await withHashNote(conversations, base) };
  }

  if (record && typeof record.text === "string") {
    return {
      kind: "context",
      text: record.text,
      name: typeof record.name === "string" ? record.name : null,
      note: "Imported injector text.",
    };
  }

  if (record && typeof record.frozenContextText === "string") {
    return {
      kind: "context",
      text: record.frozenContextText,
      name: typeof record.contextName === "string" ? record.contextName : null,
      note: record.frozenContextText ? "Imported injector text from the file." : "The file's injector text was empty.",
    };
  }

  return { kind: "error", note: "That JSON is not injector text, a turn, or a session export." };
}

export async function mergeImportedConversations(
  state: PersistedState,
  incoming: Conversation[],
): Promise<{ state: PersistedState; note: string }> {
  let conversations = [...state.conversations];
  let activeId = state.activeId;
  let draft = state.draft;
  const notes: string[] = [];
  for (const incomingConversation of incoming) {
    const index = conversations.findIndex((item) => item.id === incomingConversation.id);
    if (index === -1) {
      conversations = [...conversations, incomingConversation];
      activeId = incomingConversation.id;
      draft = draftFromConversation(draft, incomingConversation);
      continue;
    }
    if (canonicalJson(conversations[index]) === canonicalJson(incomingConversation)) {
      notes.push(`Already saved ${incomingConversation.id}.`);
      continue;
    }
    const suffix = (await sha256Text(canonicalJson(incomingConversation))).slice(0, 12);
    const altId = `${incomingConversation.id}~${suffix}`;
    const renamed = { ...incomingConversation, id: altId };
    const altIndex = conversations.findIndex((item) => item.id === altId);
    if (altIndex === -1) {
      conversations = [...conversations, renamed];
      activeId = altId;
      draft = draftFromConversation(draft, renamed);
      notes.push(`Kept saved ${incomingConversation.id}. Stored the different import as ${altId}.`);
    } else if (canonicalJson(conversations[altIndex]) === canonicalJson(renamed)) {
      notes.push(`Already saved ${altId}.`);
    } else {
      const extraId = `${altId}-2`;
      const extra = { ...renamed, id: extraId };
      conversations = [...conversations, extra];
      activeId = extraId;
      draft = draftFromConversation(draft, extra);
      notes.push(`Kept saved ${incomingConversation.id}. Stored the different import as ${extraId}.`);
    }
  }
  return {
    state: { ...state, conversations, activeId, draft },
    note: notes.join(" "),
  };
}

function draftFromConversation(draft: Draft, conversation: Conversation): Draft {
  return {
    ...draft,
    name: conversation.contextName,
    text: conversation.contextText,
    deliveryMode: conversation.deliveryMode,
    provider: conversation.provider,
    model: conversation.model,
  };
}
