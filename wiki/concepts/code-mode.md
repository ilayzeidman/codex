---
title: Code mode
kind: concept
status: stable
sources:
  - codex-rs/code-mode/src/lib.rs
  - codex-rs/code-mode/src/description.rs
  - codex-rs/code-mode/src/response.rs
  - codex-rs/code-mode/src/runtime
  - codex-rs/code-mode/src/service.rs
  - codex-rs/core/src/tools/handlers/mod.rs
  - codex-rs/core/src/tools/code_mode
  - codex-rs/core/src/tools/router.rs
related:
  - concepts/tools.md
  - concepts/sandboxing-approvals.md
last_reviewed: 2026-05-10
---

## TL;DR

**Code mode** is an alternative tool-invocation surface where the model
calls structured `exec` and `wait` tools (with code as the primary
parameter) instead of issuing one OpenAI function call per action. The
model's "tools" become nested *under* the code-mode runtime — the
runtime is responsible for sequencing nested calls, handing results
back, and yielding when work is async.

This pattern is useful for models that prefer code-shaped reasoning,
and for batching multiple actions into a single round-trip.

## Where it lives in the code

- Public API: `codex-rs/code-mode/src/lib.rs:6` —
  `CodeModeService`, `CodeModeTurnHost`, `CodeModeTurnWorker`,
  `ToolDefinition`, `ToolNamespaceDescription`.
- Tool descriptions: `code-mode/src/description.rs` —
  `CODE_MODE_PRAGMA_PREFIX`, `augment_tool_definition`,
  `build_exec_tool_description`, `build_wait_tool_description`,
  `is_code_mode_nested_tool`, `normalize_code_mode_identifier`,
  `parse_exec_source`, `render_code_mode_sample`,
  `render_json_schema_to_typescript`.
- Runtime: `code-mode/src/runtime` — `CodeModeNestedToolCall`,
  `ExecuteRequest`, `WaitRequest`, `WaitOutcome`, defaults
  (`DEFAULT_EXEC_YIELD_TIME_MS`, `DEFAULT_WAIT_YIELD_TIME_MS`,
  `DEFAULT_MAX_OUTPUT_TOKENS_PER_EXEC_CALL`).
- Response payloads: `code-mode/src/response.rs` — image/output items.
- Public tool names: `lib.rs:33` —
  ```rust
  pub const PUBLIC_TOOL_NAME: &str = "exec";
  pub const WAIT_TOOL_NAME:   &str = "wait";
  ```
- Tool handlers in core: `codex-rs/core/src/tools/handlers/mod.rs:46`
  (`CodeModeExecuteHandler`, `CodeModeWaitHandler`) and
  `codex-rs/core/src/tools/code_mode/` (registry integration).
- Router augmentation: `core/src/tools/router.rs:513` enriches normal
  tool specs with code-mode descriptions when code mode is enabled.

## Concept

In code-mode the model is shown two top-level tools — `exec` and
`wait` — instead of the usual flat list. Each tool's description
contains a TypeScript-rendered schema of *nested* tools the model can
call from inside its `exec` script. When the model invokes `exec`,
the runtime parses the source, dispatches nested calls back through
the regular tool registry, and yields control either when finished or
when a long-running call should pause (`DEFAULT_EXEC_YIELD_TIME_MS`).

`wait` is the matching primitive: when an `exec` yielded, the model
calls `wait` to retrieve outcomes (with `DEFAULT_WAIT_YIELD_TIME_MS`
controlling its own yield budget).

The model sees nested tools by name (after `normalize_code_mode_identifier`)
and by their TypeScript-rendered schema (via
`render_json_schema_to_typescript`). `is_code_mode_nested_tool`
distinguishes nested from top-level surface in routing.

## Runtime contract

- `ExecuteRequest` / `WaitRequest` carry the inputs.
- `CodeModeNestedToolCall` is the structured form of a nested call
  parsed from the script.
- `WaitOutcome` is the result envelope.
- `RuntimeResponse` (re-exported in `lib.rs`) is the canonical
  result type returned to the dispatcher.

`ToolOutput::code_mode_result` (see [tools](tools.md)) lets every tool
output produce a JSON value suitable for re-injection into the
runtime's nested call result map. This is why every tool implements
`code_mode_result` — code mode is a parallel rendering of the same
results.

## Augmentation

`augment_tool_definition` (`description.rs`) takes a tool definition
plus its namespace and returns an augmented description that includes
the code-mode pragma (`CODE_MODE_PRAGMA_PREFIX`) and a TypeScript
sample (`render_code_mode_sample`). When code mode is enabled, the
router replaces the usual function-style spec with this augmented
version so the model has the nested-tool API documented in-place.

## Edge cases & invariants

- Code mode is opt-in; routing falls back to standard function calls
  when not enabled (`router.rs:513`).
- `parse_exec_source` is permissive — invalid scripts surface as
  errors back to the model rather than exceptions in the runtime.
- The yield budgets are advisory: they bound how long an `exec`/`wait`
  can hold the conversation before returning control.
- Images and other rich outputs flow through the same response items
  defined in `code-mode/src/response.rs`.

## See also

- [Tools](tools.md) — code mode is one of three router shapes (with
  Function and Custom).
- [Sandboxing & approvals](sandboxing-approvals.md) — nested calls
  pass through the same sandbox/approval pipeline.
