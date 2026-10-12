/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute.
   Quota accounting is an allowance of requests and tokens. It is not a
   dollar spending ceiling. Provider bills can include categories this
   estimate does not see. */

export type QuotaLimits = {
  ratePerMin: number;
  dailyRequestCap: number;
  dailyTokenCap: number;
  concurrency: number;
};

export type Reservation = {
  id: string;
  period: string;
  reservedTokens: number;
};

export type ReserveResult = { ok: true; reservation: Reservation } | { ok: false; reason: string };

export interface QuotaStore {
  reserve(input: {
    period: string;
    clientKey: string;
    nowMs: number;
    holdMs: number;
    limits: QuotaLimits;
    tokens: number;
  }): Promise<ReserveResult>;
  reconcile(input: { reservationId: string; actualTokens: number | null }): Promise<void>;
}

export const DEFAULT_LIMITS: QuotaLimits = {
  ratePerMin: 10,
  dailyRequestCap: 200,
  dailyTokenCap: 500_000,
  concurrency: 2,
};

const MAX_RATE = 1_000;
const MAX_DAILY_REQUESTS = 100_000;
const MAX_DAILY_TOKENS = 100_000_000;
const MAX_CONCURRENCY = 32;

export function utcPeriod(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

// Covers provider work that outlives the client timeout.
export const QUOTA_HOLD_GRACE_MS = 600_000;

// This is a conservative allowance estimate, not a provider-enforced billing bound.
export const REASONING_ALLOWANCE = 131_072;
export function conservativeHold(promptBytes: number, maxOutputTokens: number, injectorBytes = 0): number {
  return Math.max(1, promptBytes) * 2 + injectorBytes + maxOutputTokens + REASONING_ALLOWANCE;
}

export function readQuotaConfig(env: {
  ratePerMin?: string;
  dailyRequestCap?: string;
  dailyTokenCap?: string;
  concurrency?: string;
}): { ok: true; limits: QuotaLimits } | { ok: false; reason: string } {
  const rate = readBound(env.ratePerMin, DEFAULT_LIMITS.ratePerMin, MAX_RATE, "WORKBENCH_RATE_PER_MIN");
  if (!rate.ok) return rate;
  const requests = readBound(env.dailyRequestCap, DEFAULT_LIMITS.dailyRequestCap, MAX_DAILY_REQUESTS, "WORKBENCH_DAILY_REQUEST_CAP");
  if (!requests.ok) return requests;
  const tokens = readBound(env.dailyTokenCap, DEFAULT_LIMITS.dailyTokenCap, MAX_DAILY_TOKENS, "WORKBENCH_DAILY_TOKEN_CAP");
  if (!tokens.ok) return tokens;
  const concurrency = readBound(env.concurrency, DEFAULT_LIMITS.concurrency, MAX_CONCURRENCY, "WORKBENCH_MAX_CONCURRENCY");
  if (!concurrency.ok) return concurrency;
  return {
    ok: true,
    limits: {
      ratePerMin: rate.value,
      dailyRequestCap: requests.value,
      dailyTokenCap: tokens.value,
      concurrency: concurrency.value,
    },
  };
}

function readBound(
  raw: string | undefined,
  fallback: number,
  max: number,
  name: string,
): { ok: true; value: number } | { ok: false; reason: string } {
  if (raw === undefined || raw.trim() === "") return { ok: true, value: fallback };
  if (!/^[0-9]+$/.test(raw.trim())) return { ok: false, reason: `${name} must be a positive integer` };
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    return { ok: false, reason: `${name} must be from 1 to ${max}` };
  }
  return { ok: true, value };
}

type PeriodRow = { requests: number; tokens: number; concurrency: number };
type RateRow = { count: number };
type SavedReservation = {
  period: string;
  reservedTokens: number;
  settled: boolean;
  expiresMs: number;
  concurrencyReleased: boolean;
};

export type QuotaBacking = {
  periods: Record<string, PeriodRow>;
  rates: Record<string, RateRow>;
  reservations: Record<string, SavedReservation>;
  sequence: number;
};

export function emptyBacking(): QuotaBacking {
  return { periods: {}, rates: {}, reservations: {}, sequence: 0 };
}

export class MemoryQuotaStore implements QuotaStore {
  readonly backing: QuotaBacking;
  private chain: Promise<void> = Promise.resolve();

  constructor(backing: QuotaBacking = emptyBacking()) {
    this.backing = backing;
  }

  reserve(input: {
    period: string;
    clientKey: string;
    nowMs: number;
    holdMs: number;
    limits: QuotaLimits;
    tokens: number;
  }): Promise<ReserveResult> {
    return this.locked(() => {
      this.releaseExpired(input.nowMs);
      const windowKey = `${input.clientKey}:${Math.floor(input.nowMs / 60_000)}`;
      const rate = this.backing.rates[windowKey] ?? { count: 0 };
      if (rate.count + 1 > input.limits.ratePerMin) {
        return { ok: false, reason: "The per-minute request allowance is exhausted." };
      }
      const period = this.backing.periods[input.period] ?? { requests: 0, tokens: 0, concurrency: 0 };
      if (period.requests + 1 > input.limits.dailyRequestCap) {
        return { ok: false, reason: "The daily request allowance is exhausted." };
      }
      if (period.tokens + input.tokens > input.limits.dailyTokenCap) {
        return { ok: false, reason: "The daily token allowance is exhausted." };
      }
      const running = Object.values(this.backing.periods).reduce((sum, row) => sum + row.concurrency, 0);
      if (running + 1 > input.limits.concurrency) {
        return { ok: false, reason: "Too many paid requests are already running." };
      }
      this.backing.rates[windowKey] = { count: rate.count + 1 };
      this.backing.periods[input.period] = {
        requests: period.requests + 1,
        tokens: period.tokens + input.tokens,
        concurrency: period.concurrency + 1,
      };
      this.backing.sequence += 1;
      const id = `hold-${this.backing.sequence}`;
      this.backing.reservations[id] = {
        period: input.period,
        reservedTokens: input.tokens,
        settled: false,
        expiresMs: input.nowMs + input.holdMs,
        concurrencyReleased: false,
      };
      return { ok: true, reservation: { id, period: input.period, reservedTokens: input.tokens } };
    });
  }

  reconcile(input: { reservationId: string; actualTokens: number | null }): Promise<void> {
    return this.locked(() => {
      const saved = this.backing.reservations[input.reservationId];
      if (!saved || saved.settled) return;
      const period = this.backing.periods[saved.period];
      if (period && !saved.concurrencyReleased) {
        period.concurrency = Math.max(0, period.concurrency - 1);
      }
      if (period && input.actualTokens !== null) {
        period.tokens = Math.max(0, period.tokens - saved.reservedTokens + input.actualTokens);
      }
      saved.concurrencyReleased = true;
      saved.settled = true;
    });
  }

  private releaseExpired(nowMs: number) {
    for (const saved of Object.values(this.backing.reservations)) {
      if (saved.settled || saved.concurrencyReleased || saved.expiresMs > nowMs) continue;
      const period = this.backing.periods[saved.period];
      if (period) period.concurrency = Math.max(0, period.concurrency - 1);
      saved.concurrencyReleased = true;
    }
  }

  private locked<T>(fn: () => T): Promise<T> {
    const run = this.chain.then(() => fn());
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export function snapshotBacking(store: MemoryQuotaStore): QuotaBacking {
  return structuredClone(store.backing);
}
