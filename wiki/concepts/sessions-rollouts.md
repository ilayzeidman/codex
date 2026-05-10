---
title: Sessions & rollouts
kind: concept
status: stable
sources:
  - codex-rs/rollout/src/lib.rs
  - codex-rs/rollout/src/recorder.rs
  - codex-rs/rollout/src/metadata.rs
  - codex-rs/rollout/src/session_index.rs
  - codex-rs/rollout/src/state_db.rs
  - codex-rs/rollout-trace/src/lib.rs
  - codex-rs/rollout-trace/src/compaction.rs
  - codex-rs/thread-store/src/types.rs
  - codex-rs/thread-manager-sample
  - codex-rs/protocol/src/protocol.rs
related:
  - concepts/context-management.md
  - concepts/multi-agent.md
  - operations/session-lifecycle.md
last_reviewed: 2026-05-10
---

## TL;DR

A **session** is a single conversation; its on-disk representation is
a **rollout** — a JSONL append-only log of `RolloutItem`s plus a
header line of metadata. The same rollout supports interactive replay
(resume), forking (branch a session at a given point), and audit
export. A separate state DB (`rollout/src/state_db.rs`) indexes
sessions for listing and memory job leasing.

## Where it lives in the code

- Module entry: `codex-rs/rollout/src/lib.rs:21` — `RolloutConfig`,
  `RolloutRecorder`, `EventPersistenceMode`.
- Async writer: `rollout/src/recorder.rs:72` — `RolloutWriterTask`,
  `RolloutCmd { AddItems, Persist, Flush, Shutdown }`.
- Header / metadata: `rollout/src/metadata.rs` — `SessionMetaLine`,
  `SessionMeta`.
- Index over sessions: `rollout/src/session_index.rs` — sort keys
  (`CreatedAt`, `UpdatedAt`), directions, thread-name → id mapping.
- State DB: `rollout/src/state_db.rs` — `StateDbHandle` (SQLite-backed).
- Trace overlay: `rollout-trace/src/lib.rs`,
  `rollout-trace/src/compaction.rs:30` — `CompactionTraceContext`.
- Thread types: `codex-rs/thread-store/src/types.rs:30` —
  `ThreadEventPersistenceMode`, `CreateThreadParams`, etc.
- Item type: `codex-rs/protocol/src/protocol.rs` — `RolloutItem`.

## File layout

- Active rollouts: `~/.codex/sessions/rollout-YYYY-MM-DDTHH-MM-SS-<uuid>.jsonl`.
- Archived rollouts: `~/.codex/archived_sessions/`.
- State DB: `~/.codex/sessions.sqlite` (or similar — see
  `state_db.rs`).

Each rollout file is JSON-Lines. Line one is the metadata header
(`SessionMetaLine`); each subsequent line is one `RolloutItem`.

`RolloutItem` is a tagged union of:

- `EventMsg` — runtime events (turn started, tool call, errors).
- `SubmissionItem` — user submissions.
- `ResponseItem` — model output and tool results.

This union is precisely what `record_conversation_items` writes for
every turn (see [context management](context-management.md)).

## Recorder lifecycle

`RolloutRecorder::new` opens the file, writes the metadata header, and
spawns `RolloutWriterTask`. Producers call:

```rust
recorder.add_items(items).await?;
recorder.flush().await?;
recorder.shutdown().await?;
```

Internally these become `RolloutCmd`s flowing through a tokio channel
to the writer task. Failure state is preserved on the writer
(`RolloutWriterTask` holds terminal-failure state) so subsequent calls
surface the error rather than silently dropping.

## Event persistence modes

`EventPersistenceMode` (`recorder.rs:196`):

- `Limited` — legacy minimal replay surface. Smaller files, narrower
  replay capability.
- `Extended` — richer event surface needed for app-server history
  reconstruction (see [app-server](app-server.md)).

Command outputs are sanitized: aggregated output truncated to ~10 KB,
raw stdout/stderr cleared (the model-visible formatted output is what
the rollout retains).

## Thread / fork model

`thread-store/src/types.rs:30` defines the API:

- `CreateThreadParams` — initial cwd, model provider, memory mode.
- `ResumeThreadParams { thread_id }` — pick up an existing rollout.
- `ForkParams { forked_from_id, fork_point }` — branch from a known
  point.
- `AppendThreadItemsParams` — the per-turn append.
- `LoadThreadHistoryParams` — load items for resume / rollback /
  memory jobs.

A *thread* is the user-facing handle around a rollout. Forks share a
prefix and diverge at the fork point.

## State DB

`StateDbHandle` (SQLite) holds:

- Per-session summaries (id, created_at, updated_at, model, etc.).
- Thread-name → id mapping for friendly listing.
- Memory job leasing (claim/release, see
  [context management](context-management.md)).
- Plugin / marketplace bookkeeping it shares with `core-plugins`.

It exists because file-walking the rollout directory at scale is too
slow for listing UIs and for the memory consolidation worker.

## Rollout trace

`rollout-trace` (`rollout-trace/src/lib.rs`) is a separate overlay
file describing higher-level transformations of a rollout — primarily
**compaction checkpoints** (`rollout-trace/src/compaction.rs:30`,
`CompactionTraceContext`). The trace lets debugging tools reconstruct
which `input_history` was replaced by which `replacement_history`,
and replay backwards to study compaction quality.

## Edge cases & invariants

- The first line of a rollout is *always* the `SessionMetaLine`; tools
  consuming rollouts may rely on this.
- Rollout entries are append-only — compaction does not rewrite the
  file. Instead the in-memory `ContextManager` is rewritten and a
  trace checkpoint records the diff in the rollout-trace overlay.
- `Limited` mode is sufficient for resume of basic conversations but
  app-server clients must use `Extended` for full UI fidelity.
- A failed write is sticky; the writer task records the failure and
  refuses further appends until the recorder is recreated.

## See also

- [Context management](context-management.md) — what gets recorded.
- [Multi-agent](multi-agent.md) — agent-graph entries and external
  agent migration both surface in / interact with the state DB.
- [Session lifecycle](../operations/session-lifecycle.md) — start /
  resume / fork in detail.
