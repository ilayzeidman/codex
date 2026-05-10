---
title: Tools
kind: concept
status: stable
sources:
  - codex-rs/core/src/tools/registry.rs
  - codex-rs/core/src/tools/router.rs
  - codex-rs/core/src/tools/context.rs
  - codex-rs/core/src/tools/orchestrator.rs
  - codex-rs/core/src/tools/sandboxing.rs
  - codex-rs/core/src/tools/spec_plan.rs
  - codex-rs/core/src/tools/handlers/mod.rs
  - codex-rs/tools/src/json_schema.rs
  - codex-rs/tools/src/tool_spec.rs
  - codex-rs/tools/src/responses_api.rs
  - codex-rs/core/src/tools/handlers/apply_patch.rs
  - codex-rs/core/src/tools/handlers/mcp.rs
related:
  - concepts/mcp.md
  - concepts/sandboxing-approvals.md
  - concepts/hooks.md
  - concepts/code-mode.md
  - operations/tool-call-lifecycle.md
last_reviewed: 2026-05-10
---

## TL;DR

A **Tool** is anything the model can invoke via a function call. Codex
defines a single `ToolHandler` trait, builds a registry of handlers at
session start, and dispatches model `function_call`s through a uniform
pipeline that runs hooks, gates by approval/sandbox, executes the
handler, and serializes the result back into the conversation.

Built-in tools (shell, apply_patch, view_image, plan, multi-agent, code
mode) and dynamic tools (MCP, plugin-defined) all flow through the same
registry — MCP-bridged tools are just `McpHandler` instances, one per
remote tool.

## Where it lives in the code

- Trait + registry: `codex-rs/core/src/tools/registry.rs:38` — `ToolHandler`,
  `ToolRegistryBuilder`, `AnyToolResult` (`:112`), `dispatch_any` (`:263`).
- Router / dispatch entry: `codex-rs/core/src/tools/router.rs:174` —
  `build_tool_call`, `dispatch_tool_call_with_code_mode_result` (`:269`).
- Invocation context: `codex-rs/core/src/tools/context.rs:48` —
  `ToolInvocation`, `ToolPayload` (`:60`), `ToolOutput` (`:92`).
- Sandbox + approval: `codex-rs/core/src/tools/sandboxing.rs:1`,
  `codex-rs/core/src/tools/orchestrator.rs:41`.
- Spec assembly: `codex-rs/core/src/tools/spec_plan.rs:69` —
  `register_builtin_tools`.
- Handler enumeration: `codex-rs/core/src/tools/handlers/mod.rs:1`.
- Schema primitives: `codex-rs/tools/src/json_schema.rs:14`,
  `tools/src/tool_spec.rs:17`, `tools/src/responses_api.rs:142`.
- Serialization for the wire: `tools/src/tool_spec.rs:100` —
  `create_tools_json_for_responses_api`.

## Model / data types

`ToolHandler` (`registry.rs:38`):

```rust
pub trait ToolHandler: Send + Sync {
    type Output: ToolOutput + 'static;
    fn tool_name(&self) -> ToolName;
    fn spec(&self) -> Option<ToolSpec> { None }
    fn supports_parallel_tool_calls(&self) -> bool { false }
    fn kind(&self) -> ToolKind;                // Function | Mcp
    fn matches_kind(&self, payload: &ToolPayload) -> bool;
    fn is_mutating(&self, _: &ToolInvocation) -> impl Future<Output = bool>;
    fn pre_tool_use_payload(&self, _: &ToolInvocation) -> Option<PreToolUsePayload>;
    fn post_tool_use_payload(&self, _: &ToolInvocation, _: &Self::Output) -> Option<PostToolUsePayload>;
    fn handle(&self, invocation: ToolInvocation) -> impl Future<Output = Result<Self::Output, FunctionCallError>>;
}
```

The `Output` is a `ToolOutput` (`context.rs:92`) responsible for
formatting itself back to the model:

