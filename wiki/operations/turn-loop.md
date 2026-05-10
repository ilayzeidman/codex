---
title: Operation — the turn loop
kind: operation
status: draft
sources:
  - codex-rs/core/src/codex_thread.rs
  - codex-rs/core/src/session/turn.rs
  - codex-rs/core/src/session/mod.rs
  - codex-rs/core/src/context_manager/history.rs
  - codex-rs/core/src/tools/router.rs
  - codex-rs/core/src/compact.rs
  - codex-rs/core/src/compact_remote.rs
related:
  - concepts/context-management.md
  - concepts/tools.md
  - concepts/skills.md
  - concepts/hooks.md
  - operations/tool-call-lifecycle.md
last_reviewed: 2026-05-10
---

## TL;DR

A **turn** is the unit of work between a user submission and a fully
completed model response (including any tool calls and their outputs).
This page narrates the timeline end-to-end so each piece — context
assembly, hooks, streaming, tool dispatch, persistence — has a
canonical slot in the story.

## Timeline

```
User → CodexThread::submit ──┐
                             ▼
          ┌──────────────────────────────┐
          │ UserPromptSubmit hooks       │  may rewrite/abort
          └──────────────────────────────┘
                             ▼
          ┌──────────────────────────────┐
          │ build_initial_context        │  developer + contextual user
          │   • model instructions       │
          │   • permissions              │
          │   • memory dev instructions  │
          │   • collaboration / realtime │
          │   • personality              │
          │   • apps / MCP instructions  │
          │   • skills catalog           │
          │   • plugins                  │
          │   • environment + AGENTS.md  │
          └──────────────────────────────┘
                             ▼
          ┌──────────────────────────────┐
          │ optional auto-compact        │  PreCompact / PostCompact hooks
          └──────────────────────────────┘
                             ▼
          ┌──────────────────────────────┐
          │ HTTP request to provider     │  codex-client + sse_stream
          └──────────────────────────────┘
                             ▼
          ┌──────────────────────────────┐
          │ stream output items          │
          │   • Reasoning / Message      │
          │   • FunctionCall →           │
          │     ┌───────────────────────┐│
          │     │ tool_call_lifecycle   ││  PreToolUse → handler →
          │     │  (see operation page) ││  PostToolUse
          │     └───────────────────────┘│
          │   • result appended as       │
          │     ResponseInputItem        │
          └──────────────────────────────┘
                             ▼
          ┌──────────────────────────────┐
          │ record_conversation_items    │
          │   • ContextManager.record    │
          │   • RolloutRecorder.add      │
          │   • emit raw items to UI     │
          └──────────────────────────────┘
                             ▼
          ┌──────────────────────────────┐
          │ Stop hooks                   │
          └──────────────────────────────┘
                             ▼
                   TurnComplete event
```

## Step-by-step references

1. **Submission**: `codex-rs/core/src/codex_thread.rs:124` —
   `CodexThread::submit` enqueues a `Submission`. The thread's runtime
   loop wakes and invokes turn processing.

2. **Hooks (UserPromptSubmit)**: `codex-rs/core/src/hook_runtime.rs`.
   Hooks run with the raw prompt; outcomes can rewrite the prompt or
   abort the turn.

3. **Context assembly**: `codex-rs/core/src/session/mod.rs:2567`
   (`build_initial_context`). All sections listed in the diagram are
   produced here and bundled into a `Prompt`. See
   [context management](../concepts/context-management.md) for
   ordering and budget rules. Skill body injection for explicitly
   mentioned skills happens in `codex-rs/core/src/session/turn.rs`.

4. **Compaction (optional)**: when token estimates indicate the
   request would exceed the window, `compact.rs:69` or
   `compact_remote.rs:41` rewrites history first. `PreCompact` /
   `PostCompact` hooks wrap the operation.

5. **Provider call + streaming**: provider chosen via
   `models-manager`; HTTP request issued via
   `codex-rs/codex-client/src/transport.rs`; SSE parsed via
   `codex-client/src/sse.rs:9`. See [streaming](../concepts/streaming.md).

6. **Output item handling**: `codex-rs/core/src/stream_events_utils.rs`
   normalizes streamed deltas. Tool calls hand off to the
   [tool call lifecycle](tool-call-lifecycle.md).

7. **Persistence**: `codex-rs/core/src/session/mod.rs:2415`
   (`record_conversation_items`) — in-memory + rollout + UI events.

8. **Stop hooks**: end-of-turn cleanup / summary hooks fire here.

## Edge cases & invariants

- Compaction can run **mid-turn** when a streamed reasoning step plus
  a pending tool call would push history over the window;
  `InitialContextInjection::BeforeLastUserMessage` keeps the
  replacement consistent.
- Hooks are not allowed to read in-flight rollout entries; they only
  see the request payload they're given.
- A `Stop` outcome from any hook short-circuits the turn before
  persistence.

## See also

- [Tool call lifecycle](tool-call-lifecycle.md) — zoom in on step 6
  for any tool call.
- [Session lifecycle](session-lifecycle.md) — zoom out: how multiple
  turns chain into a session.
- [Context management](../concepts/context-management.md) — what
  step 3 actually does.
