/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute.
   One tool-free chat completion to api.openai.com. No retry. store is false.
   There is no xAI tokenize call and no invented token count.
   A failure is returned as a failure. This module never calls the mock. */

import type { ChatMessage, ExchangeResult, Usage } from "./types.ts";
import { chatgptModelWindow } from "./openai-windows.ts";

export const OPENAI_ORIGIN = "https://api.openai.com";
export const CHAT_PATH = "/v1/chat/completions";

export type ChatGptEnv = {
  openaiFlag: string | undefined;
  openaiKey: string | undefined;
};

export type ChatGptCallInput = {
  model: string;
  messages: ChatMessage[];
  timeoutSeconds: number;
  maxOutputTokens: number;
  temperature: number | null;
  topP: number | null;
  seed: number | null;
  contextText?: string;
  contextRole?: "system" | "user";
};

export function assertOpenAiUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.origin !== OPENAI_ORIGIN) {
    throw new Error("ChatGPT endpoint must be api.openai.com");
  }
}

export function buildChatGptBody(input: ChatGptCallInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages.map((message) => ({ role: message.role, content: message.content })),
    max_completion_tokens: input.maxOutputTokens,
    stream: false,
    store: false,
  };
  if (input.temperature !== null) body.temperature = input.temperature;
  if (input.topP !== null) body.top_p = input.topP;
  if (input.seed !== null) body.seed = input.seed;
  return body;
}

function redact(text: string, secret = ""): string {
  return (secret ? text.split(secret).join("[redacted]") : text)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  return name === "TimeoutError" || name === "AbortError";
}

function readUsage(source: unknown): Usage | null {
  const usage = asRecord(source);
  if (!usage) return null;
  const result: Usage = {};
  if (Number.isSafeInteger(usage.prompt_tokens) && (usage.prompt_tokens as number) >= 0) result.input_tokens = usage.prompt_tokens as number;
  if (Number.isSafeInteger(usage.completion_tokens) && (usage.completion_tokens as number) >= 0) result.output_tokens = usage.completion_tokens as number;
  if (Number.isSafeInteger(usage.total_tokens) && (usage.total_tokens as number) >= 0) result.total_tokens = usage.total_tokens as number;
  const details = asRecord(usage.completion_tokens_details);
  if (details && Number.isSafeInteger(details.reasoning_tokens) && (details.reasoning_tokens as number) >= 0) {
    result.reasoning_tokens = details.reasoning_tokens as number;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function budgetFor(input: ChatGptCallInput, window: number | null, blockedReason: string | null) {
  const empty = (input.contextText ?? "").length === 0;
  return {
    model: input.model,
    contextFloor: window,
    modelContextWindow: window,
    contextFloorSource: window === null ? "unavailable" : "model",
    budget: window === null ? null : Math.max(window - input.maxOutputTokens, 0),
    countedInputTokens: null as number | null,
    countSource: "not_counted",
    blockedReason,
    injectionTokens: empty ? 0 : null,
    injectionCountSource: empty ? "empty context; injector tokens are explicitly zero" : "not_counted",
  };
}

function failure(
  status: ExchangeResult["executionStatus"],
  type: string,
  message: string,
  contextBudget: ExchangeResult["contextBudget"],
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
    countedInputTokens: null,
    countSource: "not_counted",
    contextBudget,
    ...extra,
  };
}

export async function runChatGptExchange(
  input: ChatGptCallInput,
  env: ChatGptEnv,
  fetchImpl: typeof fetch,
): Promise<ExchangeResult> {
  if (env.openaiFlag !== "1" || !env.openaiKey) {
    const message = "Requires WORKBENCH_ENABLE_CHATGPT=1 and server-side OPENAI_API_KEY";
    return failure("blocked", "AccessError", message, budgetFor(input, null, message));
  }
  let window: number;
  try {
    window = chatgptModelWindow(input.model);
  } catch {
    const message = "That ChatGPT model is not in the pinned window table.";
    return failure("blocked", "AccessError", message, budgetFor(input, null, message));
  }
  const gate = budgetFor(input, window, null);
  const url = `${OPENAI_ORIGIN}${CHAT_PATH}`;
  assertOpenAiUrl(url);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildChatGptBody(input)),
      signal: AbortSignal.timeout(input.timeoutSeconds * 1000),
    });
  } catch (error) {
    if (isTimeout(error)) return failure("timeout", "TimeoutError", "The ChatGPT attempt timed out", gate);
    const message = redact(error instanceof Error ? error.message : "ChatGPT request failed", env.openaiKey);
    return failure("error", "ProviderError", message, gate);
  }
  if (response.url) {
    try {
      assertOpenAiUrl(response.url);
    } catch {
      return failure("error", "ProviderError", "ChatGPT response came from an unexpected host", gate);
    }
  }
  if (!response.ok) {
    const detail = redact(await response.text().catch(() => ""), env.openaiKey).slice(0, 500);
    return failure("error", "ProviderError", `ChatGPT chat failed (${response.status}): ${detail}`, gate);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return failure("error", "ProviderError", "ChatGPT returned a malformed response", gate);
  }
  const body = asRecord(json);
  const usage = readUsage(body?.usage);
  const choice = Array.isArray(body?.choices) ? asRecord(body.choices[0]) : null;
  const message = asRecord(choice?.message);
  const content = typeof message?.content === "string" ? message.content : null;
  const finish = choice?.finish_reason;
  const serverIn = usage?.input_tokens;
  const budgetWarning =
    typeof serverIn === "number" && gate.budget !== null && serverIn > gate.budget
      ? `Provider reported ${serverIn} input tokens after a completed reply. The calculated input allowance was ${gate.budget}. No preflight token count was taken. This request was not blocked before it ran.`
      : undefined;
  const receipt = {
    returnedModel: typeof body?.model === "string" ? body.model : null,
    providerResponseId: typeof body?.id === "string" ? body.id : null,
    providerUsage: usage,
    reasoningEncryptedOmitted: false,
  };
  if (finish === "length") {
    return failure("incomplete", "Incomplete", "The reply was cut off at the max output cap. It is not conversation history.", gate, {
      ...receipt,
      responseText: content,
      responseStatus: "length",
    });
  }
  if (finish === "stop" && content !== null) {
    return {
      executionStatus: "success",
      responseText: content,
      responseStatus: "completed",
      error: null,
      countedInputTokens: null,
      countSource: "not_counted",
      contextBudget: gate,
      ...receipt,
      ...(budgetWarning ? { budgetWarning } : {}),
    };
  }
  return failure("error", "ProviderError", "ChatGPT returned a malformed response", gate, receipt);
}
