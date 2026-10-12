# User guide

[Open Context Engineer Workbench](https://context-engineer-workbench.grok.me) · [Back to the README](../README.md)

Context Engineer Workbench helps you give an AI the background for a task, ask follow-up questions, and inspect a saved record of what was submitted and returned.

## Find your way around

On a wide screen, the app has three panels. On a phone or smaller screen, switch between the tabs at the top.

| Panel | What you do there |
| --- | --- |
| **Injector** | Paste your background, select a provider, adjust settings, and manage saved conversations. |
| **Dialog** | Ask questions and read responses. |
| **Diagnostics** | Inspect the selected turn’s frozen context, request settings, counts, hashes, and result. |

“Injector” means the place where you supply background text. You do not need to write code or use a special format.

## Your first conversation

### 1. Add some background

In **Injector**, enter an optional **Name**, such as “Studio lamp brief,” and paste this into **Context**:

```text
Project: Studio lamp
The shade is matte blue.
The base is brushed aluminum.
The lamp is 420 mm tall.
The power cable is 1.8 m long.
The product description is for a general audience.
Keep measurements and units exactly as supplied.
If a specification is missing, say it was not provided.
```

The SHA-256 value below the box is a fingerprint of the text. It changes when the text changes. You can ignore the full value during ordinary use.

### 2. Choose how to run it

Leave **System slot** selected for this walkthrough.

Select **Grok** if the app says the Grok adapter is available on the server. The provider must be selected explicitly; availability does not switch it for you. Use a supported ID from the **Grok model ID** suggestions.

Select **Mock** to try the workflow without an AI call. Mock produces a JSON receipt containing request information. It does not interpret the lamp brief or answer your question.

### 3. Ask a question

Open **Dialog**, paste this into **Prompt**, and press **Send**:

```text
Write a short product description using this brief.
Include the height and cable length. Do not invent specifications.
```

With Grok, read the answer and check its details against your brief. Then try a follow-up:

```text
What is the lamp's weight?
```

The brief does not provide a weight. This gives you a simple way to inspect whether the answer acknowledges missing information.

Each request includes the context once, followed by the conversation’s completed successful exchanges and your latest question. You do not need to paste the brief again.

On a keyboard, **Enter** sends and **Shift+Enter** inserts a new line.

### 4. Inspect the record

Open **Diagnostics**. It shows the latest turn unless you select an earlier numbered turn.

Expand **Raw request** to see the frozen context, assembled messages, settings, and budget information. Editing the Injector afterward does not change the earlier turn’s snapshot.

The record hash remains **Pending** while the outcome is unfinished. Once finalized, the record can be checked against its stored hash.

### 5. Save your work

Use **Export turn** for the selected turn, or return to **Injector** and choose **Export session** for a bundle of all saved conversations.

These exports contain your context and conversation text. Keep them wherever you want your project records stored.

## Compare with no background

**Baseline** opens a fresh conversation with empty context and no inherited messages. It preserves your earlier conversations.

To try a comparison:

1. Ask a question with your context present.
2. Note the provider, model, and request settings.
3. Select **Baseline** and ask the same question with those settings.
4. Reopen either conversation under **Saved conversations** to inspect its records.

This lets you explore how the responses differ. A single comparison does not establish that one setup consistently performs better; model responses can vary.

## Editing context and switching conversations

The Injector is an editable draft. If its context text, delivery mode, provider, or model differs from the active conversation, the **next Send** starts a new conversation. Earlier records remain saved. Changing only the name does not reset history.

Use **Saved conversations** to reopen a previous conversation. Failed, blocked, incomplete, timed-out, and interrupted turns remain visible, but are excluded from the history sent with later requests.

The delivery choices are:

- **System slot:** puts the context in a system message before the conversation.
- **User paste:** puts the context in an initial user message before the conversation.

These options change how the model receives the background. Neither guarantees compliance.

## Reading Diagnostics

| Readout | Meaning |
| --- | --- |
| **Status** | Whether the turn succeeded, is pending, was blocked, or ended with another outcome. |
| **Context SHA-256** | Fingerprint of the submitted context text. |
| **Prompt SHA-256** | Fingerprint of the assembled message list. |
| **Record SHA-256** | Fingerprint of the finalized turn record. |
| **Context / Prompt bytes** | Text size in bytes, not tokens. |
| **Injection tokens** | The count for the context text alone, when available. |
| **Counted input tokens** | The preflight count of the assembled request, including context and history. |
| **Provider input / output / total** | Usage returned by the provider, when available. |
| **Input budget** | The configured capacity left for input after reserving the maximum output allowance. |
| **Requested / Returned model** | The model requested by the app and the identity returned by the provider. |

Tokens are pieces of text, not necessarily whole words. Injection tokens are already included in the whole-request count; do not add them again.

Preflight counts and provider usage have different measurement scopes. The preflight count does not establish exact chat-template overhead. Read the measurement note below the counts. “Not counted” or “not reported” means the value is unavailable, not zero.

The budget bar shows counted input against the input budget. It is not a score for answer quality, accuracy, or instruction following.

## Import, export, and deletion

- **Import** accepts plain text, a context JSON file containing `name` and `text`, or supported workbench turn/session JSON exports.
- **Export** beside the Context box saves just the current named context as JSON.
- **Export turn** saves the selected turn and its diagnostics.
- **Export session** saves all conversations currently stored by the app in this browser.
- **Delete**, then **Confirm delete**, removes the selected saved conversation from this browser.

Import checks supported record formats and hashes. If a record is rejected, read the named field or hash error and keep the original export for investigation.

On devices where a direct download is unavailable, the app may offer a share sheet or an export text screen. Use **Share** to save a file, or **Copy** to preserve the complete JSON text.

A GitHub URL pasted into Context is only text; this version does not fetch repository contents. ZIP extraction is also not implemented. Paste the relevant text or import a text file instead.

## Storage and data flow

Conversations are saved in the current browser’s local storage. They do not automatically follow you to another browser or device. Clearing site data can remove them; export copies you want to keep.

Mock execution makes no model-provider call. Loading the hosted website can still use the network.

For Grok, the app sends the assembled context, successful conversation history, and latest prompt through its server to xAI. The API credential stays on the server. The adapter requests storage off, but that flag is not a guarantee about all provider-side retention. Deleting a local conversation does not delete already exported files or establish deletion at the provider.

## If something does not work

**Grok is unavailable:** The server needs Grok enabled and an API key configured. Visitors do not enter the key in the Context box. You can explicitly select Mock to try the record workflow.

**The response is a JSON receipt:** Mock is selected. Switch to Grok for an AI answer when available.

**The request is blocked:** Read the reason in Dialog and the budget information in Diagnostics. Reduce the context, start a fresh conversation to remove accumulated history, or reduce the output allowance where appropriate. The app does not silently truncate the request.

**The response is incomplete or has status `length`:** The output limit was reached. Open **Request settings** in Injector, increase **Max output tokens** within the supported range, and submit the question again. The partial response stays recorded and is not included in subsequent history.

**A request fails or times out:** Inspect the error. Grok failures do not silently become Mock responses. If you retry, it is a new request.

**A hash matches but the answer is wrong:** A matching hash confirms record consistency. It does not check the answer against the context.

## Running your own copy

See [Run](../README.md#run) and [Two environment variables](../README.md#two-environment-variables) in the README for setup and server-side Grok configuration.
