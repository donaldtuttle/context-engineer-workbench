/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute.
   Offline fixture. No network. Adapted from the workbench MockProvider receipt. */

import { MOCK_MODEL, type ChatMessage, type ExchangeResult } from "./types.ts";

export function runMockExchange(input: {
  messages: ChatMessage[];
  contextText: string;
  promptSha256: string;
  seed: number | null;
  blockedReason: string | null;
}): ExchangeResult {
  if (input.blockedReason) {
    return {
      executionStatus: "blocked",
      responseText: null,
      responseStatus: null,
      error: { type: "ContextWindowError", message: input.blockedReason },
      returnedModel: null,
      providerResponseId: null,
      providerUsage: null,
      reasoningEncryptedOmitted: false,
      countedInputTokens: null,
      countSource: "not_counted",
      contextBudget: {
        model: MOCK_MODEL,
        contextFloor: null,
        modelContextWindow: null,
        contextFloorSource: "not_applicable",
        budget: null,
        countedInputTokens: null,
        countSource: "not_counted",
        blockedReason: input.blockedReason,
      },
    };
  }
  const last = input.messages[input.messages.length - 1];
  const receipt = {
    kind: "OFFLINE_FIXTURE",
    notice: "Synthetic acknowledgement. No model answered or evaluated this task.",
    task_received: last?.content ?? "",
    message_count: input.messages.length,
    injector_present: input.contextText.length > 0,
    assembled_prompt_sha256: input.promptSha256,
    fixture_seed: input.seed,
  };
  return {
    executionStatus: "success",
    responseText: JSON.stringify(receipt, null, 2),
    responseStatus: "completed",
    error: null,
    returnedModel: MOCK_MODEL,
    providerResponseId: null,
    providerUsage: null,
    reasoningEncryptedOmitted: false,
    countedInputTokens: null,
    countSource: "not_counted",
    contextBudget: {
      model: MOCK_MODEL,
      contextFloor: null,
      modelContextWindow: null,
      contextFloorSource: "not_applicable",
      budget: null,
      countedInputTokens: null,
      countSource: "not_counted",
      blockedReason: null,
    },
  };
}
