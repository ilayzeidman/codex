---
title: Codex harness wiki — index
kind: index
status: stable
sources: []
related:
  - WIKI.md
last_reviewed: 2026-05-10
---

LLM-maintained knowledge base of how the **Codex LLM harness** works,
distilled from the source under `/home/user/codex` (primarily
`codex-rs/`). The codebase is the source of truth; this wiki is a
compounding synthesis. See [WIKI.md](WIKI.md) for schema and
operating procedure.

## Start here

- **[Architecture overview](concepts/overview.md)** — the mental model
  and crate map.
- **[Turn loop](operations/turn-loop.md)** — the per-turn timeline.
- **[Tool call lifecycle](operations/tool-call-lifecycle.md)** — the
  per-tool-call timeline.
- **[Session lifecycle](operations/session-lifecycle.md)** — create /
  resume / fork / shutdown.

## Concepts (the four headline subjects)

| Page | One-liner |
|---|---|
| **[Skills](concepts/skills.md)** | Markdown context fragments injected on demand; not tools. |
| **[Context management](concepts/context-management.md)** | History, compaction, memory, AGENTS.md, rollout. |
| **[Tools](concepts/tools.md)** | `ToolHandler` trait, registry, dispatch loop. |
| **[MCP](concepts/mcp.md)** | Client (external servers) + server (Codex-as-MCP). |

## Concepts (other harness layers)

| Page | One-liner |
|---|---|
| [Hooks](concepts/hooks.md) | Eight typed lifecycle events. |
| [Sandboxing & approvals](concepts/sandboxing-approvals.md) | Per-platform sandbox + approval cache. |
| [Plugins](concepts/plugins.md) | Versioned bundles of skills/hooks/MCP/connectors. |
| [Sessions & rollouts](concepts/sessions-rollouts.md) | JSONL session logs + state DB. |
| [Model providers](concepts/model-providers.md) | Provider abstraction + local providers. |
| [Multi-agent](concepts/multi-agent.md) | Identity, graph, external-agent migration. |
| [Code mode](concepts/code-mode.md) | `exec`/`wait` with nested tools. |
| [Connectors](concepts/connectors.md) | Directory of external service entries. |
| [Streaming](concepts/streaming.md) | SSE pipeline → output items. |
| [App-server](concepts/app-server.md) | JSON-RPC daemon for IDE/web. |
| [Slash commands](concepts/slash-commands.md) | TUI directive verbs. |
| [Feature flags](concepts/feature-flags.md) | Stage-aware experiment toggles. |

## Operations

| Page | One-liner |
|---|---|
| [Turn loop](operations/turn-loop.md) | End-to-end per-turn flow. |
| [Tool call lifecycle](operations/tool-call-lifecycle.md) | End-to-end per-tool-call flow. |
| [Session lifecycle](operations/session-lifecycle.md) | Create / resume / fork / shutdown. |

## Crates

- [Crate ↔ concept index](crates/index.md) — every `codex-rs/*` crate
  mapped to the concept page that documents it.

## Glossary

- [Glossary](glossary/index.md) — short definitions for recurring
  terms.

## Status legend

Each page declares `status: draft | stable` in frontmatter.

- **stable** — Cited from source; edits should keep citations current.
- **draft** — Synthesized but not yet line-by-line verified across all
  citations; treat the page as a roadmap pending a careful pass.

Currently:

- **stable**: skills, context management, tools, MCP, hooks,
  sandboxing & approvals, sessions & rollouts, code mode,
  feature flags, overview, tool call lifecycle.
- **draft**: plugins, model providers, multi-agent, connectors,
  streaming, app-server, slash commands, turn loop, session lifecycle,
  glossary, crate index.

## How to grow this wiki

1. Pick a concept or operation page.
2. Read its `sources:` files in full.
3. Update the page's "Where it lives in the code" section first; the
   rest of the page follows from accurate citations.
4. Append an entry to [log.md](log.md) describing what you ingested
   and which pages you touched.
5. Periodically run a lint pass: orphan pages, stale citations, missing
   cross-links (see [WIKI.md](WIKI.md#lint)).

## Source-of-truth pointers

- Code: `/home/user/codex/codex-rs/`
- Top-level project doc: [`/home/user/codex/AGENTS.md`](../AGENTS.md)
- Public docs: [`/home/user/codex/docs/`](../docs/)
- Local skills used by this repo: [`/home/user/codex/.codex/skills/`](../.codex/skills)
