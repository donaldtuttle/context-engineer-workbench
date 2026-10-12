/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute. */

import { Download, Eraser, Upload } from "lucide-react";
import { GROK_WINDOWS } from "@/lib/workbench/windows";
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
  confirmDelete: boolean;
  importNote: string | null;
  importProblem: boolean;
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
    <div className="flex min-h-full flex-col gap-4 p-4">
      <header className="grid gap-1">
        <p className="text-xs text-muted">Panel 1</p>
        <h2 className="text-lg font-medium">Injector</h2>
        <p className="text-sm text-muted">
          This is a draft. Send starts a new conversation only when the text, delivery, provider, or model differs.
        </p>
      </header>

      <label className="grid gap-2">
        <span className="text-sm text-muted">Name</span>
        <input
          className={field}
          value={draft.name}
          maxLength={80}
          placeholder="Optional tag"
          onChange={(event) => props.onDraft({ name: event.target.value })}
        />
      </label>

      <label className="grid min-h-48 flex-1 gap-2">
        <span className="text-sm text-muted">Context</span>
        <textarea
          className={`${field} min-h-48 flex-1 resize-y`}
          value={draft.text}
          placeholder="Paste subject or project context"
          onChange={(event) => props.onDraft({ text: event.target.value })}
        />
      </label>

      <div className="grid gap-1">
        <span className="text-xs text-muted">Context SHA-256</span>
        <p className="font-mono text-xs break-all text-fg">{props.contextHash || "…"}</p>
        <p className="text-xs text-subtle">{bytes.toLocaleString()} UTF-8 bytes. Renaming does not reset history.</p>
        <p className="text-xs text-subtle">
          Bytes are not tokens. On a Grok send, this text is counted on its own. That count is checked against the input budget before the reply is requested.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm" onClick={props.onClear}>
          <Eraser className="size-4" aria-hidden="true" />
          Clear
        </button>
        <label className="relative inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line px-3 text-sm">
          <Upload className="size-4" aria-hidden="true" />
          Import
          <input
            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 text-base"
            type="file"
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
          Export
        </button>
      </div>
      {props.importNote ? (
        <p className={`text-sm ${props.importProblem ? "text-warn" : "text-muted"}`}>{props.importNote}</p>
      ) : null}

      <fieldset className="grid gap-2">
        <legend className="text-sm text-muted">Delivery</legend>
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
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="text-sm text-muted">Provider</legend>
        <div className="grid grid-cols-2 gap-2">
          <ProviderButton current={draft.provider} value="mock" label="Mock" onDraft={props.onDraft} />
          <ProviderButton current={draft.provider} value="grok" label="Grok" onDraft={props.onDraft} />
        </div>
        <p className="text-sm text-muted">
          {props.grokEnabled ? "Grok adapter is available on the server." : props.grokReason}
        </p>
        <p className="text-sm text-muted">
          Availability does not switch the selection. A failed Grok call stays a failure.
        </p>
      </fieldset>

      <label className="grid gap-2">
        <span className="text-sm text-muted">Grok model ID</span>
        <input
          className={field}
          list="grok-model-ids"
          value={draft.model}
          onChange={(event) => props.onDraft({ model: event.target.value })}
        />
        <datalist id="grok-model-ids">
          {Object.keys(GROK_WINDOWS).map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
      </label>

      <details className="rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm">Request settings</summary>
        <div className="mt-3 grid gap-3">
          <NumberField label="Timeout seconds" value={draft.timeoutSeconds} onChange={(timeoutSeconds) => props.onDraft({ timeoutSeconds })} />
          <NumberField label="Max output tokens" value={draft.maxOutputTokens} onChange={(maxOutputTokens) => props.onDraft({ maxOutputTokens })} />
          <p className="text-xs text-subtle">
            Caps the visible reply only. Default is 512. Range is 16 to 8192. This is not the context window. The input budget is the window minus this number. Status length means the reply was cut off here. Reasoning tokens are separate and are not part of this cap.
          </p>
          <NumberField label="Temperature" value={draft.temperature ?? 1} onChange={(temperature) => props.onDraft({ temperature })} />
          <NumberField label="Top-p" value={draft.topP ?? 1} onChange={(topP) => props.onDraft({ topP })} />
          <OptionalNumber label="Seed" value={draft.seed} integer onChange={(seed) => props.onDraft({ seed })} />
          <p className="text-xs text-subtle">
            Temperature 1 and top-p 1 are the provider defaults. Edit them to send a different value. Seed has no default. Leave it blank for a fresh sample.
          </p>
        </div>
      </details>

      <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm" onClick={props.onBaseline}>
        Baseline
      </button>
      <p className="text-sm text-muted">Baseline opens a new conversation with empty context and no inherited messages.</p>

      <div className="grid gap-2 border-t border-line pt-4">
        <span className="text-sm text-muted">Saved conversations</span>
        <select
          className={field}
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
        <div className="flex flex-wrap gap-2">
          <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm text-bad" onClick={props.onDelete} disabled={!props.activeId}>
            {props.confirmDelete ? "Confirm delete" : "Delete"}
          </button>
          <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm" onClick={props.onExportSession}>
            Export session
          </button>
        </div>
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

function ProviderButton(props: { current: ProviderId; value: ProviderId; label: string; onDraft: (patch: Partial<Draft>) => void }) {
  const on = props.current === props.value;
  return (
    <button
      type="button"
      aria-pressed={on}
      className={`min-h-11 rounded-md px-3 text-sm ${on ? "bg-accent text-accent-fg" : "border border-line"}`}
      onClick={() => props.onDraft({ provider: props.value })}
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
