/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute.
   Context windows checked against the OpenAI model pages on 2026-10-15.
   gpt-4.1: https://developers.openai.com/api/docs/models/gpt-4.1
   gpt-4.1-mini: https://developers.openai.com/api/docs/models/gpt-4.1-mini
   gpt-4.1-nano: https://developers.openai.com/api/docs/models/gpt-4.1-nano
   Each page lists a 1,047,576 token context window and Chat Completions.
   An unknown id is refused. This table does not guess a window. */

export const CHATGPT_WINDOWS: Record<string, number> = {
  "gpt-4.1": 1_047_576,
  "gpt-4.1-mini": 1_047_576,
  "gpt-4.1-nano": 1_047_576,
};

export const CHATGPT_WINDOW_SOURCE = "https://developers.openai.com/api/docs/models/gpt-4.1";
export const CHATGPT_WINDOW_VERIFIED = "2026-10-15";

export function chatgptModelWindow(model: string): number {
  if (!Object.hasOwn(CHATGPT_WINDOWS, model)) {
    throw new Error("No pinned context window for this ChatGPT model");
  }
  const window = CHATGPT_WINDOWS[model];
  if (typeof window !== "number") {
    throw new Error("No pinned context window for this ChatGPT model");
  }
  return window;
}
