/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute. */

import { sha256Text, utf8ByteLength } from "./hash.ts";
import type { ChatMessage, DeliveryMode, TurnRecord, ProviderId } from "./types.ts";

/** messages-json-v1. Key order is role then content. Not sorted. */
export function serializeMessages(messages: ChatMessage[]): string {
  return JSON.stringify(messages.map((message) => ({ role: message.role, content: message.content })));
}

export async function promptSha256(messages: ChatMessage[]): Promise<string> {
  return sha256Text(serializeMessages(messages));
}

export function assembleMessages(input: {
  contextText: string;
  deliveryMode: DeliveryMode;
  history: { user: string; assistant: string }[];
  userPrompt: string;
}): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (input.contextText.length > 0) {
    messages.push({
      role: input.deliveryMode === "SYSTEM_SLOT" ? "system" : "user",
      content: input.contextText,
    });
  }
  for (const exchange of input.history) {
    messages.push({ role: "user", content: exchange.user });
    messages.push({ role: "assistant", content: exchange.assistant });
  }
  messages.push({ role: "user", content: input.userPrompt });
  return messages;
}

export function replayableHistory(
  turns: TurnRecord[],
  provider: ProviderId,
): { user: string; assistant: string }[] {
  const history: { user: string; assistant: string }[] = [];
  for (const turn of turns) {
    if (turn.executionStatus !== "success") continue;
    if (turn.settings.provider !== provider) continue;
    if (turn.responseText === null) continue;
    history.push({ user: turn.userPrompt, assistant: turn.responseText });
  }
  return history;
}

export function promptByteLength(messages: ChatMessage[]): number {
  return utf8ByteLength(serializeMessages(messages));
}
