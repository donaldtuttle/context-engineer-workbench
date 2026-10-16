/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute.
   Shared-store detection reads DATABASE_URL directly. Importing the
   database module boots PGLite when that URL is absent, and that boot
   is not a deployment cap. */

import { readQuotaConfig } from "./limits.ts";
import type { PaidEnv } from "./paid-turn.ts";

export function readPaidEnv(): PaidEnv {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  return {
    enableFlag: process.env.WORKBENCH_ENABLE_GROK,
    apiKey: process.env.XAI_API_KEY,
    contextFloor: process.env.WORKBENCH_GROK_CONTEXT_FLOOR,
    accessToken: process.env.WORKBENCH_ACCESS_TOKEN,
    openaiFlag: process.env.WORKBENCH_ENABLE_CHATGPT,
    openaiKey: process.env.OPENAI_API_KEY,
    quota: readQuotaConfig({
      ratePerMin: process.env.WORKBENCH_RATE_PER_MIN,
      dailyRequestCap: process.env.WORKBENCH_DAILY_REQUEST_CAP,
      dailyTokenCap: process.env.WORKBENCH_DAILY_TOKEN_CAP,
      concurrency: process.env.WORKBENCH_MAX_CONCURRENCY,
    }),
    sharedStore: Boolean(databaseUrl),
  };
}