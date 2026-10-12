/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute.
   Origin is checked and is not authorization. The access token is.
   A missing shared quota store locks paid execution. */

import { accessConfigError, accessTokensMatch, ACCESS_TOKEN_MAX_CHARS } from "./access.ts";
import { promptByteLength, promptSha256 } from "./messages.ts";
import { runGrokExchange, type GrokEnv } from "./grok-adapter.ts";
import { conservativeHold, utcPeriod, QUOTA_HOLD_GRACE_MS, type QuotaLimits, type QuotaStore } from "./limits.ts";
import { sha256Text, utf8ByteLength } from "./hash.ts";
import { LOCAL_BYTE_CEILING, type ChatMessage, type ExchangeResult, type Usage } from "./types.ts";
import { GROK_WINDOWS } from "./windows.ts";

export type PaidEnv = GrokEnv & {
  accessToken?: string;
  quota?: { ok: true; limits: QuotaLimits } | { ok: false; reason: string };
  sharedStore: boolean;
};

export type PaidRequest = {
  origin: string | null;
  host: string;
  expectedOrigin?: string;
};

const CLIENT_KEY = "deployment";

export function clientKeyFromHeaders(_headers: { get(name: string): string | null }): string {
  return CLIENT_KEY;
}

function blocked(message: string, model = "unavailable"): ExchangeResult {
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
      model,
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

function validation(message: string): ExchangeResult {
  return {
    ...blocked(message),
    executionStatus: "error",
    error: { type: "ValidationError", message },
    contextBudget: { ...blocked(message).contextBudget, contextFloorSource: "invalid_request", blockedReason: message },
  };
}

export function sameSite(request: PaidRequest): boolean {
  if (!request.origin) return false;
  try {
    const origin = new URL(request.origin);
    return origin.origin === (request.expectedOrigin ?? `https://${request.host}`) && request.origin === origin.origin;
  } catch {
    return false;
  }
}

export function billedTokens(usage: Usage | null): number | null {
  if (!usage) return null;
  for (const count of Object.values(usage)) {
    if (!Number.isSafeInteger(count) || count < 0) return null;
  }
  // Partial categories cannot establish total usage. Keep the hold.
  if (usage.total_tokens === undefined) return null;
  const sum = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.reasoning_tokens ?? 0);
  const total = Math.max(usage.total_tokens, sum);
  return Number.isSafeInteger(total) ? total : null;
}

function readSuppliedToken(data: unknown): { ok: true; token: string } | { ok: false; reason: string } {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: true, token: "" };
  const token = (data as { accessToken?: unknown }).accessToken;
  if (token === undefined) return { ok: true, token: "" };
  if (typeof token !== "string") return { ok: false, reason: "The access token was not accepted." };
  if (token.length > ACCESS_TOKEN_MAX_CHARS) return { ok: false, reason: "The access token is too long." };
  return { ok: true, token };
}

function isRole(value: unknown): value is ChatMessage["role"] {
  return value === "system" || value === "user" || value === "assistant";
}

