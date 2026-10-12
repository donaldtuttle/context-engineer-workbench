/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute.
   Record hash is SHA-256 of canonical JSON for every field except recordSha256.
   Context and prompt hashes stay inside that payload. */

import { canonicalJson, sha256Text } from "./hash.ts";
import type { ExchangeResult, TurnRecord } from "./types.ts";

export function recordHashPayload(record: TurnRecord): Record<string, unknown> {
  const { recordSha256: _omitted, ...rest } = record;
  return rest;
}

export function serializeRecord(record: TurnRecord): string {
  return canonicalJson(recordHashPayload(record));
}

export async function hashRecord(record: TurnRecord): Promise<string> {
  return sha256Text(serializeRecord(record));
}

export async function finalizeTurn(
  turn: TurnRecord,
  result: ExchangeResult,
  finalizedAt: string,
): Promise<TurnRecord> {
  const next: TurnRecord = {
    ...turn,
    finalizedAt,
    executionStatus: result.executionStatus,
    responseText: result.responseText,
    responseStatus: result.responseStatus,
    error: result.error,
    returnedModel: result.returnedModel,
    providerResponseId: result.providerResponseId,
    providerUsage: result.providerUsage,
    reasoningEncryptedOmitted: result.reasoningEncryptedOmitted,
    contextBudget: result.contextBudget,
    preflight: {
      ...turn.preflight,
      countedInputTokens: result.countedInputTokens,
      countSource: result.countSource,
    },
    recordSha256: null,
  };
  const recordSha256 = await hashRecord(next);
  return { ...next, recordSha256 };
}

export async function verifyRecordHash(record: TurnRecord): Promise<boolean> {
  if (record.recordSha256 === null) return false;
  const again = await hashRecord(record);
  return again === record.recordSha256;
}
