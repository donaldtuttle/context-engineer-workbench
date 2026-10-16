/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute. */

import { useEffect, useRef, useState } from "react";
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
  const formRef = useRef<HTMLFormElement>(null);
  const [typing, setTyping] = useState(false);
  const turns = props.conversation?.turns.length ?? 0;
  const changed = props.reasons.filter((reason) => reason !== "No active conversation");

  useEffect(() => {
    const form = formRef.current;
    const scroller = form?.closest(".panel-scroll");
    if (scroller instanceof HTMLElement) scroller.scrollTop = scroller.scrollHeight;
  }, [turns, props.conversation?.id]);

  return (
    <div className="flex w-full flex-col">
      <header className={`grid shrink-0 gap-1 border-b border-line bg-bg p-4 ${typing ? "max-lg:hidden" : ""}`}>
          <p className="text-xs text-muted">Panel 2</p>
          <h2 className="text-lg font-medium">Dialog</h2>
          <p className="text-sm text-muted">Ask questions</p>
          <p className="text-sm text-muted">Ask a question about your context, then continue with follow-up questions.</p>
          {props.conversation ? (
            <p className="text-sm text-muted">
              {(props.conversation.contextName || "Untitled") + " · " + props.conversation.provider}
              {props.conversation.contextText ? "" : " · empty context"}
            </p>
          ) : (
            <p className="text-sm text-muted">No messages yet. Add background in Injector, choose Mock, Grok, or ChatGPT, then send a question here. You can also start without context.</p>
          )}
          {changed.length > 0 && props.conversation ? (
            <p className="text-sm text-warn">
              You changed {changed.join(", ")}. Your next message will start a new conversation. Earlier conversations will remain saved.
            </p>
          ) : null}
        </header>

        <div className="grid gap-4 p-4">
          {props.conversation && props.conversation.contextText ? (
            <p className="text-sm text-muted">
              Each request includes your context once, completed successful exchanges, and your latest question. It is sent as{" "}
              {props.conversation.deliveryMode === "SYSTEM_SLOT" ? "a system message" : "a user message"}.
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
                {turn.budgetWarning ? <p className="mt-2 text-sm text-warn">{turn.budgetWarning}</p> : null}
                {turn.responseStatus === "length" ? (
                  <p className="mt-2 text-sm text-muted">
                    This reply reached the output limit. Increase Max output tokens in Injector and send the question again. The partial reply remains in the record. Reasoning tokens are not part of this cap.
                  </p>
                ) : null}
                {turn.executionStatus !== "pending" && turn.executionStatus !== "success" ? (
                  <p className="mt-2 text-sm text-muted">This turn is saved for review but will not be included in later requests.</p>
                ) : null}
                {turn.error ? <p className="mt-2 text-sm text-bad">{turn.error.message}</p> : null}
              </div>
            </article>
          ))}
        </div>

        <form
          ref={formRef}
          className="grid shrink-0 gap-2 border-t border-line bg-bg p-3 pb-safe lg:p-4"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSend();
          }}
        >
          {props.note ? <p className="text-sm text-warn">{props.note}</p> : null}
          <div className="flex items-end gap-2 lg:grid">
            <label className="grid min-w-0 flex-1 gap-2">
              <span className="sr-only">Prompt</span>
              <textarea
                className="max-h-32 min-h-12 w-full resize-y rounded-md border border-line bg-raised px-3 py-2 text-base text-fg lg:max-h-40 lg:min-h-24"
                value={props.prompt}
                placeholder="Ask a question or describe what you want the AI to do."
                enterKeyHint="enter"
                onChange={(event) => props.onPrompt(event.target.value)}
                onFocus={() => {
                  setTyping(true);
                  props.onComposerFocus(true);
                }}
                onBlur={() => {
                  setTyping(false);
                  props.onComposerFocus(false);
                }}
                onKeyDown={(event) => {
                  const desktop = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
                  if (desktop && event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    props.onSend();
                  }
                }}
              />
            </label>
            <button
              type="submit"
              disabled={props.pending}
              className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-50 lg:min-h-11 lg:w-full"
            >
              <Send className="size-4" aria-hidden="true" />
              {props.pending ? "Sending" : "Send"}
            </button>
          </div>
          <p className={`text-xs text-subtle lg:hidden ${typing ? "hidden" : ""}`}>Return adds a line. Tap Send when you're ready.</p>
          <p className="hidden text-xs text-subtle lg:block">Enter sends. Shift+Enter adds a line. Wait for the current request to finish before sending another message in this conversation.</p>
        </form>
    </div>
  );
}