export async function parsePaidCall(data: unknown): Promise<{ input: Parameters<typeof runGrokExchange>[0]; accessToken: string } | { error: string }> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "Invalid Grok request" };
  const body = data as Record<string, unknown>;
  const accessToken = typeof body.accessToken === "string" ? body.accessToken : "";
  if (accessToken.length > ACCESS_TOKEN_MAX_CHARS) return { error: "The access token is too long." };
  if (typeof body.model !== "string" || !Object.hasOwn(GROK_WINDOWS, body.model)) {
    return { error: "That Grok model is not in the pinned window table." };
  }
  const model = body.model;
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 200) {
    return { error: "Assembled messages were missing." };
  }
  const messages: ChatMessage[] = [];
  let bytes = 0;
  for (const item of body.messages) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { error: "Assembled messages were unreadable." };
    const message = item as Record<string, unknown>;
    if (!isRole(message.role) || typeof message.content !== "string") return { error: "Assembled messages were unreadable." };
    bytes += utf8ByteLength(message.content);
    if (bytes > LOCAL_BYTE_CEILING) return { error: "The request is larger than the local size ceiling." };
    messages.push({ role: message.role, content: message.content });
  }
  if (promptByteLength(messages) > LOCAL_BYTE_CEILING) return { error: "The request is larger than the local size ceiling." };
  const timeoutSeconds = body.timeoutSeconds;
  const maxOutputTokens = body.maxOutputTokens;
  if (typeof timeoutSeconds !== "number" || !Number.isFinite(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 300) {
    return { error: "Timeout must be between 5 and 300 seconds." };
  }
  if (typeof maxOutputTokens !== "number" || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 16 || maxOutputTokens > 8192) {
    return { error: "Max output must be an integer from 16 to 8192." };
  }
  if (!(body.temperature === null || (typeof body.temperature === "number" && Number.isFinite(body.temperature) && body.temperature >= 0 && body.temperature <= 2))) {
    return { error: "Temperature must be empty or between 0 and 2." };
  }
  if (!(body.topP === null || (typeof body.topP === "number" && Number.isFinite(body.topP) && body.topP >= 0 && body.topP <= 1))) {
    return { error: "Top-p must be empty or between 0 and 1." };
  }
  if (!(body.seed === null || (typeof body.seed === "number" && Number.isSafeInteger(body.seed)))) {
    return { error: "Seed must be empty or an integer." };
  }
  const contextText = body.contextText === undefined ? "" : body.contextText;
  if (typeof contextText !== "string") return { error: "Injector text was unreadable." };
  if (utf8ByteLength(contextText) > LOCAL_BYTE_CEILING) return { error: "The injector text is larger than the local size ceiling." };
  let contextRole: "system" | "user" | undefined;
  if (contextText.length > 0) {
    if (body.contextRole !== "system" && body.contextRole !== "user") return { error: "Injector delivery was unreadable." };
    contextRole = body.contextRole;
    const first = messages[0];
    if (!first || first.role !== contextRole || first.content !== contextText) {
      return { error: "The injector text does not match the first assembled message." };
    }
  } else if (body.contextRole !== undefined) {
    return { error: "Empty context cannot declare a delivery role." };
  }
  for (const key of ["contextSha256", "promptSha256"]) {
    if (Object.hasOwn(body, key) && (typeof body[key] !== "string" || !/^[a-f0-9]{64}$/.test(body[key] as string))) {
      return { error: `${key} must be a SHA-256 hex string.` };
    }
  }
  const dialog = messages.slice(contextText.length > 0 ? 1 : 0);
  if (dialog.length === 0 || dialog.length % 2 !== 1 || dialog.some((message, index) => message.role !== (index % 2 ? "assistant" : "user"))) {
    return { error: "Messages must contain completed user/assistant pairs followed by the latest user prompt." };
  }
  if (typeof body.contextSha256 === "string") {
    const actual = await sha256Text(contextText);
    if (actual !== body.contextSha256) return { error: "The context hash does not match the submitted text." };
  }
  if (typeof body.promptSha256 === "string") {
    const actual = await promptSha256(messages);
    if (actual !== body.promptSha256) return { error: "The prompt hash does not match the submitted messages." };
  }
  const temperature = body.temperature === null ? null : body.temperature;
  const topP = body.topP === null ? null : body.topP;
  const seed = body.seed === null ? null : body.seed;
  if (typeof temperature !== "number" && temperature !== null) return { error: "Temperature must be empty or between 0 and 2." };
  if (typeof topP !== "number" && topP !== null) return { error: "Top-p must be empty or between 0 and 1." };
  if (typeof seed !== "number" && seed !== null) return { error: "Seed must be empty or an integer." };
  return {
    accessToken,
    input: {
      model,
      messages,
      timeoutSeconds,
      maxOutputTokens,
      temperature,
      topP,
      seed,
      contextText,
      contextRole,
    },
  };
}

