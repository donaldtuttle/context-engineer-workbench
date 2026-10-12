/* Copyright (c) 2026 Donald Tuttle. All rights reserved.
   Proprietary. No license is granted to copy, modify, or distribute.
   Fixed record used to lock cew-record-v1 serialization. */

import type { TurnRecord } from "./types.ts";

export const VECTOR_RECORD: TurnRecord = {
  id: "turn-vector-1",
  schemaVersion: "cew-record-v1",
  createdAt: "2026-01-01T00:00:00.000Z",
  finalizedAt: "2026-01-01T00:00:01.000Z",
  executionStatus: "success",
  requestedModel: "fixture-echo-v2",
  returnedModel: "fixture-echo-v2",
  responseStatus: "completed",
  settings: {
    provider: "mock",
    model: "grok-4.5",
    deliveryMode: "SYSTEM_SLOT",
    timeoutSeconds: 30,
    maxOutputTokens: 512,
    temperature: null,
    topP: null,
    seed: null,
  },
  contextName: "vector",
  frozenContextText: "ctx",
  contextSha256: "0230c6b1d833c51cc426492022677b74c60d82891931221a42db9e7bb06205e9",
  promptSha256: "6217260849970e705f9941eb50b16e392958fa686c0faca51c073081a22672f1",
  recordSha256: "ignored-by-the-hash",
  assembledMessages: [{ role: "user", content: "ping" }],
  userPrompt: "ping",
  responseText: "ok",
  error: null,
  preflight: {
    contextChars: 3,
    contextUtf8Bytes: 3,
    messageCount: 1,
    promptUtf8Bytes: 34,
    countedInputTokens: null,
    measurementScope: "messages-json-v1 utf-8 bytes; model tokens not counted",
    countSource: "not_counted",
  },
  providerUsage: null,
  providerResponseId: null,
  reasoningEncryptedOmitted: false,
  contextBudget: {
    model: "fixture-echo-v2",
    contextFloor: null,
    modelContextWindow: null,
    contextFloorSource: "not_applicable",
    budget: null,
    countedInputTokens: null,
    countSource: "not_counted",
    blockedReason: null,
  },
  transport: { kind: "OFFLINE_FIXTURE", network: "blocked" },
};

export const VECTOR_SERIAL =
  '{"assembledMessages":[{"content":"ping","role":"user"}],"contextBudget":{"blockedReason":null,"budget":null,"contextFloor":null,"contextFloorSource":"not_applicable","countSource":"not_counted","countedInputTokens":null,"model":"fixture-echo-v2","modelContextWindow":null},"contextName":"vector","contextSha256":"0230c6b1d833c51cc426492022677b74c60d82891931221a42db9e7bb06205e9","createdAt":"2026-01-01T00:00:00.000Z","error":null,"executionStatus":"success","finalizedAt":"2026-01-01T00:00:01.000Z","frozenContextText":"ctx","id":"turn-vector-1","preflight":{"contextChars":3,"contextUtf8Bytes":3,"countSource":"not_counted","countedInputTokens":null,"measurementScope":"messages-json-v1 utf-8 bytes; model tokens not counted","messageCount":1,"promptUtf8Bytes":34},"promptSha256":"6217260849970e705f9941eb50b16e392958fa686c0faca51c073081a22672f1","providerResponseId":null,"providerUsage":null,"reasoningEncryptedOmitted":false,"requestedModel":"fixture-echo-v2","responseStatus":"completed","responseText":"ok","returnedModel":"fixture-echo-v2","schemaVersion":"cew-record-v1","settings":{"deliveryMode":"SYSTEM_SLOT","maxOutputTokens":512,"model":"grok-4.5","provider":"mock","seed":null,"temperature":null,"timeoutSeconds":30,"topP":null},"transport":{"kind":"OFFLINE_FIXTURE","network":"blocked"},"userPrompt":"ping"}';

export const VECTOR_HASH = "3ed0bbad5372d4ea92fb31cc719c4609a96f6c4e6864ee8eb8e6099891dc6522";
