/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute.
   The OpenAI key and the access token are read only inside server handlers.
   Neither value is returned. */

import { createServerFn } from "@tanstack/react-start";
import type { ExchangeResult } from "./types.ts";
import type { PaidRequest } from "./paid-turn.ts";
import type { QuotaStore } from "./limits.ts";

function refusal(message: string): ExchangeResult {
  return {
    executionStatus: "blocked",
    responseText: null,
    responseStatus: null,
    error: { type: "AccessError", message },
    returnedModel: null,
    providerResponseId: null,
    providerUsage: null,
    reasoningEncryptedOmitted: false,
    countedInputTokens: null,
    countSource: "not_counted",
    contextBudget: {
      model: "unavailable",
      contextFloor: null,
      modelContextWindow: null,
      contextFloorSource: "unavailable",
      budget: null,
      countedInputTokens: null,
      countSource: "not_counted",
      blockedReason: message,
    },
  };
}

export const chatgptAvailability = createServerFn({ method: "GET" }).handler(async () => {
  const { accessConfigError } = await import("./access.ts");
  const { readPaidEnv } = await import("./paid-env.server.ts");
  const env = readPaidEnv();
  const access = accessConfigError(env.accessToken);
  const enabled = env.openaiFlag === "1" && Boolean(env.openaiKey) && !access && env.sharedStore && env.quota?.ok === true;
  let reason: string | null = null;
  if (!enabled) {
    if (env.openaiFlag !== "1" || !env.openaiKey) reason = "Requires WORKBENCH_ENABLE_CHATGPT=1 and server-side OPENAI_API_KEY";
    else if (access) reason = access;
    else if (!env.sharedStore) reason = "Paid ChatGPT is locked until DATABASE_URL points at the shared quota store.";
    else reason = env.quota && !env.quota.ok ? env.quota.reason : "Paid ChatGPT is not available.";
  }
  return { enabled, reason };
});

export const runChatGptTurn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<ExchangeResult> => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { executePaidTurn } = await import("./paid-turn.ts");
    const { readPaidEnv } = await import("./paid-env.server.ts");
    let request: PaidRequest = { origin: null, host: "" };
    let headers: { get(name: string): string | null } = { get: () => null };
    try {
      const incoming = getRequest();
      const url = new URL(incoming.url);
      request = { origin: incoming.headers.get("origin"), host: url.host, expectedOrigin: url.origin };
      headers = incoming.headers;
    } catch {
      request = { origin: null, host: "" };
    }
    let store: QuotaStore | null = null;
    if (process.env.DATABASE_URL?.trim()) {
      try {
        const { getSql } = await import("@/lib/db");
        const { PostgresQuotaStore } = await import("./quota-store.server.ts");
        store = new PostgresQuotaStore(await getSql());
      } catch {
        return refusal("The shared limiter is unavailable. Paid ChatGPT was not called.");
      }
    }
    const body = data && typeof data === "object" && !Array.isArray(data) ? { ...data, provider: "chatgpt" } : { provider: "chatgpt" };
    return executePaidTurn({
      data: body,
      env: readPaidEnv(),
      fetchImpl: fetch,
      store,
      request,
      headers,
    });
  });
