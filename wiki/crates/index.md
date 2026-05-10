---
title: Crate ↔ concept index
kind: crate
status: draft
sources:
  - codex-rs/Cargo.toml
related:
  - concepts/overview.md
last_reviewed: 2026-05-10
---

## TL;DR

Cross-reference table mapping each `codex-rs/*` crate to the concept
page(s) where it is the canonical implementation. This is the entry
point for code-first reading: pick a crate, jump to the concept page,
land in the relevant types and call sites with citations.

## Core runtime

| Crate | Concept |
|---|---|
| `core` | [Overview](../concepts/overview.md), [turn loop](../operations/turn-loop.md), [tool call lifecycle](../operations/tool-call-lifecycle.md), [context management](../concepts/context-management.md). |
| `core-api` | App-server / SDK API surface. See [app-server](../concepts/app-server.md). |
| `protocol` | Wire types shared across crates (`RolloutItem`, `EventMsg`, `SkillScope`, …). Cited from many pages. |
| `state` | Runtime state primitives consumed by `core`. |

## Skills, plugins, hooks

| Crate | Concept |
|---|---|
| `core-skills` | [Skills](../concepts/skills.md) — discovery, parsing, manager, render, injection. |
| `skills` | [Skills](../concepts/skills.md) — embedded sample skills, install_system_skills. |
| `core-plugins` | [Plugins](../concepts/plugins.md) — manager, marketplace, loader. |
| `plugin` | [Plugins](../concepts/plugins.md) — id/summary types. |
| `hooks` | [Hooks](../concepts/hooks.md) — events, registry, declarations. |

## Tools, MCP, code mode

| Crate | Concept |
|---|---|
| `tools` | [Tools](../concepts/tools.md) — JSON schema + tool spec primitives. |
| `core/src/tools/` (within `core`) | [Tools](../concepts/tools.md), [tool call lifecycle](../operations/tool-call-lifecycle.md) — registry, router, orchestrator, handlers. |
| `codex-mcp` | [MCP](../concepts/mcp.md) — connection manager (client). |
| `rmcp-client` | [MCP](../concepts/mcp.md) — RMCP transport. |
| `builtin-mcps` | [MCP](../concepts/mcp.md) — in-process MCP servers (memories). |
| `mcp-server` | [MCP](../concepts/mcp.md) — Codex-as-MCP-server. |
| `code-mode` | [Code mode](../concepts/code-mode.md). |

## Sandboxing, approval, hardening

| Crate | Concept |
|---|---|
| `sandboxing` | [Sandboxing & approvals](../concepts/sandboxing-approvals.md). |
| `bwrap` | Linux Bubblewrap glue. |
| `linux-sandbox` | Linux runtime support. |
| `windows-sandbox-rs` | Windows runtime support. |
| `execpolicy` | [Sandboxing & approvals](../concepts/sandboxing-approvals.md) — rule engine. |
| `execpolicy-legacy` | Legacy execpolicy parser. |
| `process-hardening` | Self-hardening of the harness binary. |

## Sessions, history, memory

| Crate | Concept |
|---|---|
| `rollout` | [Sessions & rollouts](../concepts/sessions-rollouts.md). |
| `rollout-trace` | [Sessions & rollouts](../concepts/sessions-rollouts.md) — compaction trace. |
| `message-history` | [Context management](../concepts/context-management.md) — `~/.codex/history.jsonl`. |
| `memories` | [Context management](../concepts/context-management.md) — memory pipeline. |
| `thread-store` | [Sessions & rollouts](../concepts/sessions-rollouts.md). |
| `thread-manager-sample` | Reference thread manager. |

## Multi-agent

| Crate | Concept |
|---|---|
| `agent-identity` | [Multi-agent](../concepts/multi-agent.md). |
| `agent-graph-store` | [Multi-agent](../concepts/multi-agent.md). |
| `external-agent-sessions` | [Multi-agent](../concepts/multi-agent.md). |
| `external-agent-migration` | [Multi-agent](../concepts/multi-agent.md). |

