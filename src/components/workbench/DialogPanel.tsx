/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute. */

import { useEffect, useRef } from "react";
import { Send } from "lucide-react";
import type { Conversation } from "@/lib/workbench/types";

type Props = {
  conversation: Conversation | null;
  reasons: string[];
  prompt: string;
  note: string | null;
  pending: boolean;
  onPrompt: (value: string) => void;
  onSend: () => void;
  onComposerFocus: (focused: boolean) => void;
};

export function DialogPanel(props: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const turns = props.conversation?.turns.length ?? 0;

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns, props.conversation?.id]);

  function liftComposer() {
    const field = composer.current;
    const pane = scroller.current;
    const frame = window.visualViewport;
    if (!field || !pane) return;
    const place = () => {
      const box = field.getBoundingClientRect();
      const viewTop = frame?.offsetTop ?? 0;
      const viewBottom = viewTop + (frame?.height ?? window.innerHeight);
      if (box.bottom > viewBottom - 12) pane.scrollTop += box.bottom - (viewBottom - 12);
      else if (box.top < viewTop + 12) pane.scrollTop -= viewTop + 12 - box.top;
    };
    requestAnimationFrame(place);
    window.setTimeout(place, 80);
    window.setTimeout(place, 320);
  }

  return (
    <div ref={scroller} className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
      <header className="grid shrink-0 gap-1 border-b border-line bg-bg p-4">
          <p className="text-xs text-muted">Panel 2</p>
          <h2 className="text-lg font-medium">Dialog</h2>
          {props.conversation ? (
            <p className="text-sm text-muted">
              {(props.conversation.contextName || "Untitled") + " · " + props.conversation.provider}
              {props.conversation.contextText ? "" : " · empty context"}
            </p>
          ) : (
            <p className="text-sm text-muted">No conversation yet. The draft stays a draft until you send.</p>
          )}
          {props.reasons.length > 0 && props.conversation ? (
            <p className="text-sm text-warn">Next send starts a new conversation: {props.reasons.join(", ")}.</p>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {props.conversation && props.conversation.contextText ? (
            <p className="text-sm text-muted">
              Context is injected once per request as {props.conversation.deliveryMode === "SYSTEM_SLOT" ? "a system message" : "a user message"}.
            </p>
          ) : null}
          {props.conversation && props.conversation.turns.length === 0 ? (
            <p className="text-sm text-muted">No messages. Nothing was inherited.</p>
          ) : null}
          {props.conversation?.turns.map((turn, index) => (
            <article key={turn.id} className="grid gap-2">
              <p className="text-xs text-subtle">Turn {index + 1}</p>
              <div className="rounded-lg bg-raised px-3 py-3">
                <p className="text-xs text-muted">You</p>
                <p className="whitespace-pre-wrap break-words">{turn.userPrompt}</p>
              </div>
              <div className="rounded-md border border-line px-3 py-3">
                <p className="text-xs text-muted">
                  {turn.executionStatus === "pending"
                    ? "Waiting"
                    : turn.executionStatus === "success"
                      ? turn.returnedModel || "Assistant"
                      : `${turn.executionStatus} · not replayed`}
                </p>
                {turn.responseText ? <p className="mt-2 whitespace-pre-wrap break-words">{turn.responseText}</p> : null}
                {turn.error ? <p className="mt-2 text-sm text-bad">{turn.error.message}</p> : null}
              </div>
            </article>
          ))}
        </div>

        <form
          className="grid shrink-0 gap-2 border-t border-line bg-bg p-4 pb-safe"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSend();
          }}
        >
          {props.note ? <p className="text-sm text-warn">{props.note}</p> : null}
          <label className="grid gap-2">
            <span className="sr-only">Prompt</span>
            <textarea
              ref={composer}
              className="max-h-40 min-h-24 w-full resize-y rounded-md border border-line bg-raised px-3 py-2 text-base text-fg"
              value={props.prompt}
              placeholder="Prompt"
              enterKeyHint="send"
              onChange={(event) => props.onPrompt(event.target.value)}
              onFocus={() => {
                props.onComposerFocus(true);
                liftComposer();
              }}
              onBlur={() => props.onComposerFocus(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  props.onSend();
                }
              }}
            />
          </label>
          <button
            type="submit"
            disabled={props.pending}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-50"
          >
            <Send className="size-4" aria-hidden="true" />
            {props.pending ? "Sending" : "Send"}
          </button>
          <p className="text-xs text-subtle">Enter sends. Shift+Enter adds a line. One send can be open on a conversation.</p>
        </form>
    </div>
  );
}
