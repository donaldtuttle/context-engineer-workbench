/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute. */

import { Download, Eraser, Upload } from "lucide-react";
import { GROK_WINDOWS } from "@/lib/workbench/windows";
import { CHATGPT_WINDOWS } from "@/lib/workbench/openai-windows";
import type { Conversation, DeliveryMode, Draft, ProviderId } from "@/lib/workbench/types";

const field =
  "min-h-11 w-full rounded-md border border-line bg-raised px-3 py-2 text-base text-fg placeholder:text-subtle";

type Props = {
  draft: Draft;
  contextHash: string;
  conversations: Conversation[];
  activeId: string | null;
  grokEnabled: boolean;
  grokReason: string | null;
  chatgptEnabled: boolean;
  chatgptReason: string | null;
  accessToken: string;
  onAccessToken: (value: string) => void;
  onClearAccessToken: () => void;
  confirmDelete: boolean;
  importNote: string | null;
  importProblem: boolean;
  changeReasons: string[];
  onDraft: (patch: Partial<Draft>) => void;
  onClear: () => void;
  onImport: (name: string, text: string) => void;
  onExportContext: () => void;
  onBaseline: () => void;
  onOpen: (id: string) => void;
  onDelete: () => void;
  onExportSession: () => void;
};

export function InjectorPanel(props: Props) {
  const { draft } = props;
  const bytes = new TextEncoder().encode(draft.text).length;

  return (
    <div className="flex w-full flex-col gap-4 p-4">
      <header className="grid gap-1">
        <p className="text-xs text-muted">Panel 1</p>
        <h2 className="text-lg font-medium">Injector</h2>
        <p className="text-sm text-muted">Add context</p>
        <p className="text-sm text-muted">
          Paste the background information and instructions you want included with each question. Nothing is sent to the AI until you press Send.
        </p>
      </header>

      <label className="grid gap-2">
        <span className="text-sm text-muted">Name</span>
        <input
          className={field}
          value={draft.name}
          maxLength={80}
          placeholder="Studio lamp brief"
          onChange={(event) => props.onDraft({ name: event.target.value })}
        />
        <span className="text-xs text-subtle">Optional label. Changing the name does not start a new conversation.</span>
      </label>

      <label className="grid shrink-0 gap-2">
        <span className="text-sm text-muted">Context</span>
        <textarea
          className={`${field} block min-h-48 w-full resize-y overflow-hidden [field-sizing:content]`}
          value={draft.text}
          placeholder="Paste your project notes, facts, requirements, or instructions here."
          onChange={(event) => props.onDraft({ text: event.target.value })}
        />
      </label>
      <details className="relative shrink-0 rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm">About this context</summary>
        <p className="mt-3 text-sm text-muted">
          This text is included once with every request. Website and GitHub links are not opened automatically.
        </p>
      </details>

      <div className="grid gap-1">
        <span className="text-xs text-muted">Context SHA-256</span>
        <p className="font-mono text-xs break-all text-fg">{props.contextHash || "…"}</p>
        <p className="text-xs text-subtle">A fingerprint of this draft text. It changes when the text changes. It does not measure answer quality.</p>
        <p className="text-xs text-subtle">{bytes.toLocaleString()} bytes. Token counts, when available, appear in Diagnostics after you send.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm" onClick={props.onClear}>
          <Eraser className="size-4" aria-hidden="true" />
          Clear context
        </button>
        <label className="relative inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line px-3 text-sm">
          <Upload className="size-4" aria-hidden="true" />
          Import
          <input
            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 text-base"
            type="file"
            aria-label="Import"
            onChange={(event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              if (!file) return;
              void file.text().then(
                (text) => {
                  input.value = "";
                  props.onImport(file.name, text);
                },
                () => {
                  input.value = "";
                  props.onImport(file.name, "");
                },
              );
            }}
          />
        </label>
        <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm" onClick={props.onExportContext}>
          <Download className="size-4" aria-hidden="true" />
          Export context
        </button>
      </div>
      <p className="text-xs text-subtle">Clear context empties the draft text. Saved conversations are not deleted.</p>
      <details className="rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm">What import and export include</summary>
        <p className="mt-3 text-sm text-muted">
          Import loads text, context JSON, or a supported workbench export. Website loading and ZIP extraction are not supported.
        </p>
        <p className="mt-2 text-sm text-muted">Export context saves the current context name and text. Conversation messages are not included.</p>
      </details>
      {props.importNote ? (
        <p className={`text-sm ${props.importProblem ? "text-warn" : "text-muted"}`}>{props.importNote}</p>
      ) : null}
      {props.changeReasons.length > 0 ? (
        <p className="text-sm text-warn">
          You changed {props.changeReasons.join(", ")}. Your next message will start a new conversation. Earlier conversations will remain saved.
        </p>
      ) : null}

      <fieldset className="grid gap-2">
        <legend className="text-sm text-muted">Delivery</legend>
        <p className="text-sm text-muted">Choose how the context is placed before your conversation.</p>
        <div className="grid grid-cols-2 gap-2">
          <ModeButton
            current={draft.deliveryMode}
            value="SYSTEM_SLOT"
            label="System slot"
            onDraft={props.onDraft}
          />
          <ModeButton
            current={draft.deliveryMode}
            value="USER_PASTE"
            label="User paste"
            onDraft={props.onDraft}
          />
        </div>
        <p className="text-xs text-subtle">System slot sends the context as a system message. User paste sends it as the first user message.</p>
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm">What delivery changes</summary>
          <p className="mt-3 text-sm text-muted">
            These options change the context's role in the request. Neither retrains the model or guarantees that it follows every instruction.
          </p>
        </details>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="text-sm text-muted">Provider</legend>
        <div className="grid grid-cols-3 gap-2">
          <ProviderButton current={draft.provider} model={draft.model} value="mock" label="Mock" onDraft={props.onDraft} />
          <ProviderButton current={draft.provider} model={draft.model} value="grok" label="Grok" onDraft={props.onDraft} />
          <ProviderButton current={draft.provider} model={draft.model} value="chatgpt" label="ChatGPT" onDraft={props.onDraft} />
        </div>
        <p className="text-xs text-subtle">Mock tries the workflow without calling an AI model. The result is a technical receipt, not an AI answer.</p>
        <p className="text-xs text-subtle">Grok requests an AI response through this app's server. It requires enabled access and may use paid API credits.</p>
        <p className="text-xs text-subtle">ChatGPT requests an AI response through this app's server. It uses its own server key, not the Grok key, and may use paid API credits.</p>
        <p className="text-sm text-muted">
          {draft.provider === "grok"
            ? props.grokEnabled
              ? "Grok adapter is available on the server."
              : props.grokReason
            : draft.provider === "chatgpt"
              ? props.chatgptEnabled
                ? "ChatGPT adapter is available on the server."
                : props.chatgptReason
              : "Mock does not call a model."}
        </p>
        <p className="text-sm text-muted">Choose the provider yourself. A failed Grok or ChatGPT request will not be replaced with a Mock response.</p>
      </fieldset>

      {draft.provider === "grok" || draft.provider === "chatgpt" ? (
        <div className="grid gap-2">
          <label className="grid gap-2">
            <span className="text-sm text-muted">Access token</span>
            <input
              className={field}
              type="password"
              name="workbench-access-token"
              autoComplete="off"
              spellCheck={false}
              value={props.accessToken}
              onChange={(event) => props.onAccessToken(event.target.value)}
            />
          </label>
          <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm" onClick={props.onClearAccessToken}>
            Clear access token
          </button>
          <p className="text-sm text-muted">
            Enter the app access token supplied by the deployment owner. This is not an xAI or OpenAI key. It stays in this page's memory and is cleared when you reload.
          </p>
        </div>
      ) : null}

      <label className="grid gap-2">
        <span className="text-sm text-muted">{draft.provider === "chatgpt" ? "ChatGPT model ID" : "Grok model ID"}</span>
        <input
          className={field}
          list={draft.provider === "chatgpt" ? "chatgpt-model-ids" : "grok-model-ids"}
          value={draft.model}
          onChange={(event) => props.onDraft({ model: event.target.value })}
        />
        <span className="text-xs text-subtle">Choose a supported model from the suggestions. A different model starts a new conversation on the next Send.</span>
        <datalist id="grok-model-ids">
          {Object.keys(GROK_WINDOWS).map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        <datalist id="chatgpt-model-ids">
          {Object.keys(CHATGPT_WINDOWS).map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
      </label>

      <details className="rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm">Request settings</summary>
        <p className="mt-3 text-sm text-muted">Start with the defaults. Adjust these settings when you need a different reply limit or are comparing request settings.</p>
        <div className="mt-3 grid gap-3">
          <NumberField label="Timeout seconds" value={draft.timeoutSeconds} onChange={(timeoutSeconds) => props.onDraft({ timeoutSeconds })} />
          <p className="text-xs text-subtle">How long the app waits for input counting and the response. A timeout does not prove that the provider stopped processing the request.</p>
          <NumberField label="Max output tokens" value={draft.maxOutputTokens} onChange={(maxOutputTokens) => props.onDraft({ maxOutputTokens })} />
          <p className="text-xs text-subtle">
            Limit for the visible reply, not the full conversation. Increase it when an answer is cut short. A larger limit leaves less of the configured window available for input. Default is 512. Range is 16 to 8192. Status length means the reply was cut off here. Reasoning tokens are separate and are not part of this cap.
          </p>
          <NumberField label="Temperature" value={draft.temperature ?? 1} onChange={(temperature) => props.onDraft({ temperature })} />
          <p className="text-xs text-subtle">Controls randomness in text selection. Leave the default for your first conversation.</p>
          <NumberField label="Top-p" value={draft.topP ?? 1} onChange={(topP) => props.onDraft({ topP })} />
          <p className="text-xs text-subtle">Controls how broad a set of likely text choices the model can sample from. Leave the default unless you are testing this setting.</p>
          <OptionalNumber label="Seed" value={draft.seed} integer onChange={(seed) => props.onDraft({ seed })} />
          <p className="text-xs text-subtle">
            Optional sampling seed. Leave blank for ordinary use. Setting a seed is not a guarantee of identical responses. Temperature 1 and top-p 1 are the provider defaults. Seed has no default.
          </p>
        </div>
      </details>

      <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm" onClick={props.onBaseline}>
        Start without context
      </button>
      <p className="text-sm text-muted">Opens a conversation with no background text and no previous messages. Your other conversations remain saved.</p>

      <div className="grid gap-2 border-t border-line pt-4">
        <span className="text-sm text-muted">Saved conversations</span>
        <p className="text-xs text-subtle">Reopen a conversation stored in this browser to read its messages and inspect individual turns.</p>
        <select
          className={field}
          aria-label="Saved conversations"
          value={props.activeId ?? ""}
          onChange={(event) => {
            if (event.target.value) props.onOpen(event.target.value);
          }}
        >
          <option value="">None selected</option>
          {props.conversations.map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {(conversation.contextName || "Untitled") + " · " + conversation.provider + " · " + conversation.turns.length}
            </option>
          ))}
        </select>
        {props.confirmDelete ? (
          <p className="text-sm text-warn">
            Remove this conversation from this browser? Export a copy first if you need to keep it. Existing export files are not deleted.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm text-bad" onClick={props.onDelete} disabled={!props.activeId}>
            {props.confirmDelete ? "Confirm delete" : "Delete conversation"}
          </button>
          <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm" onClick={props.onExportSession}>
            Export all conversations
          </button>
        </div>
        <p className="text-xs text-subtle">Export all conversations saves every conversation this app holds in this browser, including context and turn records.</p>
      </div>
    </div>
  );
}

function ModeButton(props: { current: DeliveryMode; value: DeliveryMode; label: string; onDraft: (patch: Partial<Draft>) => void }) {
  const on = props.current === props.value;
  return (
    <button
      type="button"
      aria-pressed={on}
      className={`min-h-11 rounded-md px-3 text-sm ${on ? "bg-accent text-accent-fg" : "border border-line"}`}
      onClick={() => props.onDraft({ deliveryMode: props.value })}
    >
      {props.label}
    </button>
  );
}

function ProviderButton(props: { current: ProviderId; model: string; value: ProviderId; label: string; onDraft: (patch: Partial<Draft>) => void }) {
  const on = props.current === props.value;
  const known = props.value === "chatgpt" ? CHATGPT_WINDOWS : GROK_WINDOWS;
  const fallback = props.value === "chatgpt" ? "gpt-4.1" : "grok-4.5";
  const nextModel = Object.hasOwn(known, props.model) ? undefined : fallback;
  return (
    <button
      type="button"
      aria-pressed={on}
      className={`min-h-11 rounded-md px-2 text-sm ${on ? "bg-accent text-accent-fg" : "border border-line"}`}
      onClick={() => props.onDraft(nextModel ? { provider: props.value, model: nextModel } : { provider: props.value })}
    >
      {props.label}
    </button>
  );
}

function NumberField(props: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm text-muted">{props.label}</span>
      <input
        className={field}
        inputMode="decimal"
        value={String(props.value)}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) props.onChange(next);
        }}
      />
    </label>
  );
}

function OptionalNumber(props: {
  label: string;
  value: number | null;
  integer?: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm text-muted">{props.label}</span>
      <input
        className={field}
        inputMode={props.integer ? "numeric" : "decimal"}
        value={props.value ?? ""}
        placeholder="None"
        onChange={(event) => {
          const raw = event.target.value.trim();
          if (!raw) {
            props.onChange(null);
            return;
          }
          const next = Number(raw);
          if (Number.isFinite(next)) props.onChange(props.integer ? Math.trunc(next) : next);
        }}
      />
    </label>
  );
}
