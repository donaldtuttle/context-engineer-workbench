/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute. */

import { useEffect, useRef, useState } from "react";
import { DiagnosticsPanel } from "@/components/workbench/DiagnosticsPanel";
import { DialogPanel } from "@/components/workbench/DialogPanel";
import { InjectorPanel } from "@/components/workbench/InjectorPanel";
import { downloadJson, downloadText, shareExport, type ExportOutcome } from "@/lib/workbench/download";
import { grokAvailability, runGrokTurn } from "@/lib/workbench/grok-api";
import { chatgptAvailability, runChatGptTurn } from "@/lib/workbench/chatgpt-api";
import { runMockExchange } from "@/lib/workbench/mock";
import {
  activeConversation,
  beginSend,
  blockedLocally,
  commitResult,
  deleteConversation,
  divergenceReasons,
  localBlockReason,
  interpretImport,
  mergeImportedConversations,
  recoverInterrupted,
  startBaseline,
} from "@/lib/workbench/session";
import { sha256Text } from "@/lib/workbench/hash";
import { loadStored, migrateLegacy, saveStored, type StorageLike } from "@/lib/workbench/storage";
import {
  emptyState,
  type Draft,
  type ExchangeResult,
  type PersistedState,
} from "@/lib/workbench/types";

type PanelId = "injector" | "dialog" | "diagnostics";

