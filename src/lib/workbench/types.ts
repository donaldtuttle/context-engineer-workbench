/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute. */

export const SCHEMA_VERSION = "cew-record-v1" as const;
export const MESSAGE_SCHEMA = "messages-json-v1" as const;
export const MOCK_MODEL = "fixture-echo-v2";
export const DEFAULT_TIMEOUT_SECONDS = 30;
export const DEFAULT_MAX_OUTPUT_TOKENS = 512;
export const DEFAULT_TEMPERATURE = 1;
export const DEFAULT_TOP_P = 1;
export const LOCAL_BYTE_CEILING = 1_500_000;
export const MEASUREMENT_SCOPE =
  "Local counts are UTF-8 bytes of the context text and of messages-json-v1. A Grok token count, when present, is xAI tokenize on role-labeled message text and excludes chat-template overhead. These counts do not verify model compliance.";

export type DeliveryMode = "SYSTEM_SLOT" | "USER_PASTE";
export type ProviderId = "mock" | "grok";
export type ExecutionStatus = "pending" | "success" | "error" | "timeout" | "blocked" | "incomplete";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type SamplingSettings = {
  provider: ProviderId;
  model: string;
  deliveryMode: DeliveryMode;
  timeoutSeconds: number;
  maxOutputTokens: number;
  temperature: number | null;
  topP: number | null;
  seed: number | null;
};

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  reasoning_tokens?: number;
};

export type ContextBudget = {
  model: string;
  contextFloor: number | null;
  modelContextWindow: number | null;
  contextFloorSource: string;
  budget: number | null;
  countedInputTokens: number | null;
  /** Tokens in the injector text alone. Omitted on records that never measured it. */
  injectionTokens?: number | null;
  countSource: string;
  blockedReason: string | null;
  /** Scope for the injector-only tokenize. Omitted on records that never measured it. */
  injectionCountSource?: string;
  budgetWarning?: string;
};

export type QuotaAccounting = {
  period: string;
  reservedTokens: number;
  settledTokens: number | null;
};

export type Preflight = {
  contextChars: number;
  contextUtf8Bytes: number;
  messageCount: number;
  promptUtf8Bytes: number;
  countedInputTokens: number | null;
  measurementScope: string;
  countSource: string;
};

export type TurnError = {
  type: string;
  message: string;
};

export type TransportRecord =
  | {
      kind: "OFFLINE_FIXTURE";
      network: "blocked";
    }
  | {
      kind: "xai-https";
      origin: "https://api.x.ai";
      tokenizePath: "/v1/tokenize-text";
      chatPath: "/v1/chat/completions";
      retries: 0;
      storeMessages: false;
      tools: false;
      encryptedContentStored: false;
    };

export type TurnRecord = {
  id: string;
  schemaVersion: typeof SCHEMA_VERSION;
  createdAt: string;
  finalizedAt: string | null;
  executionStatus: ExecutionStatus;
  requestedModel: string;
  returnedModel: string | null;
  responseStatus: string | null;
  settings: SamplingSettings;
  contextName: string;
  frozenContextText: string;
  contextSha256: string;
  promptSha256: string;
  recordSha256: string | null;
  assembledMessages: ChatMessage[];
  userPrompt: string;
  responseText: string | null;
  error: TurnError | null;
  preflight: Preflight;
  providerUsage: Usage | null;
  providerResponseId: string | null;
  reasoningEncryptedOmitted: boolean;
  contextBudget: ContextBudget;
  transport: TransportRecord;
  budgetWarning?: string;
  quotaAccounting?: QuotaAccounting;
};

export type Conversation = {
  id: string;
  createdAt: string;
  contextName: string;
  contextText: string;
  contextSha256: string;
  deliveryMode: DeliveryMode;
  provider: ProviderId;
  model: string;
  turns: TurnRecord[];
};

export type Draft = {
  name: string;
  text: string;
  deliveryMode: DeliveryMode;
  provider: ProviderId;
  model: string;
  timeoutSeconds: number;
  maxOutputTokens: number;
  temperature: number | null;
  topP: number | null;
  seed: number | null;
};

export type PersistedState = {
  version: 1;
  draft: Draft;
  conversations: Conversation[];
  activeId: string | null;
};

export type ExchangeResult = {
  executionStatus: Exclude<ExecutionStatus, "pending">;
  responseText: string | null;
  responseStatus: string | null;
  error: TurnError | null;
  returnedModel: string | null;
  providerResponseId: string | null;
  providerUsage: Usage | null;
  contextBudget: ContextBudget;
  countedInputTokens: number | null;
  countSource: string;
  reasoningEncryptedOmitted: boolean;
  budgetWarning?: string;
  quotaAccounting?: QuotaAccounting;
};

export type Clock = {
  now: () => string;
  conversationId: () => string;
  turnId: () => string;
};

export function defaultDraft(): Draft {
  return {
    name: "",
    text: "",
    deliveryMode: "SYSTEM_SLOT",
    provider: "mock",
    model: "grok-4.5",
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: DEFAULT_TEMPERATURE,
    topP: DEFAULT_TOP_P,
    seed: null,
  };
}

export function emptyState(): PersistedState {
  return { version: 1, draft: defaultDraft(), conversations: [], activeId: null };
}
