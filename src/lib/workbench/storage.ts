/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute.
   v1 remains on disk after a verified migration. It is not restored
   automatically, including after a conversation is deleted from v2. */

import { canonicalJson } from "./hash.ts";
import { packState, unpackState, PACK_MARK, type PackedEnvelope } from "./pack.ts";
import { parsePersisted } from "./session.ts";
import { emptyState, type PersistedState } from "./types.ts";

export const STORAGE_KEY_V1 = "cew.sessions.v1";
export const STORAGE_KEY_V2 = "cew.sessions.v2";

export type StorageLoad =
  | { status: "none" }
  | { status: "legacy"; state: PersistedState }
  | { status: "ready"; state: PersistedState }
  | { status: "corrupt"; key: string; raw: string; message: string }
  | { status: "unavailable"; message: string };

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

function isEnvelope(value: unknown): value is PackedEnvelope {
  return Boolean(value) && typeof value === "object" && (value as PackedEnvelope).pack === PACK_MARK;
}

function legacyState(raw: string): PersistedState | null {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; draft?: unknown; conversations?: unknown };
    if (parsed.version !== 1 || !parsed.draft || !Array.isArray(parsed.conversations)) return null;
    const state = parsePersisted(raw);
    if (state.conversations.length !== parsed.conversations.length) return null;
    return state;
  } catch {
    return null;
  }
}

export function loadStored(storage: StorageLike): StorageLoad {
  let packed: string | null;
  let legacy: string | null;
  try {
    packed = storage.getItem(STORAGE_KEY_V2);
    legacy = storage.getItem(STORAGE_KEY_V1);
  } catch {
    return { status: "unavailable", message: "This browser refused to read saved conversations." };
  }
  if (packed !== null) {
    if (packed.trim() === "") return { status: "ready", state: emptyState() };
    try {
      const parsed = JSON.parse(packed) as unknown;
      if (!isEnvelope(parsed)) return { status: "corrupt", key: STORAGE_KEY_V2, raw: packed, message: "Saved data uses an unsupported format." };
      return { status: "ready", state: unpackState(parsed) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Saved data could not be read.";
      return { status: "corrupt", key: STORAGE_KEY_V2, raw: packed, message };
    }
  }
  if (legacy === null) return { status: "none" };
  const state = legacyState(legacy);
  if (!state) return { status: "corrupt", key: STORAGE_KEY_V1, raw: legacy, message: "The older saved session could not be read." };
  return { status: "legacy", state };
}

export function saveStored(storage: StorageLike, state: PersistedState): { ok: true } | { ok: false; message: string } {
  if (!storage.setItem || !storage.getItem) return { ok: false, message: "This browser cannot store conversations." };
  const payload = JSON.stringify(packState(state));
  try {
    storage.setItem(STORAGE_KEY_V2, payload);
    const written = storage.getItem(STORAGE_KEY_V2);
    if (written !== payload) return { ok: false, message: "The save could not be verified." };
    unpackState(JSON.parse(written) as PackedEnvelope);
    return { ok: true };
  } catch {
    return { ok: false, message: "Recent changes have not been saved. They are still on this page. Export the session before you close it." };
  }
}

export function migrateLegacy(storage: StorageLike, state: PersistedState): { ok: true } | { ok: false; message: string } {
  const saved = saveStored(storage, state);
  if (!saved.ok) return saved;
  try {
    const raw = storage.getItem(STORAGE_KEY_V2);
    if (!raw) return { ok: false, message: "The migrated copy could not be read back." };
    const unpacked = unpackState(JSON.parse(raw) as PackedEnvelope);
    if (canonicalJson(unpacked) !== canonicalJson(state)) {
      try {
        storage.removeItem?.(STORAGE_KEY_V2);
      } catch {
        return { ok: false, message: "The migrated copy did not match the original, and it could not be removed. The older copy was left in place." };
      }
      return { ok: false, message: "The migrated copy did not match the original. It was removed. The older copy was left in place." };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "The migrated copy could not be verified. The older copy was left in place." };
  }
}

export async function persistLatest(
  read: () => PersistedState,
  write: (state: PersistedState) => void,
  wait: Promise<void>,
): Promise<void> {
  await wait;
  write(read());
}
