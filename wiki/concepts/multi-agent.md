---
title: Multi-agent
kind: concept
status: draft
sources:
  - codex-rs/agent-identity/src/lib.rs
  - codex-rs/agent-identity/src/types.rs
  - codex-rs/agent-identity/src/store.rs
  - codex-rs/agent-graph-store/src/lib.rs
  - codex-rs/external-agent-sessions/src/lib.rs
  - codex-rs/external-agent-sessions/src/detect.rs
  - codex-rs/external-agent-sessions/src/export.rs
  - codex-rs/external-agent-sessions/src/ledger.rs
  - codex-rs/external-agent-migration
  - codex-rs/core/src/tools/handlers/multi_agents.rs
related:
  - concepts/sessions-rollouts.md
  - concepts/tools.md
last_reviewed: 2026-05-10
---

## TL;DR

Codex supports running multiple cooperating agents. Three crates
collaborate:

- **`agent-identity`** issues stable identities (with JWT-style claims)
  for each agent.
- **`agent-graph-store`** records the parent/child topology of spawned
  agents and the status of spawn edges.
- **`external-agent-sessions`** + **`external-agent-migration`** import
  rollouts from non-Codex agents (e.g. Claude Desktop) so they can be
  resumed inside Codex.

At the tool surface, the `spawn_agent` / `wait_agent` / `close_agent`
handlers (`core/src/tools/handlers/multi_agents.rs`) are how a parent
agent creates and synchronizes children.

## Where it lives in the code

- Identity types: `codex-rs/agent-identity/src/types.rs` —
  `AgentIdentityKey`, `AgentIdentityJwtClaims`.
- Identity store: `codex-rs/agent-identity/src/store.rs`,
  `local.rs`.
- Graph store: `codex-rs/agent-graph-store/src/lib.rs` —
  `AgentGraphStore`, `ThreadSpawnEdgeStatus`.
- External agent migration:
  `codex-rs/external-agent-sessions/src/lib.rs:21` —
  `ExternalAgentSessionMigration`, `ImportedExternalAgentSession`.
- Detection / ledger / export:
  `external-agent-sessions/src/detect.rs`, `ledger.rs`, `export.rs`.
- Tool handlers: `codex-rs/core/src/tools/handlers/multi_agents.rs` —
  `spawn_agent`, `wait_agent`, `close_agent`.

## Identity

`AgentIdentityKey` is the durable identifier for an agent across
sessions. JWT-style `AgentIdentityJwtClaims` allow capabilities to be
attested across processes — useful when a child agent runs in a
different process or VM but must prove its provenance to a parent.

## Graph

`AgentGraphStore` keeps the parent → child topology. Each spawn is an
edge with a `ThreadSpawnEdgeStatus` (e.g. spawned, waiting, completed,
errored). The graph supports queries like "all descendants of this
thread" used by the TUI to render trees of running agents.

## External agent migration

Codex can ingest sessions from other agent runtimes (notably Claude
Desktop) and store them as Codex rollouts. The pipeline:

1. **Detect** (`detect.rs`) — find candidate exports on disk.
2. **Export** (`export.rs`) — extract a session into Codex's
   `RolloutItem` schema.
3. **Ledger** (`ledger.rs`) — record imported sessions so they're not
   re-imported, and so the user can see provenance.

`ImportedExternalAgentSession` is the resulting record.

## Tool surface

`multi_agents.rs` exposes:

- `spawn_agent` — start a child agent with given parameters.
- `wait_agent` — wait for child completion (or yield until ready).
- `close_agent` — clean shutdown.

These tools go through the same registry / approval / sandbox pipeline
as any other tool (see [tools](tools.md)).

## Edge cases & invariants

- A child agent gets its own session and rollout file; the parent
  retains a reference via the graph store.
- Imported external sessions are read-only by default; resuming them
  promotes them to a normal Codex session at the next turn.
- Identity claims are advisory in single-process runs — the local
  store is the source of truth — but become load-bearing for
  cross-process / cloud agent execution.

## Open questions / gaps

- The exact runtime for spawned children (separate process? thread?).
- How `agent-graph-store` integrates with the rollout state DB.
- How approvals propagate from parent to child agents.

## See also

- [Tools](tools.md) — `spawn_agent` etc. are registered handlers.
- [Sessions & rollouts](sessions-rollouts.md) — every agent is a
  session.
