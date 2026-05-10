---
title: Operation — tool call lifecycle
kind: operation
status: stable
sources:
  - codex-rs/core/src/tools/router.rs
  - codex-rs/core/src/tools/registry.rs
  - codex-rs/core/src/tools/orchestrator.rs
  - codex-rs/core/src/tools/sandboxing.rs
  - codex-rs/core/src/tools/context.rs
  - codex-rs/core/src/tools/handlers/mcp.rs
related:
  - concepts/tools.md
  - concepts/sandboxing-approvals.md
  - concepts/hooks.md
  - concepts/mcp.md
last_reviewed: 2026-05-10
---

## TL;DR

A model `function_call` becomes an executed tool through a fixed
pipeline: parse → match → pre-hook → mutation gate → approval/sandbox →
handle → post-hook → render. Every tool — built-in, MCP-bridged, custom
— flows through it.

## Timeline

```
ResponseItem (function_call|tool_search|local_shell|custom_tool|mcp)
                              │
                              ▼  router.rs:175  build_tool_call
                       ToolCall { tool_name, call_id, payload }
                              │
                              ▼  router.rs:269  dispatch
                       ToolInvocation
                              │
                              ▼  registry.rs:316  find handler
                              ▼  registry.rs:337  matches_kind
                              │
                              ▼  registry.rs:355  PreToolUse hooks
                              │
                              ▼  registry.rs:370  is_mutating?
                              ▼  orchestrator.rs:57  acquire mutation gate
                              │
                              ▼  orchestrator.rs:57  begin network approval
                              ▼  orchestrator.rs:57  build SandboxAttempt
                              ▼  sandbox::run
                              │
                              ▼  registry.rs:391  handler.handle(invocation)
                              │
                              ▼  on denial: orchestrator escalates,
                              │   reuses cached approval, retries
                              │
                              ▼  registry.rs:420  PostToolUse hooks
                              │
                              ▼  context.rs:92  result.to_response_item
                       ResponseInputItem
                              │
                              ▼
                conversation history (record_conversation_items)
```

## Step-by-step references

1. **Parse** — `codex-rs/core/src/tools/router.rs:175` decodes the
   model's `ResponseItem` into a `ToolCall`. The variants are
   FunctionCall / ToolSearchCall / LocalShellCall / CustomToolCall /
   McpCall.

2. **Build invocation** — `router.rs:269` constructs a
   `ToolInvocation` (`tools/context.rs:48`) with session, turn,
   call_id, source, and payload, then calls
   `registry.dispatch_any`.

3. **Find & validate** — `registry.rs:316` looks up the handler by
   `ToolName`; `:337` confirms `payload.kind()` matches the handler's
   `ToolKind`.

4. **Pre-tool-use hooks** — `registry.rs:355`. Hooks see
   `tool_name + tool_input`. A `Stop` outcome aborts the call.

5. **Mutation gate** — `registry.rs:370` consults
   `handler.is_mutating(&invocation)`. Mutating handlers serialize
   through the orchestrator's tool-gate.

6. **Approval & sandbox** — `orchestrator.rs:57`:
   - Begin a deferred network approval if needed.
   - Build a `SandboxAttempt` with the requested permission profile.
   - Run the handler under the platform sandbox
     (see [sandboxing & approvals](../concepts/sandboxing-approvals.md)).
   - On denial: escalate permissions, reuse cached approval (no
     re-prompt), retry once.
   - Finish or release the deferred network approval.

7. **Execute** — `registry.rs:391` calls `handler.handle(invocation)`
   which returns a `ToolOutput`. For MCP this is `McpHandler` calling
   into `McpConnectionManager`.

8. **Post-tool-use hooks** — `registry.rs:420`. May attach extra
   context items appended to the conversation.

9. **Render** — `result.to_response_item(call_id, payload)`
   (`tools/context.rs:92`) produces a `ResponseInputItem` consumed by
   `record_conversation_items` (see [turn loop](turn-loop.md) and
   [context management](../concepts/context-management.md)).

## Concurrency model

- **Read-only / non-mutating** tools may run in parallel within one
  turn (`supports_parallel_tool_calls` on the handler) and across MCP
  servers configured for it.
- **Mutating** tools serialize via the tool-gate; only one mutation
  runs at a time within a turn.
- **MCP servers** opt into parallelism per-server
  (`McpServerConfig.supports_parallel_tool_calls`); the router queries
  `manager.parallel_tool_call_server_names()` to know which.

## Failure paths

- Handler returns `FunctionCallError` → wrapped as a tool result whose
  `success_for_logging` is false; conversation continues.
- Pre-hook stops → no execution; the model sees a synthesized result
  message.
- Sandbox denies and escalation also denies → final error result with
  the denial reason.
- Network approval denied post-hoc → the tool's network calls are
  cancelled and the handler must surface the failure via its `Output`.

## See also

- [Tools](../concepts/tools.md) — handler trait and registry shape.
- [Sandboxing & approvals](../concepts/sandboxing-approvals.md) —
  detail of step 6.
- [MCP](../concepts/mcp.md) — `McpHandler` is one handler among many,
  but covers every remote tool.
- [Hooks](../concepts/hooks.md) — pre/post hook contracts.