```rust
pub trait ToolOutput: Send {
    fn log_preview(&self) -> String;
    fn success_for_logging(&self) -> bool;
    fn to_response_item(&self, call_id: &str, payload: &ToolPayload) -> ResponseInputItem;
    fn post_tool_use_response(&self, _: &str, _: &ToolPayload) -> Option<JsonValue>;
    fn code_mode_result(&self, payload: &ToolPayload) -> JsonValue;
}
```

`ToolPayload` (`context.rs:60`) is the discriminant the router uses to
route a model output into a handler:

- `Function` — standard JSON function call
- `ToolSearch` — special-cased BM25 tool search
- `Custom` — freeform / grammar-constrained
- `LocalShell` — built-in shell variant
- `Mcp { server, tool, raw_arguments }` — MCP-bridged

`ToolSpec` (`tools/src/tool_spec.rs:17`) is the wire-shape of a tool
definition exposed to the model. It is a tagged enum with variants
`Function`, `Namespace`, `ToolSearch`, `LocalShell`, `WebSearch`,
`ImageGeneration`, and `Freeform(FreeformTool)`. JSON schemas use the
primitives in `json_schema.rs:14`.

`ToolName` (in `codex_tools`) is namespaced — `(Option<namespace>, name)`
— and is the registry key.

## Built-in handler inventory

From `core/src/tools/handlers/mod.rs:1`:

| Tool | Handler | Source |
|---|---|---|
| `shell` | `ShellHandler` | `handlers/shell/shell_handler.rs` |
| `local_shell` | `LocalShellHandler` | `handlers/shell/local_shell.rs` |
| `exec_command` | `ExecCommandHandler` | `handlers/unified_exec.rs` |
| `apply_patch` | `ApplyPatchHandler` | `handlers/apply_patch.rs:286` |
| `tool_search` | `ToolSearchHandler` | `handlers/tool_search.rs:53` |
| `view_image` | `ViewImageHandler` | `handlers/view_image.rs:65` |
| `mcp__*` | `McpHandler` (one per remote tool) | `handlers/mcp.rs:20` |
| `request_user_input` | `RequestUserInputHandler` | `handlers/request_user_input.rs:22` |
| `request_plugin_install` | `RequestPluginInstallHandler` | `handlers/request_plugin_install.rs:53` |
| `create_goal`/`get_goal`/`update_goal` | goal handlers | `handlers/goal.rs` |
| `spawn_agent`/`wait_agent`/`close_agent` | multi-agent handlers | `handlers/multi_agents.rs` |
| `code_mode_execute`/`code_mode_wait` | code-mode handlers | `tools/code_mode/` |
| `plan` | `PlanHandler` | `handlers/plan.rs:47` |
| `test_sync` | `TestSyncHandler` | `handlers/test_sync.rs:59` |

`spec_plan.rs:69` is the central place that constructs handlers and
registers them with `ToolRegistryBuilder` (`registry.rs:497`).

## Dispatch loop

A model response carrying a `function_call` (or one of the special
`ResponseItem` variants) drives the following pipeline (router.rs +
registry.rs):

1. **Parse** — `router.rs:175` decodes the `ResponseItem` into a
   `ToolCall { tool_name, call_id, payload }`.
2. **Route** — `router.rs:269` looks up the handler by `ToolName`,
   builds a `ToolInvocation` (session, turn, call id, payload, source),
   and calls `registry.dispatch_any(invocation)`.
3. **Match kind** — `registry.rs:337` ensures the payload's kind matches
   the handler's declared `ToolKind` (Function vs Mcp).
4. **Pre-tool-use hooks** — `registry.rs:355` runs `PreToolUse` hooks
   with `tool_name + tool_input`. Hooks may stop the call.
5. **Mutation gate** — `registry.rs:370` calls `handler.is_mutating`;
   if mutating, the orchestrator serializes through a "tool gate" so
   only one mutator runs at a time.
6. **Approval / sandbox** — `orchestrator.rs:57` opens a network
   approval (if needed), creates a `SandboxAttempt`, runs the handler
   inside, and on denial escalates and retries (decisions cached in
   `ApprovalStore`, `sandboxing.rs:42`, so the user is not re-prompted).
7. **Execute** — `handler.handle(invocation)` returns a `ToolOutput`.
8. **Post-tool-use hooks** — `registry.rs:420` runs `PostToolUse` hooks,
   which may attach extra context or stop further execution.
