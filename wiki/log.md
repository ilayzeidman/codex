---
title: Wiki log
kind: log
status: stable
last_reviewed: 2026-05-10
---

Append-only log of wiki operations. Each entry begins with a heading
of the form `## [YYYY-MM-DD] <kind> | <subject>` so the log is
greppable: `grep "^## \[" wiki/log.md | tail -10`.

Kinds: `bootstrap`, `ingest`, `query`, `lint`, `refactor`.

---

## [2026-05-10] bootstrap | initial wiki scaffold

First version of the wiki, generated from a top-down read of the
codex codebase at commit `178c3d3` on branch
`claude/codebase-llm-wiki-VWATX`.

**Created:**

- `wiki/WIKI.md` — schema and operating procedure.
- `wiki/index.md` — page catalog.
- `wiki/log.md` — this file.
- `wiki/glossary/index.md` — recurring-term definitions.
- `wiki/crates/index.md` — crate ↔ concept cross-reference.
- Concept pages:
  - `concepts/overview.md`
  - `concepts/skills.md` (stable)
  - `concepts/context-management.md` (stable)
  - `concepts/tools.md` (stable)
  - `concepts/mcp.md` (stable)
  - `concepts/hooks.md` (stable)
  - `concepts/sandboxing-approvals.md` (stable)
  - `concepts/sessions-rollouts.md` (stable)
  - `concepts/code-mode.md` (stable)
  - `concepts/feature-flags.md` (stable)
  - `concepts/plugins.md` (draft)
  - `concepts/model-providers.md` (draft)
  - `concepts/multi-agent.md` (draft)
  - `concepts/connectors.md` (draft)
  - `concepts/streaming.md` (draft)
  - `concepts/app-server.md` (draft)
  - `concepts/slash-commands.md` (draft)
- Operation pages:
  - `operations/turn-loop.md`
  - `operations/tool-call-lifecycle.md`
  - `operations/session-lifecycle.md`

**Source areas read in depth:** `core-skills/`, `skills/`,
`core/src/tools/`, `tools/`, `codex-mcp/`, `rmcp-client/`,
`builtin-mcps/`, `mcp-server/`, `core/src/session/mod.rs`,
`core/src/context_manager/`, `compact.rs`, `compact_remote.rs`,
`agents_md.rs`, `message-history/`, `rollout/`, `rollout-trace/`,
`memories/README.md`, `hooks/`, `sandboxing/`, `execpolicy/`,
`code-mode/`, `features/`, `connectors/`, `agent-identity/`,
`agent-graph-store/`, `external-agent-sessions/`.

**Source areas surveyed but not yet read line-by-line:**
`core-plugins/`, `model-provider/`, `models-manager/`, `lmstudio/`,
`ollama/`, `app-server/`, `app-server-protocol/`, `tui/src/slash_command.rs`,
`codex-client/src/sse.rs`, `external-agent-migration/`, `code-mode/src/runtime/`.
These pages are marked `status: draft`.

**Open follow-ups:**

- Verify per-provider streaming variants and update
  `concepts/streaming.md` and `concepts/model-providers.md`.
- Read plugin manifest schema (`core-plugins/src/manifest.rs`) and
  fill in `concepts/plugins.md`.
- Add detailed per-handler pages under `operations/` for the most
  complex tools (`shell`, `apply_patch`, `spawn_agent`).
- Fold in `docs/agents_md.md` once read; cross-check with the
  AGENTS.md citations in `concepts/context-management.md`.
- Verify the file-line citations under
  `concepts/context-management.md` (the bigger code-base reads were
  done by an `Explore` subagent and cite line numbers in
  `core/src/session/mod.rs` that should be sanity-checked).
- Confirm whether `models-manager` is the actual orchestrator name
  used in the code (only its directory was inspected).
