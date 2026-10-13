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

Later provider work and the checks still open on the live app are in the [roadmap](docs/ROADMAP.md).

The draft is not a session. Send freezes the request. The record hash stays Pending until the outcome is final. After that, edits do not rewrite it.

## What you do

Paste context in the injector.

Choose System slot or User paste.

Choose Mock or Grok yourself. The server can report that Grok is available. That report does not switch the provider.

Enter the Grok model ID. The pinned ids are grok-4.7, grok-4.6, and grok-4.5. Each has a 500,000-token window.

Those windows were checked against [xAI pricing](https://docs.x.ai/developers/pricing) on 2026-10-12. The page was dated 2026-10-10. grok-4, grok-4-0709, grok-4-latest, and grok-4.5-latest were not on that page. This app refuses them instead of guessing a window.

Send a prompt. Context is injected once. Then only completed successful exchanges. Then the new prompt.

For a normal request with context, Grok makes two tokenize calls, then one completion. Earlier refusals can stop the sequence:

1. Tokenize the injector text alone, with its delivery role.
2. If that count fits the input budget, tokenize the whole assembled request.
3. If that count also fits, request the completion.

The second count already includes the injector. Do not add the two counts together.

Empty context records an injector count of zero, then counts the assembled request once.

Open Diagnostics to inspect that turn, or an earlier one. Export the turn or the whole session. Delete removes one saved conversation from this browser.

Baseline starts a new conversation with empty context and no inherited messages. Older conversations stay in the list.

A new conversation also starts when context text, delivery, provider, or model differs from the active one. Changing only the name does not.

One send can be open on a conversation. A failed, timed-out, blocked, or interrupted turn is stored and is not replayed. Mock is never substituted for a Grok failure.

## Access token

Paid Grok is not authorized by the page origin. The server also requires `WORKBENCH_ACCESS_TOKEN`.

Generate one on the machine that holds the deployment secrets. Do not commit it.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

The value must be 32 to 256 characters from `A-Z`, `a-z`, `0-9`, `_`, and `-`.

When Grok is selected, type that token into the Access token field. It stays in page memory. It is not written to local storage, exports, hashes, or the address bar. Clear removes it from the page.

This token is not an xAI API key. `XAI_API_KEY` stays on the server.

To rotate it, set a new `WORKBENCH_ACCESS_TOKEN` in the deployment environment and restart. The old value stops matching. Type the new value into the page. Nothing in this repository needs to change.

If the variable is missing, too short, or the wrong shape, paid Grok stays locked.

## Shared allowance

Paid Grok also stays locked until `DATABASE_URL` points at Postgres. That database is the shared allowance. An in-memory counter is not a deployment cap. Preview without `DATABASE_URL` can still use Mock.

These variables are optional. Invalid values lock paid Grok instead of falling back silently.

| Variable | Default | Meaning |
| --- | --- | --- |
| WORKBENCH_RATE_PER_MIN | 10 | Requests admitted per minute for the whole deployment |
| WORKBENCH_DAILY_REQUEST_CAP | 200 | Requests admitted per UTC day |
| WORKBENCH_DAILY_TOKEN_CAP | 500000 | Token allowance reserved per UTC day |
| WORKBENCH_MAX_CONCURRENCY | 2 | Paid requests allowed to run at once |

Each value must be an integer from 1 up to 1000, 100000, 100000000, and 32, in that order.

The allowance is requests and tokens. It is not a dollar ceiling. The provider can bill categories this estimate does not see. A reservation is held before any xAI call. If usage is missing, that reservation is kept. Only usable total usage can reconcile the completion allowance; partial categories do not refund it. The separate tokenizer allowance is retained. Preflight counts and provider usage in the record remain unchanged.

Forwarded client IP headers are not trusted. Until the host provides a verified client identity, the per-minute limit uses one shared bucket for the private access-token principal. This is stricter than a separate allowance for each visitor. Daily caps and concurrent requests stay deployment-wide, including across midnight.

The initial reservation is twice the role-labeled request UTF-8 byte length, plus the injector role-labeled byte length, the requested output cap, and a 131,072-token reasoning allowance. This covers separate allowance estimates for both tokenizer calls and completion. It is a conservative estimate, not a provider-enforced limit on hidden reasoning or an exact billing guarantee. Unknown usage retains the estimate. Reliable completion totals plus the retained tokenizer allowance reconcile against the original UTC day.

Timeouts and unhandled failures retain their concurrency reservation because the provider may still be running. A restart does not clear these holds. Concurrency held by a timed-out request is released automatically after the request timeout plus ten minutes, while its tokens stay charged. A timeout before the completion call releases the slot immediately. After confirming that the provider work has stopped, an operator can release a specific outstanding slot without refunding its unknown token usage:

```sql
SELECT id, period, reserved_tokens
FROM workbench_quota_reservation WHERE NOT settled;
-- Use the reviewed ID below only after confirming the request has stopped:
SELECT workbench_reconcile('reviewed-reservation-id', NULL);
```

Configure `DATABASE_URL` through the deployment's secret settings. Run `npm run db:migrate` before enabling Grok; migrations 0002, 0003, and 0004 create the allowance functions, enforce concurrency across days, and expire stale concurrency holds. Migration 0004 must run before deploying this build. The same database must serve every instance. An absent or unavailable store blocks paid execution.

## Server configuration

| Variable | Meaning |
| --- | --- |
| WORKBENCH_ENABLE_GROK | Set to `1` to allow the adapter |
| XAI_API_KEY | Server-side xAI credential. It is not shown in the page, the record, or an export |
| WORKBENCH_ACCESS_TOKEN | Server-side access token. It is not an API key |
| DATABASE_URL | Postgres connection for the shared allowance |
| WORKBENCH_GROK_CONTEXT_FLOOR | Optional. It can lower a pinned window. It cannot raise one |

Blank temperature, top-p, and seed are omitted. Seed is forwarded when you set one. Max output defaults to 512. Timeout defaults to 30 seconds and covers both token counts plus the completion. There is no retry.

Paid Grok is not protected in a deployment until that deployment actually has the flag, the API key, the access token, and `DATABASE_URL`. This repository does not claim that the live app already has those set.

## Local persistence is not provider retention

New saves use the browser key `cew.sessions.v2`. Repeated text inside one conversation is stored once. The saved record still rebuilds the original turn, including its three hashes.

Older saves under `cew.sessions.v1` are still read. After a checked copy is written to v2, v1 is left on disk. The app does not restore v1 after you delete a conversation from v2. An older build reads only v1, so it does not treat packed v2 data as an empty session.

If saved data cannot be read, the app leaves those bytes in place, shows a warning on every panel, and can export them. It does not overwrite them until you confirm Reset saved data.

If a later save fails, the page keeps the conversations in memory and shows a warning. Export the session before you close the page. The warning clears after a save succeeds.

Choosing Grok transmits the assembled messages to xAI at `https://api.x.ai`. The request sets `store` to false, sends no tools, and does not write encrypted reasoning content into the local record.

That storage flag is the adapter’s request. It is not a guarantee about all provider-side retention.

Mock does not use the network. An oversized messages-json-v1 payload is blocked. Nothing is silently truncated.

## Hashes

Three hashes are stored on a finalized turn.

- Context SHA-256 of the frozen context text.
- Prompt SHA-256 of messages-json-v1. That JSON is an array of `{ "role", "content" }` in that key order, with no extra whitespace.
- Record SHA-256 of the canonical record. Object keys are sorted at every level. The record’s own hash field is left out. The context and prompt hashes stay in.

The v1 schema permits additive optional `budgetWarning`, `quotaAccounting`, and injector measurement-scope fields. They participate in the hash only when actually present. Legacy records are verified unchanged; no fields are backfilled. New readers validate these optional fields. Older readers may not display them.

A valid completed response with a budget discrepancy stays successful and eligible for history, with a visible warning. Its original preflight counts are not replaced by provider usage. Every next request still passes its own gate.

The fixed vector is `src/lib/workbench/vectors.ts`. Schema `cew-record-v1`.

These hashes identify the app’s records. They do not verify model compliance. A hash sent with a paid request is only a consistency check.

## What was reused

From [prompt-engineering-workbench](https://github.com/donaldtuttle/prompt-engineering-workbench): the Grok availability rule, pinned windows, floor cap, role-labeled tokenize text, two tokenize calls then one tool-free completion when context is present, disabled retries, `api.x.ai` only, storage requested off, encrypted content omitted, usage mapping, missing usage left null, timeout default, max output default, messages-json hashing style, and the offline mock receipt. The Python gRPC SDK is not embedded here. The same constraints run over `POST /v1/tokenize-text` and `POST /v1/chat/completions`.

From [state-dynamics-engine](https://github.com/donaldtuttle/state-dynamics-engine): the diagnostics readout only. The numerical engine is not run.

From [HME](https://github.com/donaldtuttle/HME): the idea of a record identity hash. The field and retrieval engines are not run.

## Tests

`src/lib/workbench/workbench.test.ts` covers history assembly, baseline isolation, snapshot freeze, the three hashes, missing usage, offline mock, failed turns that are not replayed, and the Grok gate.

`src/lib/workbench/hardening.test.ts` additionally exercises actual quota SQL in embedded PostgreSQL, cross-day concurrency, storage failures, and rejected requests. This is not a production deployment test.

`src/lib/workbench/guard.test.ts` covers the access token, the shared allowance, packed storage, and credential leakage in client modules.

## Run

Node 22.

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run dev
```

The dev server listens on port 8080.

Leave `.grok/app-env.json` in place. It keeps sign-in off. Without it, the shell treats auth as on.

Do not commit `XAI_API_KEY` or `WORKBENCH_ACCESS_TOKEN`.

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

