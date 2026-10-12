/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute.
   Postgres is the shared allowance. It is used only when DATABASE_URL is set.
   PGLite is not treated as a deployment-wide cap. */

import type { Sql } from "@/lib/db";
import type { QuotaStore, ReserveResult } from "./limits.ts";

export class PostgresQuotaStore implements QuotaStore {
  private readonly sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
  }

  async reserve(input: {
    period: string;
    clientKey: string;
    nowMs: number;
    holdMs: number;
    limits: { ratePerMin: number; dailyRequestCap: number; dailyTokenCap: number; concurrency: number };
    tokens: number;
  }): Promise<ReserveResult> {
    const windowKey = `${input.clientKey}:${Math.floor(input.nowMs / 60_000)}`;
    const rows = await this.sql.query<{ ok: boolean; reason: string | null; reservation_id: string | null }>(
      "select ok, reason, reservation_id from workbench_reserve($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [
        input.period,
        windowKey,
        input.tokens,
        input.limits.ratePerMin,
        input.limits.dailyRequestCap,
        input.limits.dailyTokenCap,
        input.limits.concurrency,
        input.nowMs,
        input.holdMs,
      ],
    );
    const row = rows[0];
    if (!row?.ok || !row.reservation_id) {
      return { ok: false, reason: row?.reason ?? "The shared limiter refused the reservation." };
    }
    return {
      ok: true,
      reservation: { id: row.reservation_id, period: input.period, reservedTokens: input.tokens },
    };
  }

  async reconcile(input: { reservationId: string; actualTokens: number | null }): Promise<void> {
    await this.sql.query("select workbench_reconcile($1, $2)", [input.reservationId, input.actualTokens]);
  }
}
