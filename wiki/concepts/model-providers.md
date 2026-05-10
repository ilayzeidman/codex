---
title: Model providers
kind: concept
status: draft
sources:
  - codex-rs/model-provider/src/lib.rs
  - codex-rs/model-provider/src/provider.rs
  - codex-rs/model-provider/src/auth.rs
  - codex-rs/model-provider/src/bearer_auth_provider.rs
  - codex-rs/model-provider/src/models_endpoint.rs
  - codex-rs/model-provider/src/amazon_bedrock
  - codex-rs/model-provider-info
  - codex-rs/models-manager
  - codex-rs/lmstudio/src/lib.rs
  - codex-rs/ollama/src/lib.rs
  - codex-rs/codex-client/src/lib.rs
  - codex-rs/codex-client/src/sse.rs
related:
  - concepts/streaming.md
  - concepts/tools.md
  - concepts/context-management.md
last_reviewed: 2026-05-10
---

## TL;DR

The model layer is split across three crates: `model-provider-info`
(static metadata about each provider/model), `model-provider` (runtime
provider implementations), and `models-manager` (orchestration of
provider instances within a session). Local providers (`lmstudio`,
`ollama`) sit alongside cloud ones (OpenAI, Bedrock, OpenRouter,
Anthropic) behind a common interface. The HTTP client and SSE parser
live in `codex-client`.

## Where it lives in the code

- Public API: `codex-rs/model-provider/src/lib.rs` —
  `ModelProvider`, `ProviderCapabilities`, `create_model_provider`.
- Provider impls: `model-provider/src/provider.rs`.
- Auth abstraction: `model-provider/src/auth.rs`,
  `bearer_auth_provider.rs`.
- Model listing: `model-provider/src/models_endpoint.rs`.
- AWS provider: `model-provider/src/amazon_bedrock/` (see also
  `codex-rs/aws-auth`).
- Static metadata: `codex-rs/model-provider-info/`.
- Orchestration: `codex-rs/models-manager/`.
- Local providers: `codex-rs/lmstudio/src/lib.rs`,
  `codex-rs/ollama/src/lib.rs`.
- HTTP client + retry + telemetry: `codex-rs/codex-client/src/`,
  with SSE parsing at `codex-client/src/sse.rs:9`.

## ProviderCapabilities

Each provider advertises a `ProviderCapabilities` snapshot — supported
modalities (vision), reasoning support, tool-calling shape, and
streaming type. The harness gates UI affordances and context
construction on these bits (e.g. image stripping in `for_prompt`,
see [context management](context-management.md)).

## Auth

`auth.rs` defines an `AuthProvider` trait; `BearerAuthProvider` is the
common implementation that resolves bearer tokens from env vars or the
login store. Per-provider auth (Bedrock SigV4, ChatGPT cookie auth,
device-code flow) is layered on top via dedicated crates.

## Local providers

`lmstudio/src/lib.rs` and `ollama/src/lib.rs` adapt local OpenAI-API-
compatible servers into the same `ModelProvider` interface. This is
the path the harness takes when the user selects a local model — the
rest of the stack (tool dispatch, sandboxing, hooks) is unchanged.

## Streaming

Cloud providers stream responses via Server-Sent Events.
`codex-client/src/sse.rs:9` (`sse_stream`) is the canonical SSE
parser, with idle-timeout and error handling. Streamed deltas become
`ResponseItemDelta` events that the TUI renders incrementally; final
items go through `record_conversation_items` (see
[context management](context-management.md)).

## Model selection

`models-manager` is the orchestrator: it knows which provider serves
which model, handles fallbacks, and resolves the user's selection
(slash command `/model`, config key, env override) to a concrete
`ModelProvider` + model id pair.

## Edge cases & invariants

- The provider is queried for `context_window` per model — the
  `TurnContext.model_info.context_window` flows from provider info to
  the [context management](context-management.md) layer.
- Image-bearing items are kept in history but stripped at request time
  if the active model lacks the `Image` modality.
- Local providers may not support streaming reasoning summaries; the
  harness falls back to non-reasoning prompts when not supported.

## Open questions / gaps

- The exact `ProviderCapabilities` field set; this page should be
  fleshed out after a closer read of `provider.rs`.
- Retry / fallback behavior between providers when one fails mid-turn.

## See also

- [Streaming](streaming.md) — the SSE-and-frame side of the same
  pipeline.
- [Tools](tools.md) — tool spec serialization is provider-aware
  (Responses API vs others).
- [Login](#) (TODO) — how device-code login feeds the auth providers.
