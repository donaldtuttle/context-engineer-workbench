# Context Engineer Workbench: User Guide

[Open the workbench](https://context-engineer-workbench.grok.me) |
[View source on GitHub](https://github.com/donaldtuttle/context-engineer-workbench)

## What does this app do?

Context Engineer Workbench lets you give AI background information, ask questions about it, and inspect a record of each exchange.

Your **context** is the information you supply: project notes, specifications, writing instructions, research procedures, or other reference text.

Your **prompt** is the question or task you send next.

The workbench includes your context with each request. You do not need to paste it into every message. It also records the submitted messages, settings, response, and available usage information.

This gives you a way to review what the AI was given, not a guarantee that its answer is correct.

## Find your way around

| Panel | What you do there |
| --- | --- |
| **Injector: Add context** | Enter background information, choose Mock, Grok, or ChatGPT, and manage saved conversations. |
| **Dialog: Ask questions** | Send a question and read the response. |
| **Diagnostics: Inspect records** | Review what was prepared for a particular exchange, its outcome, and available token counts. |

On a wide screen, the panels appear together. On a smaller screen, use the tabs.

A **turn** is one submitted question and its recorded outcome, including an error or incomplete reply.

## Try your first conversation

### 1. Add a brief

Open **Injector**. Give the context an optional name, such as **Studio lamp brief**, and paste this fictional example into **Context**:

```text
Project: Studio lamp
Height: 420 mm
Shade: matte blue
Base: brushed aluminum
Cable length: 1.8 m

Use only the specifications above when describing this product.
Keep measurements and units unchanged.
If a specification is missing, say it was not provided.
```

### 2. Choose a mode

Leave **System slot** selected for this example.

Choose **Grok** for an AI response when this deployment supports it. Select a supported model from the model suggestions and enter the app access token supplied by the deployment owner.

Choose **ChatGPT** the same way when this deployment has its own ChatGPT key. That key is not the Grok key, and it is not typed into the page.

The access token is not an xAI or OpenAI API key.

Choose **Mock** to explore the workflow without a model call. Mock returns a technical receipt showing request information. It does not answer questions about your brief.

Leave **Request settings** at their defaults for the walkthrough. The page reporting Grok availability does not select it for you.

### 3. Ask a question

Open **Dialog** and send:

```text
What are the studio lamp's height, cable length, and weight?
```

With Grok, check whether the answer preserves **420 mm** and **1.8 m** and says that the weight was not provided.

These are checks for you to make. The app does not automatically grade this answer.

Then try:

```text
Turn the known specifications into a two-sentence product description.
```

Each request includes the context once, the conversation's completed successful exchanges, and your new prompt.

Failed and incomplete turns stay in the record but are not included in later requests.

On a keyboard, **Enter** sends. **Shift+Enter** adds a line.

### 4. Inspect what happened

Open **Diagnostics**. Select **Latest** or an earlier numbered turn.

Start with **Status**. A successful status means the request completed, not that the answer passed a fact check.

Expand **Recorded request details** to inspect the saved context, message list, and settings for that turn.

A blocked or failed turn can still have a prepared request record. Its presence alone does not prove that a model processed it.

Earlier turn records retain the context and settings used at the time. Editing the current draft does not rewrite them.

### 5. Export a copy

Choose **Export this turn** in Diagnostics to save the selected exchange.

Choose **Export context** beside Context to save only the current context.

Choose **Export all conversations** to save all conversations currently held by the app in this browser, not just the selected conversation.

Exports include your text. Review them before sharing.

## Compare an answer with and without context

**Start without context** starts a separate conversation with empty context and no previous messages. It does not delete your earlier conversations.

For a simple comparison, compare the first question in the walkthrough with the same question sent as the first message in that new conversation.

Keep the provider, model, delivery choice, and request settings the same.

Use **Saved conversations** to move between the two records. Look for correct details, invented details, and acknowledgement of missing information.

Starting without context removes the background and conversation history supplied by this app. It does not remove the model's existing knowledge.

One comparison is an example, not proof of a consistent improvement.

## What happens when I change something?

The Injector is a draft for your next request.

Changing the **context text**, **delivery choice**, **provider**, or **model** starts a new conversation on the next Send when that value differs from the active conversation.

The previous conversation remains available.

Changing only the name does not restart the conversation.

Adjusting request settings affects the next request without, by itself, starting a new conversation.

**Clear context** empties the draft context text. It does not delete saved conversations or clear the name.

Use **Start without context** for an explicit fresh conversation without context.

## System slot or User paste?

**System slot** places your context in a system message before the conversation. This walkthrough uses it for the task instructions you wrote.

**User paste** places your context in an initial user message before the conversation history.

Both include the context once per request. They change its role in the request, not the underlying model.

Neither guarantees that every instruction will be followed.

## Understanding the numbers

**Bytes** measure text size.

**Tokens** are the smaller text pieces a model processes.

They are different measurements.

| Readout | Plain-language meaning |
| --- | --- |
| **Injection tokens** | The count for your context alone. |
| **Counted input tokens** | The count taken before the response request for the assembled input, including context and conversation history. |
| **Provider input / output / total** | Usage information returned by the provider, when available. |
| **Input budget** | The configured space available for the input after allowing for the requested output limit. |
| **Max output tokens** | The app's requested limit for the visible reply. It is not the model's entire context capacity. |
| **Quota reserved / settled tokens** | The deployment's allowance accounting, not a bill or a dollar amount. |

The context count is already included in the full input count. **Do not add it again.**

The count before a request and the provider's reported usage can measure different things. They are not interchangeable.

**Not counted**, **not reported**, and similar labels mean unavailable, not zero.

The input-budget bar shows how much of the configured input allowance is used.

It is not an accuracy score, confidence score, or measure of how carefully the AI read your context.

## Understanding fingerprints

A **hash**, or fingerprint, identifies particular saved content.

**Context SHA-256** identifies the context text.

**Prompt SHA-256** identifies the assembled message list.

**Record SHA-256** identifies the finalized turn record.

A matching record fingerprint means the saved record is consistent with its stored fingerprint.

It does not prove who produced the answer, that the provider processed every part of the request, or that the answer follows your instructions.

A record fingerprint can remain **Pending** until the outcome is finalized.

## Import, storage, and privacy

**Import** accepts plain text, context JSON containing `name` and `text`, and supported workbench turn or session exports.

Supported imported records are checked before being accepted.

Pasting a website or GitHub link does not load the linked content. Paste the relevant text or import a text file.

This version does not extract ZIP archives or provide a document-reading workflow for PDFs and images.

Conversations are saved in this browser. They do not automatically appear on another device.

Export important work before clearing site data or moving to another browser.

Mock makes no model-provider call.

Grok sends the assembled messages through the app's server to xAI. Local conversation storage does not make Grok requests local or offline.

The access token stays in page memory and must be entered again after a reload. It is not saved in conversation exports.

Never paste an API key into Context or Dialog.

The adapter requests provider storage off, but this is not a guarantee about every form of provider retention.

Deleting a local conversation does not delete exported files or establish deletion at the provider.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| A JSON receipt instead of an answer | Mock is selected. Choose Grok for an AI response when access is available. |
| Grok is unavailable or access is denied | Read the reason. Check the app access token or contact the deployment owner. Mock can still demonstrate the record workflow. |
| The request is too large | Read Diagnostics. Reduce the background text or begin a fresh conversation to avoid accumulated history. The app does not silently shorten the input. |
| A reply ends early or shows `length` | Increase Max output tokens within the allowed range and send the question again. The partial turn remains recorded but is not replayed. |
| A finished reply has a budget warning | Read both counts in Diagnostics. The response and original measurements are retained. |
| A timeout, failure, or allowance limit | Read the specific reason. A retry is a new request. Grok failures do not automatically switch to Mock. |
| A storage warning | Export all conversations on screen before closing. For unreadable saved data, also export the original saved data before confirming a reset. |
| A matching hash beside a wrong answer | Review the answer against your source text. Hash checking is not fact checking. |

On devices that cannot download directly, use the available Share or Copy option to preserve the complete export text.

## Source code and setup

[View the project on GitHub](https://github.com/donaldtuttle/context-engineer-workbench) for source code, technical documentation, and deployment instructions.
