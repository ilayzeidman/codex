---
title: Glossary
kind: glossary
status: draft
sources: []
related:
  - concepts/overview.md
last_reviewed: 2026-05-10
---

Short definitions for terms that recur throughout the wiki. Each entry
links to the page where the term is the *primary* subject.

- **AGENTS.md** — project-doc concatenated into the contextual user
  message. See [context management](../concepts/context-management.md#agentsmd-and-per-project-memory).
- **App-server** — JSON-RPC daemon exposing the harness via
  `app-server-protocol`. See [app-server](../concepts/app-server.md).
- **Approval store** — in-memory cache of user approvals so identical
  follow-up tool calls don't re-prompt. See
  [sandboxing & approvals](../concepts/sandboxing-approvals.md#approval-flow).
- **Auto-compact** — automatic context summarization when the model
  window fills. See [context management](../concepts/context-management.md#compaction).
- **Bundled skill** — a system-scope skill embedded in the binary and
  extracted to `$CODEX_HOME/skills/.system`. See
  [skills](../concepts/skills.md#discovery-flow).
- **Code mode** — alternative tool surface where the model calls
  `exec`/`wait` with code instead of one function call per action.
  See [code mode](../concepts/code-mode.md).
- **Compaction trace** — sidecar overlay tracking compaction
  checkpoints for replay. See
  [sessions & rollouts](../concepts/sessions-rollouts.md#rollout-trace).
- **Connector** — directory entry describing an external service to
  install. See [connectors](../concepts/connectors.md).
- **ContextManager** — owner of the in-memory conversation history.
  See [context management](../concepts/context-management.md).
- **Developer instructions** — model-system messages bundled into the
  initial context. Distinct from the user instructions that ride on
  the contextual user message. See
  [context management](../concepts/context-management.md#turn-input-assembly).
- **Effective MCP server** — runtime variant covering both
  user-configured and built-in (in-process) MCP servers. See
  [MCP](../concepts/mcp.md#client-side).
- **Elicitation** — MCP server-initiated user prompt. See
  [MCP](../concepts/mcp.md#approval-flow).
- **Event persistence mode** — `Limited` vs `Extended`; controls how
  much fidelity rollouts retain. See
  [sessions & rollouts](../concepts/sessions-rollouts.md#event-persistence-modes).
- **Fork** — branch a session at a known rollout point. See
  [session lifecycle](../operations/session-lifecycle.md#4-fork).
- **Freeform tool** — a tool whose schema is a Lark grammar instead of
  JSON Schema. `apply_patch` is the canonical example. See
  [tools](../concepts/tools.md#apply_patch--the-freeform-tool-example).
- **Implicit invocation** — auto-injection of a skill body when the
  user references a tracked path. See
  [skills](../concepts/skills.md#how-skills-reach-the-model).
- **Initial context injection** — recomputed bundle of developer +
  contextual user sections per turn. See
  [context management](../concepts/context-management.md#turn-input-assembly).
- **McpHandler** — the single tool handler that bridges every remote
  MCP tool. See [MCP](../concepts/mcp.md#tool-dispatch).
- **Memory mode** — opt-in tier for the memory consolidation
  pipeline. See [context management](../concepts/context-management.md#memories).
- **Mutation gate** — serialization point so concurrent mutating
  tools don't race. See
  [tool call lifecycle](../operations/tool-call-lifecycle.md#concurrency-model).
- **Permission profile** — named bundle of capabilities (read-only,
  read-write, etc.). See
  [sandboxing & approvals](../concepts/sandboxing-approvals.md#permission-profiles).
- **Plugin** — versioned bundle contributing skills/hooks/MCP/connectors.
  See [plugins](../concepts/plugins.md).
- **Reference context item** — snapshot used to emit context-update
  diffs instead of full re-injections. See
  [context management](../concepts/context-management.md#history-pipeline).
- **Rollout** — JSONL append-only log of a session. See
  [sessions & rollouts](../concepts/sessions-rollouts.md).
- **Skill** — markdown context fragment, not a tool. See
  [skills](../concepts/skills.md).
- **Skill scope** — Repo / User / System / Admin priority ordering. See
  [skills](../concepts/skills.md#model--data-types).
- **Slash command** — fixed-set TUI directive. See
  [slash commands](../concepts/slash-commands.md).
- **State DB** — SQLite index over sessions and memory jobs. See
  [sessions & rollouts](../concepts/sessions-rollouts.md#state-db).
- **Tool gate** — see *mutation gate*.
- **Tool registry** — runtime collection of `ToolHandler` instances.
  See [tools](../concepts/tools.md#tool-registration--registry).
- **Turn** — one user submission → completed model response cycle.
  See [turn loop](../operations/turn-loop.md).
