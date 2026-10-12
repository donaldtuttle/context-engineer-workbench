# Context Engineer Workbench v1

A three-panel instrument for one subject context, one conversation, and a frozen record of each turn.

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

