---
title: App-server protocol
kind: concept
status: draft
sources:
  - codex-rs/app-server/src/lib.rs
  - codex-rs/app-server/src/dynamic_tools.rs
  - codex-rs/app-server/src/config_manager.rs
  - codex-rs/app-server-protocol/src/protocol/v2.rs
  - codex-rs/app-server-protocol/src/protocol/common.rs
  - codex-rs/app-server-client
  - codex-rs/app-server-daemon
  - codex-rs/app-server-transport
  - codex-rs/app-server-test-client
related:
  - concepts/sessions-rollouts.md
  - concepts/tools.md
last_reviewed: 2026-05-10
---

## TL;DR

The **app-server** is Codex's JSON-RPC daemon for IDE / web / external
integrations. It runs the same `CodexThread` core as the TUI, but
exposes it via a typed protocol (`app-server-protocol`) over stdio or
WebSocket. v2 of the protocol is the active development surface; v1 is
maintained for legacy callers but no new API surface should land
there (see [AGENTS.md](../../AGENTS.md)).

## Where it lives in the code

- Daemon entry: `codex-rs/app-server/src/lib.rs`,
  `app-server/src/bin/`.
- Dynamic tools: `app-server/src/dynamic_tools.rs` (clients can
  register custom tools per session).
- Config service: `app-server/src/config_manager.rs`,
  `config_manager_service.rs` (read/write/list of `config.toml`
  values).
- Wire types: `codex-rs/app-server-protocol/src/protocol/v2.rs`
  (active), `protocol/common.rs` (shared envelopes).
- Transport: `codex-rs/app-server-transport/`.
- Daemon variant: `codex-rs/app-server-daemon/`.
- Reference client: `codex-rs/app-server-client/`,
  `codex-rs/app-server-test-client/`.

## API conventions

(per `AGENTS.md` "App-server API Development Best Practices")

- All new development lives in v2.
- RPC method names are `<resource>/<method>`, with `<resource>` singular
  (`thread/read`, `app/list`).
- Field naming: camelCase on the wire (`#[serde(rename_all = "camelCase")]`),
  except config endpoints which mirror snake_case TOML keys.
- Discriminated unions are explicitly tagged
  (`#[serde(tag = "type", ...)]` + `#[ts(tag = "type", ...)]`).
- Timestamps are integer Unix seconds named `*_at`.
- Optional fields in client→server `*Params` use
  `#[ts(optional = nullable)]`.
- New list methods default to cursor pagination (`cursor: Option<String>`,
  `limit: Option<u32>`, response `data: Vec<…>`, `next_cursor: Option<String>`).
- Experimental surface marked with `#[experimental("method/or/field")]`.

## Surface

The protocol exposes the harness as a set of resources:

- **app** — install/list/upgrade plugins and connectors.
- **thread** — create/read/append/resume/fork conversation threads
  (see [sessions & rollouts](sessions-rollouts.md)).
- **config** — read/write/list config values (snake_case to mirror
  `config.toml`).
- **dynamic_tools** — register custom tools the model can call this
  session.

Every wire type derives `ts-rs` so a TypeScript client can be
generated.

## Dynamic tools

`app-server/src/dynamic_tools.rs` lets a connected client register a
`DynamicToolSpec` (defined in `codex_protocol::dynamic_tools`) at
session start. The harness parses it via `parse_dynamic_tool` →
`tool_definition_to_responses_api_tool` (`tools/src/responses_api.rs:142`)
and merges it into the [tool registry](tools.md). The client receives
events for each invocation and is expected to respond with a result.

## Transports

- **stdio** — for child-process integrations (IDE extensions).
- **WebSocket** — for browser / cloud clients.
- **daemon mode** — `app-server-daemon` runs as a long-lived process
  shared by multiple clients, multiplexing connections via
  `connection_rpc_gate.rs`.

## Edge cases & invariants

- v1 surface is frozen; new fields go on v2.
- `EventPersistenceMode::Extended` (see
  [sessions & rollouts](sessions-rollouts.md)) is mandatory for full
  app-server fidelity — `Limited` mode loses information clients need.
- Schema generation (`just write-app-server-schema`) must be re-run
  on any wire change (and PRs that change schemas are blocked at CI
  otherwise).

## Open questions / gaps

- Exact set of v2 RPC methods (the protocol module hasn't been read
  end-to-end for this page).
- WebSocket vs stdio framing details and reconnection / resume
  semantics.
- How `app-server-daemon` multiplexes per-client state and which
  daemon-only RPCs exist.

## See also

- [Tools](tools.md) — dynamic tool registration.
- [Sessions & rollouts](sessions-rollouts.md) — `thread/*` methods.
