/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute. */

export const STORAGE_KEY = "cew.sessions.v1";

export type ExportOutcome =
  | { kind: "shared" | "downloaded" | "cancelled"; message: string }
  | { kind: "manual"; filename: string; text: string; message: string };

export function jsonFilename(name: string): string {
  const trimmed = name.trim() || "export";
  const cleaned = trimmed.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 80);
  return cleaned.toLowerCase().endsWith(".json") ? cleaned : `${cleaned}.json`;
}

function trappedFrame(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

function iosLike(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function needsHandOff(): boolean {
  return trappedFrame() || iosLike();
}

function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === "function" && !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

async function shareFile(file: File): Promise<"shared" | "cancelled" | "unavailable"> {
  if (!canShareFile(file)) return "unavailable";
  try {
    await navigator.share({ files: [file], title: file.name });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    return "unavailable";
  }
}

function saveWithAnchor(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadText(filename: string, text: string): Promise<ExportOutcome> {
  const name = jsonFilename(filename);
  const file = new File([text], name, { type: "application/json" });

  if (needsHandOff()) {
    const shared = await shareFile(file);
    if (shared === "shared") return { kind: "shared", message: "Opened the share sheet. Save the file from there." };
    if (shared === "cancelled") return { kind: "cancelled", message: "Export cancelled." };
    return {
      kind: "manual",
      filename: name,
      text,
      message: "This view cannot save a file by itself. Copy the export.",
    };
  }

  saveWithAnchor(file);
  return { kind: "downloaded", message: "Download started." };
}

export async function downloadJson(filename: string, value: unknown): Promise<ExportOutcome> {
  return downloadText(filename, JSON.stringify(value, null, 2));
}

export async function shareExport(filename: string, text: string): Promise<"shared" | "cancelled" | "unavailable"> {
  const file = new File([text], jsonFilename(filename), { type: "application/json" });
  return shareFile(file);
}
