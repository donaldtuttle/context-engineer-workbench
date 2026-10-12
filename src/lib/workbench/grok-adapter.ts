/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute.
   Behavior adapted from prompt-engineering-workbench workbench/providers.py
   GrokProvider and _XaiTransport. This runtime has no Python gRPC SDK.
   The call sequence is preserved: one tokenize, then one tool-free sample.
   Host is api.x.ai. Retries stay off. store is false. Tools are omitted.
   Encrypted reasoning content is not written into the local record.
   A failure is returned as a failure. This module never calls the mock. */

import { LOCAL_BYTE_CEILING, type ChatMessage, type ExchangeResult, type Usage } from "./types.ts";
import { promptByteLength } from "./messages.ts";
import { cappedWindow, grokModelWindow } from "./windows.ts";

export const XAI_ORIGIN = "https://api.x.ai";
export const TOKENIZE_PATH = "/v1/tokenize-text";
export const CHAT_PATH = "/v1/chat/completions";

export type GrokEnv = {
  enableFlag: string | undefined;
  apiKey: string | undefined;
  contextFloor: string | undefined;
};

export type GrokCallInput = {
  model: string;
  messages: ChatMessage[];
  timeoutSeconds: number;
  maxOutputTokens: number;
  temperature: number | null;
  topP: number | null;
  seed: number | null;
  /** Frozen injector text. Empty means the injection contributes no tokens. */
  contextText?: string;
  contextRole?: "system" | "user";
};

export function grokAvailable(env: GrokEnv): boolean {
  return env.enableFlag === "1" && Boolean(env.apiKey);
}

export function grokPromptText(messages: ChatMessage[]): string {
  return messages.map((message) => `${message.role}\n${message.content}`).join("\n");
}

export function assertXaiUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.origin !== XAI_ORIGIN) {
    throw new Error("Grok endpoint must be api.x.ai");
  }
}

export function buildChatBody(input: GrokCallInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages.map((message) => ({ role: message.role, content: message.content })),
    max_tokens: input.maxOutputTokens,
    stream: false,
    store: false,
  };
  if (input.temperature !== null) body.temperature = input.temperature;
  if (input.topP !== null) body.top_p = input.topP;
  if (input.seed !== null) body.seed = input.seed;
  return body;
}

function redact(text: string): string {
  return text
    .replace(/xai-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function intField(source: unknown, name: string): number | undefined {
  const record = asRecord(source);
  const value = record?.[name];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export function readTokenCount(payload: unknown): number {
  const record = asRecord(payload);
  const tokens = record?.token_ids ?? record?.tokens ?? payload;
  if (!Array.isArray(tokens)) throw new Error("Grok token count was unreadable");
  const readable = tokens.every((item) => {
    if (typeof item === "number" && Number.isInteger(item) && item >= 0) return true;
    const id = intField(item, "token_id");
    return id !== undefined && id >= 0;
  });
  if (!readable) throw new Error("Grok token count was unreadable");
  return tokens.length;
}

export function readUsage(payload: unknown): Usage | null {
  const usage = asRecord(payload);
  if (!usage) return null;
  const counts: Usage = {};
  const input = intField(usage, "prompt_tokens") ?? intField(usage, "input_tokens");
  const output = intField(usage, "completion_tokens") ?? intField(usage, "output_tokens");
  const total = intField(usage, "total_tokens");
  const reasoning =
    intField(usage, "reasoning_tokens") ??
    intField(usage.completion_tokens_details, "reasoning_tokens") ??
    intField(usage.output_tokens_details, "reasoning_tokens");
  if (input !== undefined) counts.input_tokens = input;
  if (output !== undefined) counts.output_tokens = output;
  if (total !== undefined) counts.total_tokens = total;
  if (reasoning !== undefined) counts.reasoning_tokens = reasoning;
  return Object.keys(counts).length > 0 ? counts : null;
}

function disabledResult(): ExchangeResult {
  return {
    executionStatus: "error",
    responseText: null,
    responseStatus: null,
    error: { type: "RuntimeError", message: "Grok is disabled or XAI_API_KEY is missing" },
    returnedModel: null,
    providerResponseId: null,
    providerUsage: null,
    reasoningEncryptedOmitted: false,
    countedInputTokens: null,
    countSource: "not_counted",
    contextBudget: {
      model: "",
      contextFloor: null,
      modelContextWindow: null,
      contextFloorSource: "unavailable",
      budget: null,
      countedInputTokens: null,
      countSource: "not_counted",
      blockedReason: "Grok is disabled or XAI_API_KEY is missing",
    },
  };
}

function failure(
  status: ExchangeResult["executionStatus"],
  type: string,
  message: string,
  budget: ExchangeResult["contextBudget"],
  extra: Partial<ExchangeResult> = {},
): ExchangeResult {
  return {
    executionStatus: status,
    responseText: null,
    responseStatus: null,
    error: { type, message },
    returnedModel: null,
    providerResponseId: null,
    providerUsage: null,
    reasoningEncryptedOmitted: false,
    countedInputTokens: budget.countedInputTokens,
    countSource: budget.countSource,
    contextBudget: budget,
    ...extra,
  };
}

function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  return name === "TimeoutError" || name === "AbortError";
}

type PostResult =
  | { ok: true; json: unknown }
  | { ok: false; timeout: boolean; status: number | null; detail: string };

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  apiKey: string,
  signal: AbortSignal,
): Promise<PostResult> {
  assertXaiUrl(url);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, timeout: false, status: response.status, detail: redact(text).slice(0, 500) };
    }
    try {
      return { ok: true, json: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, timeout: false, status: response.status, detail: "Grok response was not JSON" };
    }
  } catch (error) {
    if (isTimeout(error)) {
      return { ok: false, timeout: true, status: null, detail: "The Grok attempt timed out" };
    }
    const message = error instanceof Error ? error.message : "Grok request failed";
    return { ok: false, timeout: false, status: null, detail: redact(message).slice(0, 500) };
  }
}