9. **Render** — `result.to_response_item(call_id, payload)` produces a
   `ResponseInputItem` appended to the conversation.

`AnyToolResult` (`registry.rs:112`) is the boxed bridge between
heterogeneous outputs and the conversation, so the registry can hold
handlers with different `Output` types.

## Schema exposure

`tool_spec.rs:100` (`create_tools_json_for_responses_api`) serializes the
final spec list for the OpenAI Responses API. Specs come from:

- Built-in handlers' `spec()` (collected by `ToolRegistryBuilder`).
- Code-mode augmentation if enabled (`router.rs:513`).
- Dynamic tools parsed via `parse_dynamic_tool` →
  `tool_definition_to_responses_api_tool` (`responses_api.rs:142`),
  used by app-server clients to register custom tools.
- MCP tools (collected once via the connection manager — see
  [MCP](mcp.md)).

Tool descriptions are *not* injected as a separate system message; they
ride on the API request's `tools` array.

## `apply_patch` — the freeform tool example

`apply_patch` shows the `Freeform` spec variant: instead of a JSON schema
the model is given a Lark grammar and emits a textual patch.

- Grammar: `core/src/tools/handlers/apply_patch.lark:1`
  ```lark
  start: begin_patch hunk+ end_patch
  hunk: add_hunk | delete_hunk | update_hunk
  add_hunk: "*** Add File: " filename LF add_line+
  ...
  ```
- Streaming parse: `apply_patch.rs:33` — `StreamingPatchParser` consumes
  diffs incrementally and emits `PatchApplyUpdatedEvent` so the TUI can
  render the diff progressively.
- The handler validates paths against the sandbox FS before applying.

## MCP-bridged tools

`McpHandler` (`handlers/mcp.rs:20`) is a single generic handler that
covers every remote MCP tool. The `ToolName` follows
`mcp__<server>__<tool>` (with sanitization for collisions — see
[MCP](mcp.md)) and `ToolPayload::Mcp` carries `(server, tool,
raw_arguments)`. The handler marshals through `McpConnectionManager`
and wraps the response into `McpToolOutput` with `result`, `tool_input`,
`wall_time`, and a `TruncationPolicy`.

## Result formatting

`tools/mod.rs:53` (`format_exec_output_for_model_*`) defines the canonical
exec output shapes:

- *Structured*: `{output, metadata: {exit_code, duration_seconds}}` JSON.
- *Freeform*: `Exit code: …\nWall time: …\nOutput: …` text.

Truncation goes through `codex_utils_output_truncation::formatted_truncate_text`
under one of three `TruncationPolicy` modes (`Bytes`, `Lines`, `Tokens`).
Telemetry previews are capped at 2 KiB / 64 lines (`tools/mod.rs:31`).

## Edge cases & invariants

- Mutating tools serialize through the "tool gate" — concurrent
  mutators cannot race.
- Approval decisions live in `ApprovalStore` (`sandboxing.rs:42`); a
  single approval covers identical follow-up invocations within the
  session.
- Sandbox escalation re-runs the handler under broader permissions
  *without* re-prompting if the approval is already cached.
- A handler's `Output` type is sealed via `AnyToolResult`; new tools
  must implement `ToolOutput` for both freeform and structured rendering
  paths (else code mode integration breaks).

## Open questions / gaps

- The exact code-mode JS runtime, its ABI to the registry, and how
  custom JS-defined tools are isolated — see [code mode](code-mode.md).
- Per-server parallel tool call configuration (how `parallel_mcp_server_names`
  in `router.rs:49` is wired) — see [MCP](mcp.md).

## See also

- [MCP](mcp.md) — the largest dynamic source of tools.
- [Sandboxing & approvals](sandboxing-approvals.md) — what gates execution.
- [Hooks](hooks.md) — pre/post tool-use hook contracts.
- [Code mode](code-mode.md) — the alternative JS-driven invocation path.
- [Tool call lifecycle](../operations/tool-call-lifecycle.md) — the
  end-to-end timeline of a single call.
