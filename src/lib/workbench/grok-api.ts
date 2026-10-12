/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute.
   The API key and the access token are read only inside server handlers.
   Neither value is returned. Origin is checked and is not authorization. */

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
      model: "",
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

export const grokAvailability = createServerFn({ method: "GET" }).handler(async () => {
  const { accessConfigError } = await import("./access.ts");
  const { readPaidEnv } = await import("./paid-env.server.ts");
  const env = readPaidEnv();
  const access = accessConfigError(env.accessToken);
  const enabled = env.enableFlag === "1" && Boolean(env.apiKey) && !access && env.sharedStore && env.quota?.ok === true;
  let reason: string | null = null;
  if (!enabled) {
    if (env.enableFlag !== "1" || !env.apiKey) reason = "Requires WORKBENCH_ENABLE_GROK=1 and server-side XAI_API_KEY";
    else if (access) reason = access;
    else if (!env.sharedStore) reason = "Paid Grok is locked until DATABASE_URL points at the shared quota store.";
    else reason = env.quota && !env.quota.ok ? env.quota.reason : "Paid Grok is not available.";
  }
  return { enabled, reason };
});

export const runGrokTurn = createServerFn({ method: "POST" })
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
      request = { origin: incoming.headers.get("origin"), host: url.host };
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
        return refusal("The shared limiter is unavailable. Paid Grok was not called.");
      }
    }
    return executePaidTurn({
      data,
      env: readPaidEnv(),
      fetchImpl: fetch,
      store,
      request,
      headers,
    });
  });