function redact(text: string, secret = ""): string {
  let out = text.replace(/xai-[A-Za-z0-9_-]{8,}/g, "[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  if (secret.length >= 8 && out.includes(secret)) out = out.split(secret).join("[redacted]");
  return out;
}

function browserStorage(): StorageLike {
  return {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
  };
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
  const [chatgpt, setChatgpt] = useState<{ enabled: boolean; reason: string | null }>({
    enabled: false,
    reason: "Checking the ChatGPT adapter.",
  });
  const [importNote, setImportNote] = useState<string | null>(null);
  const [importProblem, setImportProblem] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [bundle, setBundle] = useState<{ filename: string; text: string } | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [storageNote, setStorageNote] = useState<string | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [rawSaved, setRawSaved] = useState<{ name: string; raw: string } | null>(null);
  const shellRef = useRef<HTMLElement>(null);
  const stateRef = useRef(state);
  const persistAllowed = useRef(false);
  stateRef.current = state;

  useEffect(() => {
    let cancel = false;
    void (async () => {
      let loaded;
      try {
        loaded = loadStored(browserStorage());
      } catch {
        if (cancel) return;
        persistAllowed.current = false;
        setStorageBlocked(true);
        setStorageNote("This browser refused to read saved conversations. Nothing on screen has been written over them.");
        setHydrated(true);
        return;
      }
      if (cancel) return;
      if (loaded.status === "unavailable") {
        persistAllowed.current = false;
        setStorageBlocked(true);
        setStorageNote(loaded.message);
        setHydrated(true);
        return;
      }
      if (loaded.status === "corrupt") {
        persistAllowed.current = false;
        setStorageBlocked(true);
        setRawSaved({ name: `${loaded.key}.raw.json`, raw: loaded.raw });
        setStorageNote(`${loaded.message} Export the original saved data before confirming a reset. Resetting can replace saved data the app could not read.`);
        setHydrated(true);
        return;
      }
      const base = loaded.status === "none" ? emptyState() : loaded.state;
      const recovered = await recoverInterrupted(base, new Date().toISOString());
      if (cancel) return;
      if (loaded.status === "legacy") {
        const migrated = migrateLegacy(browserStorage(), recovered);
        if (!migrated.ok) {
          persistAllowed.current = false;
          setStorageBlocked(true);
          setStorageNote(`${migrated.message} The older copy is still in this browser. Export all conversations before you reset saved data.`);
        } else {
          persistAllowed.current = true;
        }
      } else {
        persistAllowed.current = true;
      }
      stateRef.current = recovered;
      setState(recovered);
      setHydrated(true);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !persistAllowed.current || storageBlocked) return;
    const saved = saveStored(browserStorage(), state);
    if (!saved.ok) setStorageNote(saved.message);
    else setStorageNote(null);
  }, [hydrated, state, storageBlocked]);

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

  useEffect(() => {
    let cancel = false;
    void chatgptAvailability()
      .then((status) => {
        if (!cancel) setChatgpt(status);
      })
      .catch(() => {
        if (!cancel) setChatgpt({ enabled: false, reason: "Requires WORKBENCH_ENABLE_CHATGPT=1 and server-side OPENAI_API_KEY" });
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

  function importFile(name: string, text: string) {
    void interpretImport(name, text).then(async (result) => {
      if (result.kind === "error") {
        setImportProblem(true);
        setImportNote(result.note);
        return;
      }
      if (result.kind === "context") {
        onDraft(result.name === null ? { text: result.text } : { text: result.text, name: result.name });
        setImportProblem(false);
        setImportNote(result.note);
        return;
      }
      const merged = await mergeImportedConversations(stateRef.current, result.conversations);
      commit(merged.state);
      setPinnedTurnId(null);
      setImportProblem(false);
      setImportNote([result.note, merged.note].filter((item) => item.length > 0).join(" "));
      setPanel("dialog");
    });
  }

  function onDraft(patch: Partial<Draft>) {
    setConfirmDelete(false);
    setImportNote(null);
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
        temperature: last ? last.settings.temperature : stateRef.current.draft.temperature,
        topP: last ? last.settings.topP : stateRef.current.draft.topP,
        seed: last ? last.settings.seed : stateRef.current.draft.seed,
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
      } else if (turn.settings.provider === "chatgpt") {
        result = await runChatGptTurn({
          data: {
            provider: "chatgpt",
            model: turn.settings.model,
            messages: turn.assembledMessages,
            timeoutSeconds: turn.settings.timeoutSeconds,
            maxOutputTokens: turn.settings.maxOutputTokens,
            temperature: turn.settings.temperature,
            topP: turn.settings.topP,
            seed: turn.settings.seed,
            contextText: turn.frozenContextText,
            contextSha256: turn.contextSha256,
            promptSha256: turn.promptSha256,
            accessToken,
            ...(turn.frozenContextText.length > 0
              ? { contextRole: turn.settings.deliveryMode === "SYSTEM_SLOT" ? "system" : "user" }
              : {}),
          },
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
            contextSha256: turn.contextSha256,
            promptSha256: turn.promptSha256,
            accessToken,
            ...(turn.frozenContextText.length > 0
              ? { contextRole: turn.settings.deliveryMode === "SYSTEM_SLOT" ? "system" : "user" }
              : {}),
          },
        });
      }
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : "The send failed.", accessToken);
      result = blockedLocally(message, turn.requestedModel);
      result = { ...result, executionStatus: "error", error: { type: "ClientError", message } };
    }
    const next = await commitResult(
      stateRef.current,
      began.conversationId,
      began.turnId,
      result,
      new Date().toISOString(),
      () => stateRef.current,
    );
    commit(next);
  }

  useEffect(() => {
    const shell = shellRef.current;
    const frame = window.visualViewport;
    if (!shell || !frame) return;
    const reveal = () => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return;
      if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA" && el.tagName !== "SELECT") return;
      const scroller = el.closest(".panel-scroll");
      if (!(scroller instanceof HTMLElement)) return;
      const box = el.getBoundingClientRect();
      const pane = scroller.getBoundingClientRect();
      const limit = frame.height - 8;
      if (box.height >= limit - pane.top) scroller.scrollTop += box.top - pane.top;
      else if (box.bottom > limit) scroller.scrollTop += box.bottom - limit;
      else if (box.top < pane.top) scroller.scrollTop -= pane.top - box.top;
    };
    const place = () => {
      shell.style.top = "0px";
      shell.style.height = `${frame.height}px`;
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
      requestAnimationFrame(reveal);
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

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const isField = (node: EventTarget | null) =>
      node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement;
    const onFocusIn = (event: FocusEvent) => {
      if (isField(event.target)) setComposerFocused(true);
    };
    const onFocusOut = () => {
      window.setTimeout(() => {
        if (!isField(document.activeElement)) setComposerFocused(false);
      }, 0);
    };
    shell.addEventListener("focusin", onFocusIn);
    shell.addEventListener("focusout", onFocusOut);
    return () => {
      shell.removeEventListener("focusin", onFocusIn);
      shell.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  function resetSaved() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    persistAllowed.current = true;
    setStorageBlocked(false);
    setConfirmReset(false);
    setRawSaved(null);
    const saved = saveStored(browserStorage(), stateRef.current);
    setStorageNote(saved.ok ? null : saved.message);
  }

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

  const panelClass = (id: PanelId) =>
    [
      panel === id ? "block" : "hidden",
      "absolute inset-0 min-h-0 overflow-y-scroll panel-scroll border-line lg:static lg:block lg:h-full lg:border-r lg:last:border-r-0",
    ].join(" ");

  return (
    <main ref={shellRef} className="fixed inset-x-0 top-0 flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <header className={`grid gap-2 border-b border-line px-4 py-3 ${composerFocused ? "max-lg:hidden" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-0.5">
            <h1 className="text-base font-medium leading-snug">Context Engineer Workbench</h1>
            <p className="text-sm text-muted">Add background. Ask questions. Inspect the record.</p>
            <p className="text-xs text-subtle">Conversations are saved in this browser.</p>
          </div>
        </div>
        <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Help">
          <a
            className="inline-flex min-h-11 items-center text-sm underline"
            href="https://github.com/donaldtuttle/context-engineer-workbench/blob/main/docs/USER_GUIDE.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            User guide
          </a>
          <a
            className="inline-flex min-h-11 items-center text-sm underline"
            href="https://github.com/donaldtuttle/context-engineer-workbench"
            target="_blank"
            rel="noopener noreferrer"
          >
            View source on GitHub
          </a>
        </nav>
      </header>
      {exportNote ? (
        <p className="border-b border-line px-4 py-2 text-sm text-muted" role="status">
          {exportNote}
        </p>
      ) : null}
      {storageNote ? (
        <div className="grid gap-2 border-b border-line bg-surface px-4 py-3" role="alert">
          <p className="text-sm text-warn">{storageNote}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 rounded-md border border-line px-3 text-sm"
              onClick={() =>
                void saveExport("context-engineer-session.json", {
                  exportSchema: "cew-session-v1",
                  exportedAt: new Date().toISOString(),
                  conversations: stateRef.current.conversations,
                })
              }
            >
              Export all conversations
            </button>
            {rawSaved ? (
              <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm" onClick={() => void downloadText(rawSaved.name, rawSaved.raw).then(applyExport)}>
                Export saved data
              </button>
            ) : null}
            {storageBlocked ? (
              <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm" onClick={resetSaved}>
                {confirmReset ? "Confirm reset" : "Reset saved data"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <nav className={`grid grid-cols-3 border-b border-line lg:hidden ${composerFocused ? "hidden" : ""}`} aria-label="Panels">
        {(
          [
            ["injector", "Injector", "Add context"],
            ["dialog", "Dialog", "Ask questions"],
            ["diagnostics", "Diagnostics", "Inspect records"],
          ] as const
        ).map(([id, label, subtitle]) => (
          <button
            key={id}
            type="button"
            aria-pressed={panel === id}
            aria-label={`${label}: ${subtitle}`}
            className={`min-h-11 px-1 py-1 text-sm leading-tight ${panel === id ? "bg-surface text-fg" : "text-muted"}`}
            onClick={() => setPanel(id)}
          >
            <span className="block">{label}</span>
            <span className="block text-[10px] font-normal">{subtitle}</span>
          </button>
        ))}
      </nav>
      <div inert={!hydrated} className="relative min-h-0 flex-1 overflow-hidden lg:grid lg:grid-cols-3 lg:grid-rows-1">
        <section className={panelClass("injector")} aria-label="Injector: Add context">
          <InjectorPanel
            draft={state.draft}
            contextHash={contextHash}
            conversations={state.conversations}
            activeId={state.activeId}
            grokEnabled={grok.enabled}
            grokReason={grok.reason}
            chatgptEnabled={chatgpt.enabled}
            chatgptReason={chatgpt.reason}
            accessToken={accessToken}
            onAccessToken={setAccessToken}
            onClearAccessToken={() => setAccessToken("")}
            confirmDelete={confirmDelete}
            importNote={importNote}
            importProblem={importProblem}
            changeReasons={divergenceReasons(conversation, state.draft).filter((reason) => reason !== "No active conversation")}
            onDraft={onDraft}
            onClear={() => onDraft({ text: "" })}
            onImport={(name, text) => importFile(name, text)}
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
        <section className={panelClass("dialog")} aria-label="Dialog: Ask questions">
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
        <section className={panelClass("diagnostics")} aria-label="Diagnostics: Inspect records">
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
