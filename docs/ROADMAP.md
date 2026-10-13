# Next steps

Pickup notes for a later session. Read this before adding a provider.

Live app: [context-engineer-workbench.grok.me](https://context-engineer-workbench.grok.me)

Repo: [donaldtuttle/context-engineer-workbench](https://github.com/donaldtuttle/context-engineer-workbench)

## Where main is

As of 2026-10-12, `main` is `bc3a03e` ("Release a timed-out concurrency slot without refunding its tokens").

The app has two providers: Mock and Grok. Records are `cew-record-v1`. Saves are local (`cew.sessions.v2`, with v1 still readable). Auth is off. There is no `user_id`.

Paid Grok is one server path:

1. Count the injector text.
2. Count the full prompt.
3. Keep both counts.
4. Reserve one quota hold.
5. Send one tool-free chat completion to `https://api.x.ai`. No retry. `store` is false.

A timeout before that completion frees the concurrency slot and keeps the tokenizer allowance. A timeout after it keeps the slot until the request timeout plus 10 minutes (`QUOTA_HOLD_GRACE_MS`). Tokens stay charged. Migration `0004` does this in Postgres. Do not refund a hold just because the client gave up.

New sends use a timeout of 5 to 300 seconds. Saved records may still say `0.05`. Leave that validator alone.

## Do not treat the live app as finished

Checked on 2026-10-12, about 18:45 MDT, with no model call:

- The public status was `Requires WORKBENCH_ENABLE_GROK=1 and server-side XAI_API_KEY`.
- That check runs before the database check, so the shared store and migrations 0002, 0003, and 0004 were not confirmed.
- The live page was still the previous build (`styles-BJwa61FX`, `index-DhF0kkxn`, `routes-BfB2Kh-r`).
- Project id on that page: `01a131c9-47ff-7e12-8bfc-1ecc564dc89f`.

The preview sandbox is not the deployment. It can have `XAI_API_KEY` while the public app does not. Do not copy that key, or any access token, into git, logs, or chat.

A later check should only read the availability result. Do not send a prompt. The status is one of:

| Status text | Meaning |
| --- | --- |
| Requires `WORKBENCH_ENABLE_GROK=1` and server-side `XAI_API_KEY` | Flag or key still missing. Database is unknown. |
| Access-token message | Flag and key are present. Token is missing or invalid. |
| `DATABASE_URL` / shared store message | Flag, key, and token are present. Postgres is not. |
| No reason, Grok selectable | Paid path is configured. Still does not prove 0002–0004 ran. |

Migrations are confirmed only by the deploy log (`applied 0002`, `0003`, `0004`) or by a read of `_migrations`. Do not call the model to test them.

Publish from this app's Publish sheet. GitHub `main` does not provision Neon. `DATABASE_URL` is injected there. It is not a file in this repo.

## What is already reusable

These do not care which company answers:

- Injector, Dialog, Diagnostics
- The three hashes
- Import, export, and the v1/v2 save format
- Mock
- The rule that a provider or model change starts a new conversation
- The quota hold, reconcile, and expiry

Do not redo them for a new provider.

## What is Grok-shaped

A new provider is an adapter plus a pinned window table. It is not a setting.

Hard edges today:

- `ProviderId` is only `"mock"` or `"grok"` (`src/lib/workbench/types.ts`).
- `isProvider` in `src/lib/workbench/session.ts` rejects anything else on import.
- `TransportRecord` is only `OFFLINE_FIXTURE` or `xai-https` locked to `https://api.x.ai`.
- `src/lib/workbench/grok-adapter.ts` refuses any other host.
- `src/lib/workbench/windows.ts` pins only `grok-4.7`, `grok-4.6`, and `grok-4.5` at 500,000. Verified 2026-10-12 against docs.x.ai. Unknown ids are refused.
- The record hash covers the transport. Do not edit an old `xai-https` record to point it at another vendor.

Stored `assembledMessages` stay in the workbench shape: system, user, assistant. Map that to the vendor's wire format inside the adapter. Do not change the saved transcript to match the wire format.

## Order of work

Do these in order. Stop after each one and keep the old tests green.

### 1. Make room without breaking v1 records

Add the new provider id and a new transport kind.

Existing Mock and Grok records must import with the same hash. A missing new field stays absent. Do not bump `cew-record-v1` unless a saved record would otherwise become a lie.

Changing provider still opens a new conversation. Keep that.

### 2. ChatGPT, if a second paid provider is wanted

Closest port. Chat completions, different host and key.

- Its own key. Never reuse `XAI_API_KEY`.
- Its own small window table, with the docs URL and the date checked. Do not guess a window.
- No xAI tokenize call. If OpenAI has no equivalent count for role-labeled text, store the count as not counted. Do not invent a number.
- Keep both counts when a real counter exists. A later over-budget report is a warning, not a deleted reply.
- No tools. No retry. Do not store the conversation at the provider if that switch exists.
- Usage names differ, including reasoning. Partial usage must not refund the hold. Same rule as Grok.

### 3. Claude, after ChatGPT or instead of it

Different request, not a host swap.

- System text is a top-level field, not just another message. The stored messages still include it.
- Its own key.
- Its own window table, dated.
- Its own token-count call, if the docs still have one. Do not send the text to xAI to count it.
- Usage is input and output. Map it into the existing usage fields. Do not add a second usage object.

### 4. One paid gate for every vendor

`executePaidTurn` should stay the only place that reserves and reconciles.

Same rules for every paid call:

- One hold before the provider.
- Reconcile after a known result.
- Unknown usage keeps the token hold.
- Concurrency expires. Tokens do not.
- No call at all when `DATABASE_URL` is absent. PGLite is not a deployment cap.
- The access token stays page memory. It is not a URL, a save, or a log line.

Vendor keys stay server-only. The browser learns "available" or a reason. It never learns the key.

## Leave these alone unless a task says otherwise

- Pack format and `src/lib/workbench/pack.ts`
- Storage keys and `src/lib/workbench/storage.ts`
- The 131,072 reasoning allowance
- The shared rate key `"deployment"`
- The saved-record acceptance of timeout `0.05`
- Auth, accounts, and per-user rows
- Cleanup of old rate-limit rows

## How to test

From a clean checkout of `main`:

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build
```

Tests use `node --experimental-strip-types --test`. In that mode: no enums, no namespaces, no TypeScript parameter properties. Relative imports use a `.ts` suffix.

Do not skip tests. Do not spend API credits to prove a provider. Script the HTTP response.

A future session should report the start SHA, the end SHA, the test counts, and whether the live status was read. If it was not read, say so.
