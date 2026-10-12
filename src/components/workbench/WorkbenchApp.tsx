/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute. */

import { useEffect, useRef, useState } from "react";
import { DiagnosticsPanel } from "@/components/workbench/DiagnosticsPanel";
import { DialogPanel } from "@/components/workbench/DialogPanel";
import { InjectorPanel } from "@/components/workbench/InjectorPanel";
import { STORAGE_KEY, downloadJson, shareExport, type ExportOutcome } from "@/lib/workbench/download";
import { grokAvailability, runGrokTurn } from "@/lib/workbench/grok-api";
import { runMockExchange } from "@/lib/workbench/mock";
import {
  activeConversation,
  beginSend,
  blockedLocally,
  commitResult,
  deleteConversation,
  divergenceReasons,
  localBlockReason,
  parsePersisted,
  recoverInterrupted,
  startBaseline,
} from "@/lib/workbench/session";
import { sha256Text } from "@/lib/workbench/hash";
import {
  emptyState,
  type Draft,
  type ExchangeResult,
  type PersistedState,
} from "@/lib/workbench/types";

type PanelId = "injector" | "dialog" | "diagnostics";

function redact(text: string): string {
  return text.replace(/xai-[A-Za-z0-9_-]{8,}/g, "[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

export function WorkbenchApp() {
  const [state, setState] = useState<PersistedState>(emptyState);
  const [hydrated, setHydrated] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelId>("injector");
  const [pinnedTurnId, setPinnedTurnId] = useState<string | null>(null);
  const [contextHash, setContextHash] = useState("");
  const [grok, setGrok] = useState<{ enabled: boolean; reason: string | null }>({
    enabled: false,
    reason: "Checking the Grok adapter.",
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [bundle, setBundle] = useState<{ filename: string; text: string } | null>(null);
  const shellRef = useRef<HTMLElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const recovered = await recoverInterrupted(parsePersisted(localStorage.getItem(STORAGE_KEY)), new Date().toISOString());
      if (cancel) return;
      stateRef.current = recovered;
      setState(recovered);
      setHydrated(true);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [hydrated, state]);

  useEffect(() => {
    let cancel = false;
    void sha256Text(state.draft.text).then((hash) => {
      if (!cancel) setContextHash(hash);
    });
    return () => {
      cancel = true;
    };
  }, [state.draft.text]);

  useEffect(() => {
    let cancel = false;
    void grokAvailability()
      .then((status) => {
        if (!cancel) setGrok(status);
      })
      .catch(() => {
        if (!cancel) setGrok({ enabled: false, reason: "Requires WORKBENCH_ENABLE_GROK=1 and server-side XAI_API_KEY" });
      });
    return () => {
      cancel = true;
    };
  }, []);

  const conversation = activeConversation(state);
  const pending = conversation?.turns.some((turn) => turn.executionStatus === "pending") ?? false;
  const turns = conversation?.turns ?? [];
  const selected = turns.find((turn) => turn.id === pinnedTurnId) ?? turns[turns.length - 1] ?? null;

  function commit(next: PersistedState) {
    stateRef.current = next;
    setState(next);
  }

  function onDraft(patch: Partial<Draft>) {
    setConfirmDelete(false);
    commit({ ...stateRef.current, draft: { ...stateRef.current.draft, ...patch } });
  }

  function openConversation(id: string) {
    const nextConversation = stateRef.current.conversations.find((item) => item.id === id);
    if (!nextConversation) return;
    const last = nextConversation.turns[nextConversation.turns.length - 1];
    commit({
      ...stateRef.current,
      activeId: id,
      draft: {
        ...stateRef.current.draft,
        name: nextConversation.contextName,
        text: nextConversation.contextText,
        deliveryMode: nextConversation.deliveryMode,
        provider: nextConversation.provider,
        model: nextConversation.model,
        timeoutSeconds: last?.settings.timeoutSeconds ?? stateRef.current.draft.timeoutSeconds,
        maxOutputTokens: last?.settings.maxOutputTokens ?? stateRef.current.draft.maxOutputTokens,
        temperature: last?.settings.temperature ?? stateRef.current.draft.temperature,
        topP: last?.settings.topP ?? stateRef.current.draft.topP,
        seed: last?.settings.seed ?? null,
      },
    });
    setPinnedTurnId(null);
    setConfirmDelete(false);
    setPanel("dialog");
  }

  async function onSend() {
    const began = await beginSend(stateRef.current, prompt);
    if (!began.ok) {
      setNote(began.reason);
      return;
    }
    commit(began.state);
    setPrompt("");
    setNote(null);
    setPinnedTurnId(null);
    setPanel("dialog");
    const turn = began.state.conversations
      .find((item) => item.id === began.conversationId)
      ?.turns.find((item) => item.id === began.turnId);
    if (!turn) return;
    let result: ExchangeResult;
    try {
      const reason = localBlockReason(turn);
      if (reason) {
        result = blockedLocally(reason, turn.requestedModel);
      } else if (turn.settings.provider === "mock") {
        result = runMockExchange({
          messages: turn.assembledMessages,
          contextText: turn.frozenContextText,
          promptSha256: turn.promptSha256,
          seed: turn.settings.seed,
          blockedReason: null,
        });
      } else {
        result = await runGrokTurn({
          data: {
            model: turn.settings.model,
            messages: turn.assembledMessages,
            timeoutSeconds: turn.settings.timeoutSeconds,
            maxOutputTokens: turn.settings.maxOutputTokens,
            temperature: turn.settings.temperature,
            topP: turn.settings.topP,
            seed: turn.settings.seed,
            contextText: turn.frozenContextText,
            contextRole: turn.settings.deliveryMode === "SYSTEM_SLOT" ? "system" : "user",
          },
        });
      }
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : "The send failed.");
      result = blockedLocally(message, turn.requestedModel);
      result = { ...result, executionStatus: "error", error: { type: "ClientError", message } };
    }
    const next = await commitResult(stateRef.current, began.conversationId, began.turnId, result, new Date().toISOString());
    commit(next);
  }

  useEffect(() => {
    const shell = shellRef.current;
    const frame = window.visualViewport;
    if (!shell || !frame) return;
    const place = () => {
      shell.style.top = `${frame.offsetTop}px`;
      shell.style.height = `${frame.height}px`;
    };
    place();
    frame.addEventListener("resize", place);
    frame.addEventListener("scroll", place);
    window.addEventListener("orientationchange", place);
    return () => {
      frame.removeEventListener("resize", place);
      frame.removeEventListener("scroll", place);
      window.removeEventListener("orientationchange", place);
    };
  }, []);

  async function saveExport(filename: string, value: unknown) {
    const result = await downloadJson(filename, value);
    applyExport(result);
  }

  function applyExport(result: ExportOutcome) {
    if (result.kind === "manual") {
      setBundle({ filename: result.filename, text: result.text });
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(result.text).then(
          () => setExportNote("Copied. The text stays on screen if you need it again."),
          () => setExportNote(result.message),
        );
        return;
      }
      setExportNote(result.message);
      return;
    }
    setBundle(null);
    setExportNote(result.message);
  }

  const panelClass = (id: PanelId, scroll: boolean) =>
    `${panel === id ? "flex" : "hidden"} h-full min-h-0 flex-col ${scroll ? "overflow-y-auto" : "overflow-hidden"} border-line lg:flex lg:border-r lg:last:border-r-0`;

  return (
    <main ref={shellRef} className="fixed inset-x-0 top-0 flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <header className={`flex items-center justify-between gap-3 border-b border-line px-4 py-3 ${composerFocused ? "max-lg:hidden" : ""}`}>
        <div className="grid gap-0.5">
          <p className="text-xs text-muted">Local records</p>
          <h1 className="text-lg font-medium">Context Engineer</h1>
        </div>
        <p className="text-xs text-subtle">v1</p>
      </header>
      {exportNote ? (
        <p className="border-b border-line px-4 py-2 text-sm text-muted" role="status">
          {exportNote}
        </p>
      ) : null}
      <nav className="grid grid-cols-3 border-b border-line lg:hidden" aria-label="Panels">
        {(
          [
            ["injector", "Injector"],
            ["dialog", "Dialog"],
            ["diagnostics", "Diagnostics"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={panel === id}
            className={`min-h-11 text-sm ${panel === id ? "bg-surface text-fg" : "text-muted"}`}
            onClick={() => setPanel(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="grid min-h-0 flex-1 lg:grid-cols-3">
        <section className={panelClass("injector", true)} aria-label="Injector">
          <InjectorPanel
            draft={state.draft}
            contextHash={contextHash}
            conversations={state.conversations}
            activeId={state.activeId}
            grokEnabled={grok.enabled}
            grokReason={grok.reason}
            confirmDelete={confirmDelete}
            onDraft={onDraft}
            onClear={() => onDraft({ text: "" })}
            onImport={(file) => void importContext(file, onDraft, setNote)}
            onExportContext={() => void saveExport(`${state.draft.name || "context"}.json`, { name: state.draft.name, text: state.draft.text })}
            onBaseline={() => {
              void startBaseline(stateRef.current).then((next) => {
                commit(next);
                setPinnedTurnId(null);
                setPanel("dialog");
              });
            }}
            onOpen={openConversation}
            onDelete={() => {
              if (!state.activeId) return;
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              commit(deleteConversation(stateRef.current, state.activeId));
              setConfirmDelete(false);
              setPinnedTurnId(null);
            }}
            onExportSession={() =>
              void saveExport("context-engineer-session.json", {
                exportSchema: "cew-session-v1",
                exportedAt: new Date().toISOString(),
                conversations: state.conversations,
              })
            }
          />
        </section>
        <section className={panelClass("dialog", false)} aria-label="Dialog">
          <DialogPanel
            conversation={conversation}
            reasons={divergenceReasons(conversation, state.draft)}
            prompt={prompt}
            note={note}
            pending={pending}
            onPrompt={setPrompt}
            onSend={() => void onSend()}
            onComposerFocus={setComposerFocused}
          />
        </section>
        <section className={panelClass("diagnostics", true)} aria-label="Diagnostics">
          <DiagnosticsPanel
            conversation={conversation}
            turn={selected}
            onSelect={setPinnedTurnId}
            onExport={() => {
              if (selected) void saveExport(`turn-${selected.id}.json`, selected);
            }}
          />
        </section>
      </div>
      {bundle ? (
        <div className="absolute inset-0 z-20 flex min-h-0 flex-col bg-bg">
          <header className="grid gap-1 border-b border-line p-4">
            <h2 className="text-lg font-medium">Export</h2>
            <p className="text-sm text-muted break-all">{bundle.filename}</p>
            <p className="text-sm text-muted">Copy this, or share it if the sheet is available.</p>
          </header>
          <textarea
            readOnly
            spellCheck={false}
            className="min-h-0 w-full flex-1 resize-none bg-bg px-4 py-3 font-mono text-base text-fg"
            value={bundle.text}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="grid grid-cols-2 gap-2 border-t border-line p-4 pb-safe">
            <button
              type="button"
              className="min-h-11 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg"
              onClick={() => {
                const text = bundle.text;
                const done = () => setExportNote("Copied.");
                if (navigator.clipboard?.writeText) {
                  void navigator.clipboard.writeText(text).then(done).catch(() => setExportNote("Select the text, then copy."));
                  return;
                }
                setExportNote("Select the text, then copy.");
              }}
            >
              Copy
            </button>
            <button
              type="button"
              className="min-h-11 rounded-md border border-line px-3 text-sm"
              onClick={() => {
                void shareExport(bundle.filename, bundle.text).then((shared) => {
                  if (shared === "shared") setExportNote("Opened the share sheet. Save the file from there.");
                  else if (shared === "cancelled") setExportNote("Export cancelled.");
                  else setExportNote("Share is not available here. Copy the text.");
                });
              }}
            >
              Share
            </button>
            <button
              type="button"
              className="col-span-2 min-h-11 rounded-md border border-line px-3 text-sm"
              onClick={() => setBundle(null)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

async function importContext(
  file: File,
  onDraft: (patch: Partial<Draft>) => void,
  setNote: (note: string | null) => void,
) {
  const text = await file.text();
  if (file.name.toLowerCase().endsWith(".json")) {
    try {
      const parsed = JSON.parse(text) as { name?: unknown; text?: unknown };
      if (typeof parsed.text !== "string") throw new Error("missing text");
      if (typeof parsed.name === "string") onDraft({ text: parsed.text, name: parsed.name });
      else onDraft({ text: parsed.text });
      setNote(null);
    } catch {
      setNote('JSON import needs { "name", "text" }.');
    }
    return;
  }
  onDraft({ text });
  setNote(null);
}