## Model providers

| Crate | Concept |
|---|---|
| `model-provider` | [Model providers](../concepts/model-providers.md). |
| `model-provider-info` | [Model providers](../concepts/model-providers.md) — static metadata. |
| `models-manager` | [Model providers](../concepts/model-providers.md). |
| `lmstudio` | [Model providers](../concepts/model-providers.md). |
| `ollama` | [Model providers](../concepts/model-providers.md). |
| `codex-client` | [Streaming](../concepts/streaming.md), HTTP transport. |
| `codex-api` | Public Codex SDK API types. |

## Auth & login

| Crate | Concept |
|---|---|
| `login` | Auth (device-code, PKCE). |
| `aws-auth` | AWS / Bedrock SigV4 chain. |
| `chatgpt` | ChatGPT cookie auth. |
| `keyring-store` | OS keyring backed credential store. |
| `secrets` | Secrets handling. |

## Connectors, features

| Crate | Concept |
|---|---|
| `connectors` | [Connectors](../concepts/connectors.md). |
| `features` | [Feature flags](../concepts/feature-flags.md). |

## Presentation surfaces

| Crate | Concept |
|---|---|
| `tui` | [Slash commands](../concepts/slash-commands.md), TUI rendering. |
| `exec` | Batch CLI surface. |
| `app-server` | [App-server](../concepts/app-server.md). |
| `app-server-protocol` | [App-server](../concepts/app-server.md) — wire types. |
| `app-server-client` | Reference client. |
| `app-server-daemon` | Long-lived multi-client daemon. |
| `app-server-test-client` | Test harness for app-server. |
| `app-server-transport` | Transport abstraction. |

## Utilities

| Crate | Concept |
|---|---|
| `analytics` | Telemetry plumbing. |
| `arg0` | argv[0] helpers. |
| `async-utils` | tokio helpers. |
| `ansi-escape` | Terminal escape utilities. |
| `apply-patch` | Patch grammar + applier (used by `apply_patch` tool). |
| `git-utils` | Git interactions. |
| `file-search` | File search backend. |
| `file-system` | FS abstractions used by skills/tools. |
| `file-watcher` | FS notification backend. |
| `network-proxy` | Proxy utilities. |
| `otel` | OpenTelemetry integration. |
| `terminal-detection` | Terminal capability detection. |
| `shell-command` / `shell-escalation` | Shell helpers. |
| `realtime-webrtc` | Realtime audio/voice. |
| `responses-api-proxy` | OpenAI Responses API proxy support. |
| `response-debug-context` | Debug payloads for responses. |
| `cloud-tasks` / `cloud-tasks-client` / `cloud-tasks-mock-client` / `cloud-requirements` | Cloud task runtime. |
| `feedback` | User feedback channel. |
| `install-context` | Install metadata. |
| `cli` | Top-level CLI dispatch. |
| `debug-client` | Debug protocol client. |
| `stdio-to-uds` | Bridge stdio ↔ Unix domain socket. |
| `uds` | UDS helpers. |
| `vendor` | Vendored dependencies. |
| `v8-poc` | V8 integration proof-of-concept (related to code-mode runtime). |
| `backend-client` | Codex backend HTTP client. |
| `codex-backend-openapi-models` | OpenAPI-generated Codex backend types. |
| `codex-experimental-api-macros` | Macros gating experimental app-server fields. |
| `collaboration-mode-templates` | Templates for collaboration-mode prompts. |
| `exec-server` | Companion server binary for `exec`. |
| `test-binary-support` | Test scaffolding for spawning workspace binaries. |
| `utils` | Shared utility crates collection (`codex-utils-*`). |

## See also

- [Overview](../concepts/overview.md) — how the crates compose.
- [WIKI.md](../WIKI.md) — schema for this wiki.
