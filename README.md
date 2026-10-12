# Context Engineer Workbench v1

**Give AI the background for your project, talk it through, and keep a clear record of each exchange.**

[Open the live app](https://context-engineer-workbench.grok.me) · [User guide and quick start](docs/USER_GUIDE.md)

## What is it?

Context Engineer Workbench is a browser app for conversations that depend on information you supply. Paste project notes, a recipe, a writing brief, or a research procedure into the **Injector**, then ask questions in **Dialog**. The app includes that material with each request so you can keep asking follow-up questions without pasting it again.

The **Diagnostics** panel lets you inspect the background, messages, settings, and outcome recorded for each turn. It shows available token counts—the small pieces of text an AI processes—and fingerprints called hashes that identify the saved content.

This is **context engineering** in a practical form: choosing and organizing the information an AI receives to help it work on a particular task.

## Why it matters

An AI does not automatically know your project’s terminology, constraints, or latest decisions. Supplying that background gives it information to work from. Keeping a record lets you check what you actually supplied when you review an answer later.

Use the workbench to:

- Ask questions about your own notes, specifications, or instructions.
- Reuse the same background throughout a conversation.
- Try a fresh conversation without the background using **Baseline**.
- Inspect how much input was counted and what usage the provider reported.
- Export the context or conversation for later review.

The app preserves the submitted material and records the exchange. It does not guarantee that the AI will follow every instruction or get every detail right. Hashes identify content; they do not establish that an answer is correct.

## Quick start

1. [Open the app](https://context-engineer-workbench.grok.me). On a phone, use the **Injector**, **Dialog**, and **Diagnostics** tabs.
2. In **Injector**, paste your background into **Context** and optionally give it a name.
3. Leave **System slot** selected. Choose **Grok** for an AI response when the server reports it is available, or **Mock** to try the record workflow without a model call.
4. In **Dialog**, type a question and press **Send**.
5. Open **Diagnostics** to inspect that turn, then use **Export turn** or **Export session** to save a copy.

Mock returns a structured receipt, not an AI answer. See the [user guide](docs/USER_GUIDE.md) for a pasteable example, baseline comparisons, import/export, and troubleshooting.

## Current version

This repository contains the browser prototype, with Grok and Mock providers. Conversations are saved in this browser’s local storage. A Grok request travels through the app’s server to xAI; local conversation storage does not make the hosted app an entirely local system.

The draft is not a session. Send freezes the request. The record hash stays Pending until the outcome is final. After that, edits do not rewrite it.

## What you do

Paste context in the injector.

Choose System slot or User paste.

Choose Mock or Grok yourself. The server can report that Grok is available. That report does not switch the provider.

Enter the Grok model ID. Pinned ids are grok-4.7, grok-4.6, grok-4.5, grok-4.5-latest, grok-4, grok-4-0709, and grok-4-latest. Any other id is refused.

Send a prompt. Context is injected once. Then only completed successful exchanges. Then the new prompt.

Open Diagnostics to inspect that turn, or an earlier one. Export the turn or the whole session. Delete removes one saved conversation from this browser.

Baseline starts a new conversation with empty context and no inherited messages. Older conversations stay in the list.

A new conversation also starts when context text, delivery, provider, or model differs from the active one. Changing only the name does not.

One send can be open on a conversation. A failed, timed-out, blocked, or interrupted turn is stored and is not replayed. Mock is never substituted for a Grok failure.

## Two environment variables

Both are required before a Grok call is attempted. Neither one selects Grok for you.

| Variable | Meaning |
| --- | --- |
| WORKBENCH_ENABLE_GROK | Set to `1` to allow the adapter |
| XAI_API_KEY | Server-side credential. It is not shown in the page, the record, or an export |

`WORKBENCH_GROK_CONTEXT_FLOOR` is optional. It can lower a pinned window. It cannot raise one.

Blank temperature, top-p, and seed are omitted. Seed is forwarded when you set one. Max output defaults to 512. Timeout defaults to 30 seconds and covers tokenize plus the sample. There is no retry.

## Local persistence is not provider retention

Conversations live in this browser under local storage key `cew.sessions.v1`.

Choosing Grok transmits the assembled messages to xAI at `https://api.x.ai`. The request sets `store` to false, sends no tools, and does not write encrypted reasoning content into the local record.

That storage flag is the adapter’s request. It is not a guarantee about all provider-side retention.

Mock does not use the network. An oversized messages-json-v1 payload is blocked. Nothing is silently truncated.

## Hashes

Three hashes are stored on a finalized turn.

- Context SHA-256 of the frozen context text.
- Prompt SHA-256 of messages-json-v1. That JSON is an array of `{ "role", "content" }` in that key order, with no extra whitespace.
- Record SHA-256 of the canonical record. Object keys are sorted at every level. The record’s own hash field is left out. The context and prompt hashes stay in.

The fixed vector is `src/lib/workbench/vectors.ts`. Schema `cew-record-v1`.

These hashes identify the app’s records. They do not verify model compliance.

## What was reused

From [prompt-engineering-workbench](https://github.com/donaldtuttle/prompt-engineering-workbench): the Grok availability rule, pinned windows, floor cap, role-labeled tokenize text, one tokenize then one tool-free sample, disabled retries, `api.x.ai` only, storage requested off, encrypted content omitted, usage mapping, missing usage left null, timeout default, max output default, messages-json hashing style, and the offline mock receipt. The Python gRPC SDK is not embedded here. The same constraints run over `POST /v1/tokenize-text` and `POST /v1/chat/completions`.

From [state-dynamics-engine](https://github.com/donaldtuttle/state-dynamics-engine): the diagnostics readout only. The numerical engine is not run.

From [HME](https://github.com/donaldtuttle/HME): the idea of a record identity hash. The field and retrieval engines are not run.

## Tests

`src/lib/workbench/workbench.test.ts` covers history assembly, baseline isolation, snapshot freeze, the three hashes, missing usage, offline mock, failed turns that are not replayed, and the Grok gate.

## Run

Node 22.

```bash
npm install
npm run dev
```

The dev server listens on port 8080.

Leave `.grok/app-env.json` in place. It keeps sign-in off. Without it, the shell treats auth as on.

Grok stays off until the process has both `WORKBENCH_ENABLE_GROK=1` and `XAI_API_KEY`. Set the key in the environment. Do not commit it.

```bash
npm test
npm run typecheck
npm run build
```

