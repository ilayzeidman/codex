---
title: Streaming
kind: concept
status: draft
sources:
  - codex-rs/codex-client/src/sse.rs
  - codex-rs/codex-client/src/lib.rs
  - codex-rs/codex-client/src/transport.rs
  - codex-rs/codex-client/src/retry.rs
  - codex-rs/core/src/stream_events_utils.rs
related:
  - concepts/model-providers.md
  - concepts/context-management.md
last_reviewed: 2026-05-10
---

## TL;DR

Cloud model providers stream responses over Server-Sent Events.
`codex-client` owns the HTTP layer (with retry, custom CAs, and
telemetry); `sse_stream` (`codex-client/src/sse.rs:9`) parses raw
streams into UTF-8 frames; `core/src/stream_events_utils.rs` consumes
output items and produces incremental UI events.

## Where it lives in the code

- HTTP transport: `codex-rs/codex-client/src/transport.rs`,
  `default_client.rs`, `request.rs`.
- Custom CAs / TLS: `codex-rs/codex-client/src/custom_ca.rs`.
- Retry: `codex-rs/codex-client/src/retry.rs`.
- SSE parser: `codex-rs/codex-client/src/sse.rs:9` — `sse_stream`
  with idle-timeout and error handling.
- Telemetry: `codex-rs/codex-client/src/telemetry.rs`.
- Output-item consumer: `codex-rs/core/src/stream_events_utils.rs` —
  `handle_output_item_done`, `last_assistant_message_from_item`.

## Pipeline

```
HTTPS request ──► reqwest body ──► sse_stream ──► frame::Data
                                                      │
              ┌───────────────────────────────────────┘
              ▼
   handle_output_item_done(item)
              │
   ┌──────────┼──────────┐
   ▼          ▼          ▼
 history    rollout    UI events
 (ContextMgr) (recorder) (TUI delta render)
```

A streamed delta produces a UI event immediately; the *finalized*
output item also goes through `record_conversation_items` (see
[context management](context-management.md)) and
`recorder.add_items` (see [sessions & rollouts](sessions-rollouts.md)).

## Edge cases & invariants

- `sse_stream` enforces an idle timeout — connections that go silent
  too long are killed and the call retried under `retry.rs`.
- Mid-frame UTF-8 boundaries are preserved by buffering until a
  complete frame is parseable.
- Provider-specific quirks (anthropic event names, OpenRouter
  pseudo-events) are normalized before reaching `stream_events_utils`.

## Open questions / gaps

- Per-provider streaming variants — each provider crate adds its own
  parser; how they normalize before `handle_output_item_done`.
- Backpressure between the HTTP frame producer and the consumer in
  long-running tool turns.

## See also

- [Model providers](model-providers.md) — the layer above this one.
- [Context management](context-management.md) — where finalized
  items end up.
