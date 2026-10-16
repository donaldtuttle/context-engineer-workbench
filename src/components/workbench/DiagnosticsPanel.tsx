/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute. */

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { verifyRecordHash } from "@/lib/workbench/records";
import { DEFAULT_TEMPERATURE, DEFAULT_TOP_P, type Conversation, type TurnRecord } from "@/lib/workbench/types";

type Props = {
  conversation: Conversation | null;
  turn: TurnRecord | null;
  onSelect: (id: string | null) => void;
  onExport: () => void;
};

export function DiagnosticsPanel(props: Props) {
  const turn = props.turn;
  const [matches, setMatches] = useState<boolean | null>(null);

  useEffect(() => {
    if (!turn?.recordSha256) {
      setMatches(null);
      return;
    }
    let cancel = false;
    verifyRecordHash(turn).then((ok) => {
      if (!cancel) setMatches(ok);
    });
    return () => {
      cancel = true;
    };
  }, [turn]);

  return (
    <div className="flex flex-col gap-5 p-4">
      <header className="grid gap-1">
        <p className="text-xs text-muted">Panel 3</p>
        <h2 className="text-lg font-medium">Diagnostics</h2>
        <p className="text-sm text-muted">Inspect records</p>
        <p className="text-sm text-muted">Review the context, messages, settings, and result recorded for one exchange. Select Latest or an earlier turn.</p>
      </header>

      {props.conversation && props.conversation.turns.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button type="button" className="min-h-11 shrink-0 rounded-md border border-line px-3 text-sm" onClick={() => props.onSelect(null)}>
            Latest
          </button>
          {props.conversation.turns.map((item, index) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === turn?.id}
              className={`min-h-11 shrink-0 rounded-md px-3 text-sm ${item.id === turn?.id ? "bg-accent text-accent-fg" : "border border-line"}`}
              onClick={() => props.onSelect(item.id)}
            >
              {index + 1} · {item.executionStatus}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">Send a question to create a turn record. Mock lets you explore this panel without a model call.</p>
      )}

      {turn ? (
        <>
          <dl className="grid gap-4">
            <Hash label="Context SHA-256" value={turn.contextSha256} />
            <Hash label="messages-json-v1 prompt SHA-256" value={turn.promptSha256} />
            <Hash label="Record SHA-256" value={turn.recordSha256 ?? "Pending"} />
          </dl>
          <p className="text-sm text-muted">
            {turn.recordSha256
              ? matches
                ? "A matching record fingerprint confirms consistency with that fingerprint, not AI accuracy or instruction following."
                : "Record hash does not match. The stored turn was not rewritten."
              : "The record fingerprint will be finalized when the request outcome is recorded."}
          </p>
          <p className="text-sm text-muted">
            Status shows whether the request completed, is still waiting, or ended with a problem. Success does not mean the answer is correct. Current status: {turn.executionStatus}.
          </p>

          <Readout turn={turn} />
          {turn.budgetWarning ? (
            <p className="text-sm text-warn" role="status">
              {turn.budgetWarning}
            </p>
          ) : null}
          <Meter turn={turn} />

          <p className="text-sm text-muted">
            Fingerprints identify the saved content. A matching record fingerprint confirms consistency with that fingerprint, not AI accuracy or instruction following.
          </p>

          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer text-sm">Recorded request details</summary>
            <p className="mt-3 text-sm text-muted">
              Saved context, message list, settings, and budget information. A prepared request record does not, by itself, prove provider processing.
            </p>
            <pre className="mt-3 overflow-x-auto font-mono text-xs whitespace-pre-wrap break-words text-muted">
              {JSON.stringify(
                {
                  settings: turn.settings,
                  transport: turn.transport,
                  frozenContextText: turn.frozenContextText,
                  assembledMessages: turn.assembledMessages,
                  contextBudget: turn.contextBudget,
                },
                null,
                2,
              )}
            </pre>
          </details>

          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm"
            onClick={props.onExport}
          >
            <Download className="size-4" aria-hidden="true" />
            Export this turn
          </button>
        </>
      ) : null}
    </div>
  );
}

function Hash(props: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted">{props.label}</dt>
      <dd className="font-mono text-xs break-all">{props.value}</dd>
    </div>
  );
}

