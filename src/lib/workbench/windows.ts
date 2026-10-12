/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute.
   Window table adapted from prompt-engineering-workbench workbench/context_windows.py.
   Unknown Grok ids are refused. An env floor can lower a window. It cannot raise one. */

export const GROK_WINDOWS: Record<string, number> = {
  "grok-4.7": 500_000,
  "grok-4.6": 500_000,
  "grok-4.5": 500_000,
  "grok-4.5-latest": 500_000,
  "grok-4": 256_000,
  "grok-4-0709": 256_000,
  "grok-4-latest": 256_000,
};

export function grokModelWindow(model: string): number {
  if (!Object.hasOwn(GROK_WINDOWS, model)) {
    throw new Error("No pinned context window for this Grok model");
  }
  const window = GROK_WINDOWS[model];
  if (typeof window !== "number") {
    throw new Error("No pinned context window for this Grok model");
  }
  return window;
}

export function cappedWindow(
  documented: number,
  raw: string | undefined,
): { floor: number; source: "model" | "env_cap" } {
  if (raw === undefined || raw === "") return { floor: documented, source: "model" };
  if (!/^-?\d+$/.test(raw)) {
    throw new Error("WORKBENCH_GROK_CONTEXT_FLOOR must be an integer");
  }
  const cap = Number(raw);
  if (cap < 1) throw new Error("WORKBENCH_GROK_CONTEXT_FLOOR must be positive");
  if (cap >= documented) return { floor: documented, source: "model" };
  return { floor: cap, source: "env_cap" };
}
