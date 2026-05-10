---
title: Architecture overview
kind: concept
status: stable
sources:
  - codex-rs/Cargo.toml
  - codex-rs/core/src/codex_thread.rs
  - codex-rs/core/src/session/mod.rs
  - codex-rs/cli/src/main.rs
related:
  - concepts/turn-loop.md
  - concepts/skills.md
  - concepts/tools.md
  - concepts/mcp.md
  - concepts/context-management.md
last_reviewed: 2026-05-10
---

## TL;DR

Codex is structured as a Rust workspace where the LLM **harness** (the
runtime that drives the model + tools) lives in `codex-rs/core` (and
adjacent crates), while presentation surfaces (`tui`, `exec`,
`app-server`, `mcp-server`) sit on top of a single `CodexThread` API.
Everything around that core — skills, hooks, plugins, model providers,
sandboxing — is its own crate, deliberately kept out of the
already-large `codex-core` (see [AGENTS.md](../../AGENTS.md)).

## The mental model

```
┌────────────────────────────────────────────────────────────────────┐
│                          presentation                               │
│   tui ──┐                                                          │
│   exec ──┼──►  CodexThread (codex-rs/core/src/codex_thread.rs:124) │
│   app-server ──┤                                                   │
│   mcp-server ──┘                                                    │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                  ┌──────────▼──────────┐
                  │  Session / TurnCtx  │  state, history, rollout
                  │  core/src/session/  │
                  └──────────┬──────────┘
                             │
       ┌───────────┬─────────┼───────────┬───────────────┐
       ▼           ▼         ▼           ▼               ▼
  ContextMgr   ToolRegistry  Hooks   Sandbox/Approval  ModelProvider
  (history)   (Function|Mcp) (8 evts) (Seatbelt/...)  (OpenAI/...)
                  │
                  ▼
          ┌───────────────┐         ┌──────────────────┐
          │  built-in     │         │  McpConnection   │
          │  handlers     │         │  Manager         │
          │  (shell etc.) │         │  → external MCP  │
          └───────────────┘         └──────────────────┘
```

Layered around that:

- **Skills** — markdown context fragments injected each turn
  ([skills](skills.md)).
- **Memories** & **AGENTS.md** — long-lived context inputs
  ([context management](context-management.md)).
- **Plugins** — distribution unit for skills, hooks, MCP servers, app
  connectors ([plugins](plugins.md)).
- **Slash commands** — TUI-only directive verbs
  ([slash commands](slash-commands.md)).
- **Multi-agent** — child sessions and external-agent migration
  ([multi-agent](multi-agent.md)).

## Crate layout (selected)

| Crate | Concept |
|---|---|
| `codex-rs/core` | Session, turn loop, context manager, tool registry. |
| `codex-rs/core-skills` + `codex-rs/skills` | [Skills](skills.md). |
| `codex-rs/core-plugins` + `codex-rs/plugin` | [Plugins](plugins.md). |
| `codex-rs/tools` | Tool spec + JSON schema primitives. |
| `codex-rs/codex-mcp` | MCP client. |
| `codex-rs/builtin-mcps` | In-process MCP servers (memories). |
| `codex-rs/mcp-server` | Codex-as-MCP-server binary. |
| `codex-rs/rmcp-client` | Transport (stdio / streamable HTTP / in-process). |
| `codex-rs/hooks` | [Hooks](hooks.md) declarations + runtime. |
| `codex-rs/sandboxing` | Platform sandbox abstraction. |
| `codex-rs/execpolicy` + `execpolicy-legacy` | Allow/deny rules for shell. |
| `codex-rs/bwrap` / `linux-sandbox` / `windows-sandbox-rs` | Per-OS sandbox glue. |
| `codex-rs/rollout` + `rollout-trace` | Session persistence and replay. |
| `codex-rs/message-history` | Persistent prompt history. |
| `codex-rs/memories` | Memory pipeline. |
| `codex-rs/model-provider` + `model-provider-info` + `models-manager` | Provider abstraction. |
| `codex-rs/lmstudio` / `ollama` | Local model providers. |
| `codex-rs/code-mode` | JS-driven tool invocation. |
| `codex-rs/connectors` | App connector directory. |
| `codex-rs/agent-identity` + `agent-graph-store` | Multi-agent identity & graph. |
| `codex-rs/external-agent-sessions` + `external-agent-migration` | Import non-Codex agent histories. |
| `codex-rs/features` | Feature flags / experiment stages. |
| `codex-rs/login` + `aws-auth` + `chatgpt` | Auth. |
| `codex-rs/codex-client` | HTTP client + SSE. |
| `codex-rs/tui` / `exec` / `app-server` | Presentation surfaces. |

The [crates index](../crates/index.md) cross-references each concept to
its canonical crate(s).

## Where to start reading

- New to the codebase: `codex-rs/core/src/codex_thread.rs:124` for the
  public submission API, then `codex-rs/core/src/session/mod.rs` for
  context assembly.
- New to the harness pattern: [turn loop](../operations/turn-loop.md).
- New to extending it: [skills](skills.md) or [plugins](plugins.md).
- New to integrating a new tool: [tools](tools.md), then
  [tool call lifecycle](../operations/tool-call-lifecycle.md).

## See also

- [WIKI.md](../WIKI.md) — schema for this wiki.
- [index.md](../index.md) — page catalog.
