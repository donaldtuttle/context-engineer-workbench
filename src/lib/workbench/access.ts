/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute.
   The access token is a deployment guard. It is not an xAI API key.
   Compare with Node's timingSafeEqual on SHA-256 digests. This is the
   supported server-side primitive. It is not a claim that a JavaScript
   loop is constant-time. */

import { createHash, timingSafeEqual } from "node:crypto";

export const ACCESS_TOKEN_MAX_CHARS = 256;
export const ACCESS_TOKEN_MIN_CHARS = 32;

export function accessConfigError(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === "") return "WORKBENCH_ACCESS_TOKEN is not configured";
  const token = raw;
  if (token.length > ACCESS_TOKEN_MAX_CHARS) return "WORKBENCH_ACCESS_TOKEN is too long";
  if (!/^[A-Za-z0-9_-]+$/.test(token) || token.length < ACCESS_TOKEN_MIN_CHARS) {
    return "WORKBENCH_ACCESS_TOKEN must be at least 32 characters from the set A-Z, a-z, 0-9, underscore, and hyphen";
  }
  return null;
}

export function accessTokensMatch(configured: string, supplied: string): boolean {
  if (supplied.length === 0 || supplied.length > ACCESS_TOKEN_MAX_CHARS) return false;
  const left = createHash("sha256").update(configured, "utf8").digest();
  const right = createHash("sha256").update(supplied, "utf8").digest();
  return timingSafeEqual(left, right);
}
