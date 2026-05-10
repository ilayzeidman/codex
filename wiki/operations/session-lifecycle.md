---
title: Operation — session lifecycle
kind: operation
status: draft
sources:
  - codex-rs/core/src/codex_thread.rs
  - codex-rs/core/src/session/mod.rs
  - codex-rs/core/src/session/session.rs
  - codex-rs/rollout/src/recorder.rs
  - codex-rs/thread-store/src/types.rs
related:
  - concepts/sessions-rollouts.md
  - concepts/context-management.md
  - operations/turn-loop.md
last_reviewed: 2026-05-10
---

## TL;DR

A session spans from creation (or resume / fork) through any number of
turns to shutdown (or archival). This page narrates the surrounding
machinery — bootstrap, state handles, persistence, teardown.

## Lifecycle stages

### 1. Creation

`thread-store/src/types.rs:30` (`CreateThreadParams`) carries:

- `cwd` — working directory.
- `model_provider` — which provider/model to use.
- `memory_mode` — opt-in for the memory pipeline.

The session bootstraps:

- `RolloutRecorder::new` opens a new `~/.codex/sessions/rollout-…jsonl`
  and writes the metadata header (see
  [sessions & rollouts](../concepts/sessions-rollouts.md)).
- `PluginsManager` loads enabled plugins.
- `SkillsManager.skills_for_config` discovers skills (see
  [skills](../concepts/skills.md)).
- `McpConnectionManager::new` connects MCP servers.
- The state DB records the session row.
- `SessionStart` hooks fire (see [hooks](../concepts/hooks.md)) and may
  inject bootstrapping context.

### 2. Per-turn (the turn loop)

See [turn loop](turn-loop.md).

### 3. Resume

`ResumeThreadParams { thread_id }` reopens an existing rollout. Steps:

- Read the rollout into `ContextManager` via `LoadThreadHistoryParams`.
- Append-mode reopens the JSONL file (recorder picks up after the
  last persisted line).
- MCP servers and plugins re-initialize as on creation.
- `SessionStart` hooks run again (with a `SessionStartSource` distinguishing
  resume from fresh start; see `hooks/src/events/session_start.rs`).

### 4. Fork

A fork branches a new session from a known rollout point:

- `ForkParams { forked_from_id, fork_point }` (in
  `thread-store/src/types.rs`).
- The new session copies the prefix up to `fork_point`, then opens a
  fresh rollout.
- The graph store records the parent edge (see
  [multi-agent](../concepts/multi-agent.md)).

### 5. Shutdown

- `RolloutRecorder::shutdown` flushes pending writes.
- `McpConnectionManager::shutdown` (`codex-mcp/src/connection_manager.rs:102`)
  drains clients and terminates stdio subprocesses.
- `Stop` hooks fire (see [hooks](../concepts/hooks.md)).
- The state DB updates `updated_at`.

## State references

- `Session` — `codex-rs/core/src/session/session.rs:11` — runtime
  context (config, providers, hooks, sandbox, history).
- `SessionConfiguration` — `session/session.rs:64` — approval policy,
  permission profile, model, memory mode, etc.
- `TurnContext` — `session/turn_context.rs:54` — per-turn parameters
  derived from `Session`.

## Edge cases & invariants

- A session cannot resume across a major rollout schema change without
  migration (`external-agent-migration` covers cross-runtime imports;
  see [multi-agent](../concepts/multi-agent.md)).
- `RolloutRecorder` is sticky on failure — once the writer task hits
  a terminal error, further `add_items` calls fail until the recorder
  is recreated.
- Forks share the rollout *prefix* logically but have an independent
  file on disk; the prefix is materialized at load time, not by
  copying file bytes.

## See also

- [Turn loop](turn-loop.md) — per-turn pipeline.
- [Sessions & rollouts](../concepts/sessions-rollouts.md) — file layout.
- [Multi-agent](../concepts/multi-agent.md) — parent/child sessions.