function readTextContent(content: unknown): { text: string; encryptedOmitted: boolean } {
  if (typeof content === "string") return { text: content, encryptedOmitted: false };
  if (!Array.isArray(content)) return { text: "", encryptedOmitted: false };
  const parts: string[] = [];
  let encryptedOmitted = false;
  for (const part of content) {
    const record = asRecord(part);
    if (!record) continue;
    if (typeof record.encrypted_content === "string" && record.encrypted_content) encryptedOmitted = true;
    if (typeof record.text === "string") parts.push(record.text);
    else if (typeof record.content === "string") parts.push(record.content);
  }
  return { text: parts.join(""), encryptedOmitted };
}

export async function runGrokExchange(
  input: GrokCallInput,
  env: GrokEnv,
  fetchImpl: typeof fetch,
): Promise<ExchangeResult> {
  if (!grokAvailable(env)) {
    const result = disabledResult();
    result.contextBudget = { ...result.contextBudget, model: input.model };
    return result;
  }
  if (!env.apiKey) return disabledResult();

  let documented: number;
  let floor: number;
  let source: "model" | "env_cap";
  try {
    documented = grokModelWindow(input.model);
    const capped = cappedWindow(documented, env.contextFloor);
    floor = capped.floor;
    source = capped.source;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Grok context window check failed";
    const unpinned = message.startsWith("No pinned");
    return failure(unpinned ? "blocked" : "error", unpinned ? "ContextWindowError" : "RuntimeError", message, {
      model: input.model,
      contextFloor: null,
      modelContextWindow: null,
      contextFloorSource: unpinned ? "unpinned" : "invalid_floor",
      budget: null,
      countedInputTokens: null,
      countSource: "not_counted",
      blockedReason: message,
    });
  }

  const budget = floor - input.maxOutputTokens;
  const contextText = input.contextText ?? "";
  const baseBudget = {
    model: input.model,
    contextFloor: floor,
    modelContextWindow: documented,
    contextFloorSource: source,
    budget,
    countedInputTokens: null as number | null,
    injectionTokens: contextText.length > 0 ? (null as number | null) : 0,
    countSource: "not_counted",
    blockedReason: null as string | null,
  };

  const promptBytes = promptByteLength(input.messages);
  if (promptBytes > LOCAL_BYTE_CEILING || budget < 1) {
    const message =
      budget < 1
        ? `Grok input exceeds the context window (max output ${input.maxOutputTokens} leaves no input budget, budget ${budget})`
        : `Request exceeds the local size ceiling (${promptBytes} UTF-8 bytes of messages-json-v1, ceiling ${LOCAL_BYTE_CEILING}). Nothing was truncated or sent.`;
    return failure("blocked", "ContextWindowError", message, {
      ...baseBudget,
      blockedReason: message,
    });
  }

  const deadline = Date.now() + input.timeoutSeconds * 1000;
  const signalFor = (): AbortSignal => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      const error = new Error("timeout");
      error.name = "TimeoutError";
      throw error;
    }
    return AbortSignal.timeout(remaining);
  };

  const countText = async (text: string): Promise<number> => {
    const tokenResponse = await postJson(
      fetchImpl,
      `${XAI_ORIGIN}${TOKENIZE_PATH}`,
      { model: input.model, text },
      env.apiKey as string,
      signalFor(),
    );
    if (!tokenResponse.ok) {
      const message = tokenResponse.timeout
        ? "The Grok attempt timed out"
        : `Grok tokenize failed${tokenResponse.status ? ` (${tokenResponse.status})` : ""}: ${tokenResponse.detail}`;
      const error = new Error(message);
      error.name = tokenResponse.timeout ? "TimeoutError" : "ProviderError";
      throw error;
    }
    return readTokenCount(tokenResponse.json);
  };

  if (contextText.length > 0) {
    try {
      const injectionTokens = await countText(
        grokPromptText([{ role: input.contextRole ?? "user", content: contextText }]),
      );
      baseBudget.injectionTokens = injectionTokens;
      if (injectionTokens > budget) {
        const message = `Injector text exceeds the input budget (${injectionTokens} injection tokens, budget ${budget}). Nothing further was sent.`;
        return failure("blocked", "ContextWindowError", message, {
          ...baseBudget,
          countedInputTokens: injectionTokens,
          countSource: "xai.tokenize injection text; chat-template overhead is not included",
          blockedReason: message,
        });
      }
    } catch (error) {
      if (isTimeout(error)) {
        return failure("timeout", "TimeoutError", "The Grok attempt timed out", baseBudget);
      }
      const message = error instanceof Error ? error.message : "Grok token count was unreadable";
      return failure("error", "ProviderError", message, baseBudget);
    }
  }

  let counted: number;
  try {
    counted = await countText(grokPromptText(input.messages));
  } catch (error) {
    if (isTimeout(error)) {
      return failure("timeout", "TimeoutError", "The Grok attempt timed out", baseBudget);
    }
    const message = error instanceof Error ? error.message : "Grok token count was unreadable";
    return failure("error", "ProviderError", message, baseBudget);
  }

  const gate = {
    ...baseBudget,
    countedInputTokens: counted,
    countSource: "xai.tokenize message text; chat-template overhead is not included",
  };
  if (counted > budget) {
    const message = `Grok input exceeds the context window (${counted} input tokens, budget ${budget})`;
    return failure("blocked", "ContextWindowError", message, { ...gate, blockedReason: message });
  }

  let chat: PostResult;
  try {
    chat = await postJson(
      fetchImpl,
      `${XAI_ORIGIN}${CHAT_PATH}`,
      buildChatBody(input),
      env.apiKey,
      signalFor(),
    );
  } catch (error) {
    if (isTimeout(error)) {
      return failure("timeout", "TimeoutError", "The Grok attempt timed out", gate);
    }
    const message = error instanceof Error ? error.message : "Grok request failed";
    return failure("error", "ProviderError", message, gate);
  }
  if (!chat.ok) {
    const message = chat.timeout
      ? "The Grok attempt timed out"
      : `Grok chat failed${chat.status ? ` (${chat.status})` : ""}: ${chat.detail}`;
    return failure(chat.timeout ? "timeout" : "error", chat.timeout ? "TimeoutError" : "ProviderError", message, gate);
  }

  const body = asRecord(chat.json);
  const usage = readUsage(body?.usage);
  const serverIn = usage?.input_tokens;
  if (typeof serverIn === "number" && serverIn > budget) {
    const message = `Grok input exceeds the context window (${serverIn} input tokens, budget ${budget})`;
    const usageGate = {
      ...gate,
      countedInputTokens: serverIn,
      countSource: "xai.usage.prompt_tokens",
      blockedReason: message,
    };
    return failure("error", "ContextWindowError", message, usageGate, { providerUsage: usage });
  }

  const choice = Array.isArray(body?.choices) ? asRecord(body.choices[0]) : null;
  const message = asRecord(choice?.message);
  const content = readTextContent(message?.content);
  const encrypted =
    content.encryptedOmitted ||
    (typeof message?.encrypted_content === "string" && message.encrypted_content.length > 0) ||
    (typeof body?.encrypted_content === "string" && (body.encrypted_content as string).length > 0);
  const finish = choice?.finish_reason;
  const responseStatus = finish === "stop" || finish === "REASON_STOP" ? "completed" : typeof finish === "string" && finish ? finish : "unknown";
  const returned = typeof body?.model === "string" ? body.model : null;
  const responseId = typeof body?.id === "string" ? body.id : null;

  return {
    executionStatus: "success",
    responseText: content.text,
    responseStatus,
    error: null,
    returnedModel: returned,
    providerResponseId: responseId,
    providerUsage: usage,
    reasoningEncryptedOmitted: Boolean(encrypted),
    countedInputTokens: counted,
    countSource: gate.countSource,
    contextBudget: gate,
  };
}