function Readout(props: { turn: TurnRecord }) {
  const { turn } = props;
  const usage = turn.providerUsage;
  const injection = turn.contextBudget.injectionTokens;
  const rows: [string, string][] = [
    ["Status", turn.executionStatus],
    ["Delivery", turn.settings.deliveryMode],
    ["Requested model", turn.requestedModel],
    ["Returned model", turn.returnedModel ?? "not returned"],
    ["Response status", turn.responseStatus ?? "not finished"],
    ["Max output tokens", String(turn.settings.maxOutputTokens)],
    ["Temperature", turn.settings.temperature === null ? `${DEFAULT_TEMPERATURE} · provider default` : String(turn.settings.temperature)],
    ["Top-p", turn.settings.topP === null ? `${DEFAULT_TOP_P} · provider default` : String(turn.settings.topP)],
    ["Seed", turn.settings.seed === null ? "none" : String(turn.settings.seed)],
    ["Messages", String(turn.preflight.messageCount)],
    ["Context bytes", turn.preflight.contextUtf8Bytes.toLocaleString()],
    ["Injection tokens", injection === undefined || injection === null ? "not counted" : injection.toLocaleString()],
    ["Injection count scope", turn.contextBudget.injectionCountSource ?? "not recorded"],
    ["Prompt bytes", turn.preflight.promptUtf8Bytes.toLocaleString()],
    ["Counted input tokens", turn.preflight.countedInputTokens === null ? "not counted" : turn.preflight.countedInputTokens.toLocaleString()],
    ["Full-request count scope", turn.preflight.countSource],
    ["Provider input", usage?.input_tokens === undefined ? "not reported" : usage.input_tokens.toLocaleString()],
    ["Provider output", usage?.output_tokens === undefined ? "not reported" : usage.output_tokens.toLocaleString()],
    ["Reasoning tokens", usage?.reasoning_tokens === undefined ? "not reported" : usage.reasoning_tokens.toLocaleString()],
    ["Provider total", usage?.total_tokens === undefined ? "not reported" : usage.total_tokens.toLocaleString()],
    ["Quota period", turn.quotaAccounting?.period ?? "not reserved"],
    ["Quota reserved tokens", turn.quotaAccounting ? turn.quotaAccounting.reservedTokens.toLocaleString() : "not reserved"],
    ["Quota settled tokens", !turn.quotaAccounting ? "not reserved" : turn.quotaAccounting.settledTokens === null ? "kept the reservation" : turn.quotaAccounting.settledTokens.toLocaleString()],
    ["Window", turn.contextBudget.modelContextWindow === null ? "not measured" : turn.contextBudget.modelContextWindow.toLocaleString()],
    ["Floor", turn.contextBudget.contextFloor === null ? "not measured" : `${turn.contextBudget.contextFloor.toLocaleString()} (${turn.contextBudget.contextFloorSource})`],
    ["Input budget", turn.contextBudget.budget === null ? "not measured" : turn.contextBudget.budget.toLocaleString()],
  ];
  return (
    <div className="grid gap-3 rounded-lg bg-surface p-3">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-1">
          <p className="text-xs text-muted">{label}</p>
          <p className="font-mono text-sm break-all">{value}</p>
        </div>
      ))}
      <p className="text-sm text-muted">{turn.preflight.measurementScope}</p>
      <p className="text-sm text-muted">
        Context tokens are already part of the full input count. Do not add them again. Provider usage is reported separately and may differ. Not counted or not reported means unavailable, not zero. Max output tokens limit the visible reply. Status length means that cap was hit. Reasoning tokens are extra.
      </p>
      <p className="text-sm text-muted">
        These quota figures track the deployment's request allowance. They are not a provider bill or dollar amount.
      </p>
    </div>
  );
}

function Meter(props: { turn: TurnRecord }) {
  const counted = props.turn.contextBudget.countedInputTokens;
  const budget = props.turn.contextBudget.budget;
  if (counted === null || budget === null || budget <= 0) {
    return <p className="text-sm text-muted">No input-budget chart is available because this turn lacks a usable input count or budget.</p>;
  }
  const ratio = Math.max(0, Math.min(counted / budget, 1));
  const width = counted > 0 ? Math.max(ratio * 100, 1.5) : 0;
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted">Input used / input allowance</p>
      <div className="h-3 overflow-hidden rounded-sm bg-raised" aria-hidden="true">
        <div className="h-full bg-trace" style={{ width: `${width}%` }} />
      </div>
      <p className="font-mono text-xs text-muted">
        {counted.toLocaleString()} / {budget.toLocaleString()}
      </p>
      <p className="text-xs text-subtle">
        Shows counted input, including context and history, against the configured allowance. It is not an answer-quality or confidence score.
      </p>
    </div>
  );
}
