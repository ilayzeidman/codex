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

- Module entry: `codex-rs/rollout/src/lib.rs:21` — `SESSIONS_SUBDIR`
  constant; re-exports of `RolloutConfig`, `RolloutRecorder`,
  `EventPersistenceMode` follow at `:34`–`:58`.
- Async writer: `rollout/src/recorder.rs:82` (`RolloutRecorder`),
  `:106` (`RolloutCmd { AddItems, Persist, Flush, Shutdown }`),
  `:121` (`RolloutWriterTask`).
- Header / metadata: `rollout/src/metadata.rs` — `builder_from_items`,
  `extract_metadata_from_rollout`. The actual `SessionMeta` /
  `SessionMetaLine` types are defined in
  `codex-rs/protocol/src/protocol.rs` and re-exported from `rollout`.
- Index over sessions: `rollout/src/session_index.rs` — sort keys
  (`CreatedAt`, `UpdatedAt`), directions, thread-name → id mapping.
- State DB: `rollout/src/state_db.rs` — `StateDbHandle` is a re-export
  of `codex_state::StateRuntime` (`:26`); `init` at `:42`.
- Trace overlay: `rollout-trace/src/lib.rs`,
  `rollout-trace/src/compaction.rs` — `CompactionTraceContext`.
- Thread types: `codex-rs/thread-store/src/types.rs` —
  `CreateThreadParams`, `ResumeThreadParams`, etc.
- Item type: `codex-rs/protocol/src/protocol.rs` — `RolloutItem`.

## File layout

- Active rollouts: `~/.codex/sessions/YYYY/MM/DD/rollout-YYYY-MM-DDTHH-MM-SS-<uuid>.jsonl`
  (filename built at `recorder.rs:1378`–`:1397`; subdir constants
  `SESSIONS_SUBDIR` / `ARCHIVED_SESSIONS_SUBDIR` at
  `rollout/src/lib.rs:21`–`:22`).
- Archived rollouts: `~/.codex/archived_sessions/`.
- State DB: `~/.codex/state_5.sqlite` (filename constant
  `STATE_DB_FILENAME` at `state/src/lib.rs:64`; resolved by
  `state_db_path` at `state/src/runtime.rs:179`).

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

`EventPersistenceMode` (`rollout/src/policy.rs:6`):

- `Limited` — legacy minimal replay surface. Smaller files, narrower
  replay capability.
- `Extended` — richer event surface needed for app-server history
  reconstruction (see [app-server](app-server.md)).

Command outputs are sanitized: aggregated output truncated to ~10 KB,
raw stdout/stderr cleared (the model-visible formatted output is what
the rollout retains).

## Thread / fork model

`thread-store/src/types.rs` defines the API:

- `CreateThreadParams` (`:45`) — initial cwd, source, persistence mode,
  optional `forked_from_id` (so creation also covers forks).
- `ResumeThreadParams` (`:66`) — pick up an existing rollout.
- `AppendThreadItemsParams` (`:83`) — the per-turn append.
- `LoadThreadHistoryParams` (`:92`) — load items for resume /
  rollback / memory jobs.
- `ReadThreadParams` (`:110`), `ListThreadsParams` (`:152`),
  `ListTurnsParams` (`:222`), `ListItemsParams` (`:271`) — read APIs.

A *thread* is the user-facing handle around a rollout. Forks share a
prefix and diverge at the fork point; the public API exposes them via
`forked_from_id` on `CreateThreadParams` rather than a dedicated
`ForkParams` type. The cross-process fork wire type is
`ThreadForkParams` in `app-server-protocol`.

## State DB

`StateDbHandle` (an alias for `codex_state::StateRuntime`, see
`rollout/src/state_db.rs:26`) is a SQLite-backed handle holding:

- Per-session summaries (id, created_at, updated_at, model, etc.).
- Thread-name → id mapping for friendly listing
  (`rollout/src/session_index.rs`).
- Memory job leasing (claim/release, see
  [context management](context-management.md)).

It exists because file-walking the rollout directory at scale is too
slow for listing UIs and for the memory consolidation worker.

## Rollout trace

`rollout-trace` (`rollout-trace/src/lib.rs`) is a separate overlay
file describing higher-level transformations of a rollout — primarily
**compaction checkpoints** (`rollout-trace/src/compaction.rs:35`,
`CompactionTraceContext`; `:84` `CompactionCheckpointTracePayload`).
The trace lets debugging tools reconstruct which `input_history` was
replaced by which `replacement_history`, and replay backwards to
study compaction quality.

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