export async function executePaidTurn(args: {
  data: unknown;
  env: PaidEnv;
  fetchImpl: typeof fetch;
  store: QuotaStore | null;
  request: PaidRequest;
  headers?: { get(name: string): string | null };
  nowMs?: number;
}): Promise<ExchangeResult> {
  if (!sameSite(args.request)) return blocked("The request origin does not match this deployment.");
  if (args.env.enableFlag !== "1" || !args.env.apiKey) {
    return blocked("Requires WORKBENCH_ENABLE_GROK=1 and server-side XAI_API_KEY");
  }
  const configured = args.env.accessToken ?? "";
  const configError = accessConfigError(configured);
  if (configError) return blocked(configError);
  const supplied = readSuppliedToken(args.data);
  if (!supplied.ok) return blocked(supplied.reason);
  if (!accessTokensMatch(configured, supplied.token)) {
    return blocked("The access token was not accepted.");
  }
  const parsed = await parsePaidCall(args.data);
  if ("error" in parsed) return validation(parsed.error);
  if (!args.env.sharedStore || !args.store) {
    return blocked("Paid Grok is locked until a shared quota store is configured. An in-memory counter is not a deployment limit.");
  }
  if (!args.env.quota?.ok) {
    return blocked(args.env.quota?.reason ?? "The quota configuration is invalid.");
  }
  const nowMs = args.nowMs ?? Date.now();
  const period = utcPeriod(nowMs);
  const messageBytes = utf8ByteLength(parsed.input.messages.map((m) => `${m.role}\n${m.content}`).join("\n"));
  const injectorBytes = parsed.input.contextText ? utf8ByteLength(`${parsed.input.contextRole}\n${parsed.input.contextText}`) : 0;
  const tokenizerAllowance = messageBytes + injectorBytes;
  const hold = conservativeHold(messageBytes, parsed.input.maxOutputTokens, injectorBytes);
  let reservation;
  try {
    reservation = await args.store.reserve({
      period,
      clientKey: clientKeyFromHeaders(args.headers ?? { get: () => null }),
      nowMs,
      holdMs: parsed.input.timeoutSeconds * 1000 + QUOTA_HOLD_GRACE_MS,
      limits: args.env.quota.limits,
      tokens: hold,
    });
  } catch {
    return blocked("The shared limiter is unavailable. Paid Grok was not called.");
  }
  if (!reservation.ok) return blocked(reservation.reason);
  let result: ExchangeResult;
  let providerCalls = 0;
  let completionAttempted = false;
  const trackedFetch: typeof fetch = async (url, init) => {
    providerCalls += 1;
    if (String(url).endsWith("/chat/completions")) completionAttempted = true;
    return args.fetchImpl(url, init);
  };
  const earlyCharge = () => (providerCalls === 0 ? 0 : tokenizerAllowance);
  try {
    result = await runGrokExchange(parsed.input, args.env, trackedFetch);
  } catch {
    if (!completionAttempted) {
      try {
        await args.store.reconcile({ reservationId: reservation.reservation.id, actualTokens: earlyCharge() });
      } catch {
        // The reservation stays. A second reconcile is not attempted.
      }
    }
    return { ...blocked("The provider outcome is unknown. The allowance and concurrency reservation remain held for operator review."), executionStatus: "error" };
  }
  const reported = billedTokens(result.providerUsage);
  // Tokenizer usage is not included in completion usage; keep its separate allowance.
  const beforeCompletion = !completionAttempted && result.executionStatus === "timeout";
  const settled = beforeCompletion
    ? earlyCharge()
    : providerCalls === 0
      ? 0
      : !completionAttempted && result.executionStatus === "blocked"
        ? tokenizerAllowance
        : reported === null
          ? null
          : reported + tokenizerAllowance;
  let reconciled = false;
  try {
    if (beforeCompletion || result.executionStatus !== "timeout") {
      await args.store.reconcile({ reservationId: reservation.reservation.id, actualTokens: settled });
      reconciled = true;
    }
  } catch {
    // The provider result is kept. Unknown reconciliation leaves the reservation in place.
  }
  return {
    ...result,
    quotaAccounting: {
      period,
      reservedTokens: reservation.reservation.reservedTokens,
      settledTokens: reconciled ? settled : null,
    },
  };
}
