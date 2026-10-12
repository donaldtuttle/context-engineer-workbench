/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute.
   The API key is read only inside this server handler. It is never returned. */

import { createServerFn } from "@tanstack/react-start";
import { runGrokExchange, type GrokCallInput, type GrokEnv } from "./grok-adapter.ts";
import type { ChatMessage, ExchangeResult } from "./types.ts";

export function readGrokEnv(): GrokEnv {
  return {
    enableFlag: process.env.WORKBENCH_ENABLE_GROK,
    apiKey: process.env.XAI_API_KEY,
    contextFloor: process.env.WORKBENCH_GROK_CONTEXT_FLOOR,
  };
}

function isRole(value: unknown): value is ChatMessage["role"] {
  return value === "system" || value === "user" || value === "assistant";
}

function parseCall(data: unknown): GrokCallInput | { error: string } {
  if (!data || typeof data !== "object") return { error: "Invalid Grok request" };
  const body = data as Record<string, unknown>;
  if (typeof body.model !== "string" || !body.model.trim()) return { error: "Enter a Grok model ID." };
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 200) {
    return { error: "Assembled messages were missing." };
  }
  const messages: ChatMessage[] = [];
  for (const item of body.messages) {
    if (!item || typeof item !== "object") return { error: "Assembled messages were unreadable." };
    const message = item as Record<string, unknown>;
    if (!isRole(message.role) || typeof message.content !== "string") {
      return { error: "Assembled messages were unreadable." };
    }
    messages.push({ role: message.role, content: message.content });
  }
  const timeoutSeconds = body.timeoutSeconds;
  const maxOutputTokens = body.maxOutputTokens;
  if (typeof timeoutSeconds !== "number" || timeoutSeconds < 0.05 || timeoutSeconds > 300) {
    return { error: "Timeout must be between 0.05 and 300 seconds." };
  }
  if (typeof maxOutputTokens !== "number" || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 16 || maxOutputTokens > 8192) {
    return { error: "Max output must be an integer from 16 to 8192." };
  }
  const temperature = body.temperature;
  const topP = body.topP;
  const seed = body.seed;
  if (!(temperature === null || (typeof temperature === "number" && temperature >= 0 && temperature <= 2))) {
    return { error: "Temperature must be empty or between 0 and 2." };
  }
  if (!(topP === null || (typeof topP === "number" && topP >= 0 && topP <= 1))) {
    return { error: "Top-p must be empty or between 0 and 1." };
  }
  if (!(seed === null || (typeof seed === "number" && Number.isInteger(seed)))) {
    return { error: "Seed must be empty or an integer." };
  }
  const contextText = body.contextText === undefined ? "" : body.contextText;
  if (typeof contextText !== "string") return { error: "Injector text was unreadable." };
  let contextRole: "system" | "user" | undefined;
  if (contextText.length > 0) {
    if (body.contextRole !== "system" && body.contextRole !== "user") {
      return { error: "Injector delivery was unreadable." };
    }
    contextRole = body.contextRole;
  }
  return {
    model: body.model,
    messages,
    timeoutSeconds,
    maxOutputTokens,
    temperature,
    topP,
    seed,
    contextText,
    contextRole,
  };
}

export const grokAvailability = createServerFn({ method: "GET" }).handler(async () => {
  const env = readGrokEnv();
  const enabled = env.enableFlag === "1" && Boolean(env.apiKey);
  return {
    enabled,
    reason: enabled ? null : "Requires WORKBENCH_ENABLE_GROK=1 and server-side XAI_API_KEY",
  };
});

export const runGrokTurn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<ExchangeResult> => {
    const parsed = parseCall(data);
    if ("error" in parsed) {
      return {
        executionStatus: "error",
        responseText: null,
        responseStatus: null,
        error: { type: "ValidationError", message: parsed.error },
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
          contextFloorSource: "invalid_request",
          budget: null,
          countedInputTokens: null,
          countSource: "not_counted",
          blockedReason: parsed.error,
        },
      };
    }
    return runGrokExchange(parsed, readGrokEnv(), fetch);
  });
