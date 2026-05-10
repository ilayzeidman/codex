---
title: Hooks
kind: concept
status: stable
sources:
  - codex-rs/hooks/src/lib.rs
  - codex-rs/hooks/src/types.rs
  - codex-rs/hooks/src/registry.rs
  - codex-rs/hooks/src/declarations.rs
  - codex-rs/hooks/src/config_rules.rs
  - codex-rs/hooks/src/events
  - codex-rs/core/src/hook_runtime.rs
  - codex-rs/core/src/tools/registry.rs
  - codex-rs/core/src/compact.rs
related:
  - concepts/tools.md
  - concepts/context-management.md
  - concepts/plugins.md
last_reviewed: 2026-05-10
---

## TL;DR

Hooks are external commands or plugin-provided callbacks invoked by the
harness at well-defined lifecycle points. There are **eight** declared
hook events (`hooks/src/lib.rs:18`); each has a request payload, an
outcome type, and a fixed call site in `codex-rs/core`. Hooks can stop
the action, transform inputs, or attach extra context.

## Where it lives in the code

- Event names: `codex-rs/hooks/src/lib.rs:18` —
  ```rust
  pub const HOOK_EVENT_NAMES: [&str; 8] = [/* 8 names */];
  pub const HOOK_EVENT_NAMES_WITH_MATCHERS: [&str; 6] = [/* matcher-aware */];
  ```
- Event payloads: `codex-rs/hooks/src/events/` —
  `session_start.rs`, `user_prompt_submit.rs`, `pre_tool_use.rs`,
  `permission_request.rs`, `post_tool_use.rs`, `compact.rs`,
  `stop.rs`.
- Registry: `codex-rs/hooks/src/registry.rs` — `Hooks`, `HooksConfig`.
- Plugin-side declarations: `codex-rs/hooks/src/declarations.rs` —
  `PluginHookDeclaration`, `plugin_hook_declarations`.
- Config rules / state: `codex-rs/hooks/src/config_rules.rs` —
  `hook_states_from_stack`.
- Runtime: `codex-rs/core/src/hook_runtime.rs` — spawning,
  payload marshaling, outcome handling.

## The eight events

| Event | Where it fires | Outcome can… |
|---|---|---|
| `SessionStart` | When a new session begins | provide bootstrapping context, abort. |
| `UserPromptSubmit` | When the user submits a prompt | rewrite/augment the prompt, abort. |
| `PreToolUse` | Before a tool handler runs (`tools/registry.rs:355`) | provide `tool_input` overrides, stop. |
| `PermissionRequest` | When the harness needs an approval decision | auto-approve / auto-deny / defer. |
| `PostToolUse` | After a tool handler succeeds (`tools/registry.rs:420`) | attach extra context, stop further work. |
| `PreCompact` | Before compaction (`compact.rs:139`) | abort with reason. |
| `PostCompact` | After replacement history is installed | post-process replacement. |
| `Stop` | When the agent halts | record final summary / cleanup. |

Six of those carry matchers (e.g. tool names, file globs) so a hook can
target only specific calls.

## Outcomes

Each event has its own `*Outcome` enum (re-exported from `lib.rs:43`):

- `SessionStartOutcome`
- `UserPromptSubmitOutcome`
- `PreToolUseOutcome`
- `PermissionRequestOutcome` (with `PermissionRequestDecision`)
- `PostToolUseOutcome`
- `PreCompactOutcome` / `StatelessHookOutcome`
- `StopOutcome`

The recurring shape: `Continue { …optional fields }` vs `Stop { reason }`.
For tool hooks, `Continue` may include `tool_input` (pre) or
`additional_contexts` (post).

## Sources

A hook can come from:

- **Plugin manifest** — `PluginHookDeclaration` in
  `hooks/src/declarations.rs`. Plugins ship typed declarations that the
  loader merges into the active hook registry on install.
- **User config** — entries in `~/.codex/config.toml` under `[hooks]`.
- **Project config** — repo-local `.codex/` overrides.

`hook_states_from_stack` (`config_rules.rs`) merges the layers and
produces the runtime `HooksConfig` (`registry.rs`).

## Runtime

`core/src/hook_runtime.rs` owns:

- `run_pre_tool_use_hooks` and `run_post_tool_use_hooks` (called by
  `tools/registry.rs:355` / `:420`).
- `run_pre_compact_hooks` / `run_post_compact_hooks`
  (`compact.rs:139`).
- `emit_hook_completed_events` for telemetry.
- `run_pending_session_start_hooks` for bootstrapping.

Each hook is invoked as a child process (with JSON in/out) or, for
plugin-supplied hooks, dispatched to the plugin's runtime.

## Legacy notify hook

`hooks/src/legacy_notify.rs` (`legacy_notify_json`, `notify_hook`)
preserves the original `notify` config-key contract for backwards
compatibility — a single shell command run on certain events.

## Edge cases & invariants

- Hooks have a fixed firing order; multiple registered hooks for the
  same event run in registration order.
- A `Stop` outcome from any hook short-circuits the operation — the
  rest of the hooks for that event don't run.
- Hooks cannot bypass approval; they only inform it. The
  `PermissionRequestOutcome` is one input to the approval decision,
  not a final say.
- Hook payloads are stable JSON; backwards compatibility is enforced
  by serde defaults.

## See also

- [Tools](tools.md) — call sites of `Pre/PostToolUse`.
- [Context management](context-management.md) — call sites of
  `Pre/PostCompact`.
- [Plugins](plugins.md) — primary distribution channel for hooks.
