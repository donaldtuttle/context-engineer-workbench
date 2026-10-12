/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute.
   Storage packing is lossless. Exports stay in the readable record shape. */

import { assertPersistedState } from "./session.ts";
import type { Conversation, Draft, PersistedState, TurnRecord } from "./types.ts";

export const PACK_MARK = "cew-pack-v1";

type PackedTurn = Omit<TurnRecord, "contextName" | "frozenContextText" | "userPrompt" | "responseText" | "assembledMessages" | "error"> & {
  contextName: number;
  frozenContextText: number;
  userPrompt: number;
  responseText: number | null;
  assembledMessages: Array<[TurnRecord["assembledMessages"][number]["role"], number]>;
  error: { type: string; message: number } | null;
};

type PackedConversation = Omit<Conversation, "contextName" | "contextText" | "turns"> & {
  contextName: number;
  contextText: number;
  strings: string[];
  turns: PackedTurn[];
};

export type PackedEnvelope = {
  pack: typeof PACK_MARK;
  version: 1;
  draft: Draft;
  activeId: string | null;
  conversations: PackedConversation[];
};

function intern(table: string[], value: string): number {
  const found = table.indexOf(value);
  if (found >= 0) return found;
  table.push(value);
  return table.length - 1;
}

function packTurn(table: string[], turn: TurnRecord): PackedTurn {
  const { contextName, frozenContextText, userPrompt, responseText, assembledMessages, error, ...rest } = turn;
  return {
    ...rest,
    contextName: intern(table, contextName),
    frozenContextText: intern(table, frozenContextText),
    userPrompt: intern(table, userPrompt),
    responseText: responseText === null ? null : intern(table, responseText),
    assembledMessages: assembledMessages.map((message) => [message.role, intern(table, message.content)]),
    error: error === null ? null : { type: error.type, message: intern(table, error.message) },
  };
}

export function packState(state: PersistedState): PackedEnvelope {
  return {
    pack: PACK_MARK,
    version: 1,
    draft: state.draft,
    activeId: state.activeId,
    conversations: state.conversations.map((conversation) => {
      const strings: string[] = [];
      const { contextName, contextText, turns, ...rest } = conversation;
      return {
        ...rest,
        contextName: intern(strings, contextName),
        contextText: intern(strings, contextText),
        strings,
        turns: turns.map((turn) => packTurn(strings, turn)),
      };
    }),
  };
}

function at(table: string[], index: unknown, label: string): string {
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= table.length) {
    throw new Error(`${label} string reference is invalid`);
  }
  const value = table[index];
  if (typeof value !== "string") throw new Error(`${label} string reference is invalid`);
  return value;
}

export function unpackState(envelope: PackedEnvelope): PersistedState {
  if (envelope.pack !== PACK_MARK || envelope.version !== 1) throw new Error("Unsupported packed session");
  if (!Array.isArray(envelope.conversations)) throw new Error("Packed conversations were unreadable");
  const conversations: Conversation[] = envelope.conversations.map((conversation) => {
    if (!Array.isArray(conversation.strings)) throw new Error("Packed string table was unreadable");
    const strings = conversation.strings;
    return {
      id: conversation.id,
      createdAt: conversation.createdAt,
      contextName: at(strings, conversation.contextName, "context name"),
      contextText: at(strings, conversation.contextText, "context text"),
      contextSha256: conversation.contextSha256,
      deliveryMode: conversation.deliveryMode,
      provider: conversation.provider,
      model: conversation.model,
      turns: conversation.turns.map((turn) => {
        const { contextName, frozenContextText, userPrompt, responseText, assembledMessages, error, ...rest } = turn;
        return {
          ...rest,
          contextName: at(strings, contextName, "turn context name"),
          frozenContextText: at(strings, frozenContextText, "frozen context"),
          userPrompt: at(strings, userPrompt, "user prompt"),
          responseText: responseText === null ? null : at(strings, responseText, "response"),
          assembledMessages: assembledMessages.map((entry) => {
            if (!Array.isArray(entry) || entry.length !== 2 || !["system", "user", "assistant"].includes(entry[0])) {
              throw new Error("Packed message tuple is invalid");
            }
            return { role: entry[0], content: at(strings, entry[1], "message") };
          }),
          error: error === null ? null : { type: error.type, message: at(strings, error.message, "error") },
        };
      }),
    };
  });
  const state = { version: 1, draft: envelope.draft, conversations, activeId: envelope.activeId };
  assertPersistedState(state);
  return state;
}
