---
title: Context management
kind: concept
status: stable
sources:
  - codex-rs/core/src/session/mod.rs
  - codex-rs/core/src/client_common.rs
  - codex-rs/core/src/context_manager/history.rs
  - codex-rs/core/src/context_manager/updates.rs
  - codex-rs/core/src/compact.rs
  - codex-rs/core/src/compact_remote.rs
  - codex-rs/core/src/agents_md.rs
  - codex-rs/core/src/session/turn_context.rs
  - codex-rs/message-history/src/lib.rs
  - codex-rs/rollout/src/recorder.rs
  - codex-rs/rollout/src/lib.rs
  - codex-rs/rollout-trace/src/compaction.rs
  - codex-rs/memories
related:
  - concepts/skills.md
  - concepts/sessions-rollouts.md
  - concepts/hooks.md
  - operations/turn-loop.md
last_reviewed: 2026-05-10
---

## TL;DR

Context management in Codex is a layered pipeline: a `ContextManager`
holds the in-memory history; turn input is reassembled each turn from a
set of *developer sections* (model instructions, permissions, memory,
collaboration mode, skills catalog, plugins, etc.) plus *contextual user
sections* (user instructions, environment, AGENTS.md); a compaction
subsystem summarizes history when the window fills up; and rollout
files persist everything to disk for replay, fork, and resume.

The key abstraction is **what the model sees this turn**, which is
recomputed from history + diffed snapshot + injected sections — not
just appended.

## Where it lives in the code

- In-memory history: `codex-rs/core/src/context_manager/history.rs:32` —
  `ContextManager`, `record_items` (`:71`), `for_prompt` (`:98`).
- Settings-diff machinery: `codex-rs/core/src/context_manager/updates.rs` —
  `build_model_instructions_update_item`, etc.
- Turn input assembly: `codex-rs/core/src/session/mod.rs:2567` —
  `build_initial_context`.
- Recording responses back: `codex-rs/core/src/session/mod.rs:2415` —
  `record_conversation_items`.
- Prompt struct: `codex-rs/core/src/client_common.rs:27`.
- Inline compaction: `codex-rs/core/src/compact.rs:69`.
- Remote compaction: `codex-rs/core/src/compact_remote.rs:41` (decision),
  `:255` (history replacement).
- AGENTS.md discovery: `codex-rs/core/src/agents_md.rs:1`, with
  separator `--- project-doc ---` at `:43`.
- Persistent message history: `codex-rs/message-history/src/lib.rs:1`.
- Rollout: `codex-rs/rollout/src/recorder.rs`, `codex-rs/rollout/src/lib.rs`.
- Trace: `codex-rs/rollout-trace/src/compaction.rs:30`.
- Memories: `codex-rs/memories/README.md`.

## Model / data types

```rust
// client_common.rs:27
pub struct Prompt {
    pub input: Vec<ResponseItem>,
    pub tools: Vec<ToolSpec>,
    pub parallel_tool_calls: bool,
    pub base_instructions: BaseInstructions,
    pub personality: Option<Personality>,
    pub output_schema: Option<Value>,
    pub output_schema_strict: bool,
}
```

```rust
// context_manager/history.rs:32
struct ContextManager {
    items: Vec<ResponseItem>,            // oldest → newest
    history_version: u64,                // bumped on rewrite
    token_info: Option<TokenUsageInfo>,
    reference_context_item: Option<TurnContextItem>, // baseline for diff
}
```

`ResponseItem` is the union of everything that ever lives in conversation
context: `Message`, `Compaction`, `ContextCompaction`, `Reasoning`,
`FunctionCall`, `CustomToolCall`, their outputs, `LocalShellCall`,
`WebSearchCall`, `ImageGenerationCall`, etc.

`TurnContext` (`session/turn_context.rs:54`) carries the per-turn
parameters: `sub_id`, `model_info` (with `context_window`),
`developer_instructions`, `user_instructions`, `compact_prompt`,
`truncation_policy`, and `dynamic_tools`.

`TotalTokenUsageBreakdown` (`context_manager/history.rs:52`) tracks:
- `last_api_response_total_tokens`
- `all_history_items_model_visible_bytes`
- `estimated_tokens_of_items_added_since_last_successful_api_response`
- `estimated_bytes_of_items_added_since_last_successful_api_response`

Token estimation is byte-heuristic, not tokenizer-accurate
(`approx_token_count` / `approx_bytes_for_tokens`,
`context_manager/history.rs:135`).

## Turn input assembly

`build_initial_context` (`session/mod.rs:2567`) assembles the request
context. The order matters: developer sections come *before* contextual
user sections; some are emitted as standalone `developer_update_item`s,
others are folded into a single contextual user message.

**Developer sections** (single bundled `developer_update_item` unless
otherwise noted):

1. Model-instructions update (when model switches, `<model_switch>`).
2. Permissions instructions (if enabled).
3. Developer instructions from `turn_context.developer_instructions`.
4. Memory tool developer instructions (loaded from
   `~/.codex/memories/read/templates/memories/read_path.md`,
   `session/mod.rs:2627`).
5. Collaboration-mode instructions.
6. Realtime-mode update (if a realtime session is active).
7. Personality spec (when not baked into the model).
8. Apps / MCP instructions.
9. Skill instructions — the catalog rendered by
   [skills](skills.md), budget `min(context_window * 0.02, 8000 chars)`.
10. Available-plugins instructions.
11. Git commit attribution instruction.

**Contextual user sections** (single contextual user message):

- User instructions from `turn_context.user_instructions`.
- Environment context (shell, cwd, subagent references).
- Multi-agent usage hints.

**Standalone items**:

- Multi-agent hint → its own `developer_update_item`.
- Guardian policy prompt (when escalations require it).

## History pipeline

`ContextManager.record_items` (`history.rs:71`) is the single entry for
new items: it processes (truncating function outputs per policy), filters
non-API messages, and appends. `for_prompt` (`:98`) normalizes the
history for the API and strips images if the current model's input
modalities don't include `Image`.

`history_version` is bumped on any rewrite — compaction, rollback,
replacement — so downstream consumers (TUI scrollback, app-server
snapshots) can detect non-monotonic edits and resync.

`reference_context_item` is the baseline used to emit *settings diffs*
on subsequent turns instead of the full initial context. When it's
present, `build_initial_context` only injects what changed; when absent
(post-compaction), the next regular turn re-injects the full block.

## Compaction

Compaction is triggered when context approaches the model's window. Two
implementations live side-by-side:

- **Inline** (`compact.rs:69`, `run_inline_auto_compact_task`) — reuses
  the Responses API: prompt the model with `templates/compact/prompt.md`
  (`SUMMARIZATION_PROMPT`) and `templates/compact/summary_prefix.md`
  (`SUMMARY_PREFIX`). User messages truncated at
  `COMPACT_USER_MESSAGE_MAX_TOKENS = 20_000` (`compact.rs:48`).
- **Remote** (`compact_remote.rs:41`, `run_remote_compact_task`) — calls
  a dedicated `/compact` endpoint that returns a replacement history.

When the replacement history comes back (`compact_remote.rs:255`), the
pipeline:

1. **Filters** via `should_keep_compacted_history_item`: drops
   `developer` role messages (stale/duplicated session prefix), drops
   non-user-content `user` messages, keeps `assistant`, user-role
   warnings, and the compaction summaries themselves.
2. **Re-injects initial context** if mid-turn (`compact_remote.rs:264`)
   above the last real user message, so the post-compaction model still
   sees current settings.
3. **Installs a checkpoint** in the rollout trace (`:242`).
4. **Replaces live history** via `sess.replace_compacted_history()`
   (`:246`).
5. **Recomputes tokens** via `sess.recompute_token_usage()` (`:248`).

The injection mode is explicit:

```rust
// compact.rs:50
enum InitialContextInjection {
    BeforeLastUserMessage,  // mid-turn: re-inject into replacement
    DoNotInject,            // pre-turn/manual: clear reference snapshot
}
```

`PreCompact` and `PostCompact` hooks (see [hooks](hooks.md)) wrap the
operation and may abort or transform the replacement
(`compact.rs:139`).

## AGENTS.md and per-project memory

`agents_md.rs:1` walks upward from the cwd until a `project_root_marker`
(`.git` by default) is found and concatenates every `AGENTS.md` between
project root and cwd, joined to user instructions by
`"\n\n--- project-doc ---\n\n"` (`:43`). A `LOCAL_AGENTS_MD_FILENAME`
(`AGENTS.override.md`) takes precedence when present. With the
`ChildAgentsMd` feature on, a `HIERARCHICAL_AGENTS_MESSAGE` is appended
explaining nested precedence.

## Memories

The two-phase memories pipeline (see `codex-rs/memories/README.md`):

- **Phase 1 — extraction.** Background workers claim eligible rollouts
  from the state DB and run a model call to distill structured memory.
- **Phase 2 — consolidation.** A global lock serializes workspace
  updates: load top-N stage-1 outputs, sync `raw_memories.md` and
  `rollout_summaries/`, run a consolidation sub-agent if the workspace
  is dirty.

Memory output is exposed to the model as a developer instruction block
loaded from `~/.codex/memories/read/templates/memories/read_path.md`
(`session/mod.rs:2627`), gated by the `MemoryTool` feature flag and
the `use_memories` config option.

## Persistent message history

`codex-rs/message-history/src/lib.rs:1` writes user-typed prompt history
to `~/.codex/history.jsonl` with one record per line:

```json
{"session_id":"<uuid>","ts":<unix_seconds>,"text":"<message>"}
```

Atomicity is achieved by writing each full line in a single `write(2)`
under `O_APPEND` (POSIX guarantees atomic writes ≤ `PIPE_BUF`). An
advisory lock with a 10-attempt × 100 ms retry loop avoids interleaving
concurrent processes (`message-history/src/lib.rs:47`). When the file
exceeds `max_bytes`, it's trimmed to an 80 % soft cap (`:262`) so
trims don't run on every append.

## Rollout persistence

`RolloutRecorder` (`rollout/src/recorder.rs`) is an async channel writer:
producers send `RolloutCmd::{AddItems, Persist, Flush, Shutdown}` and a
spawned `RolloutWriterTask` appends to
`~/.codex/sessions/rollout-YYYY-MM-DDTHH-MM-SS-<uuid>.jsonl`.

`EventPersistenceMode` (`recorder.rs:196`) toggles between:
- `Limited` — minimal replay surface (legacy).
- `Extended` — richer event surface needed for app-server history
  reconstruction.

Command output is sanitized on persistence: aggregated output is
truncated to 10 KB and stdout/stderr/formatted_output are cleared for
storage efficiency.

A separate state DB (`rollout/src/state_db.rs`) indexes sessions for
listing, fork/rollback discovery, and memory job leasing.

See [sessions & rollouts](sessions-rollouts.md) for the file format and
replay surface.

## Recording responses back into context

```rust
// session/mod.rs:2415
pub(crate) async fn record_conversation_items(
    &self,
    turn_context: &TurnContext,
    items: &[ResponseItem],
) {
    self.record_into_history(items, turn_context).await;     // in-memory
    self.persist_rollout_response_items(items).await;        // disk
    self.send_raw_response_items(turn_context, items).await; // events
}
```

In-memory recording goes through `ContextManager.record_items`. Rollout
persistence is non-blocking via the async writer task. The events stream
feeds the TUI / app-server / external clients.

## Configuration surface

| Path | Effect |
|---|---|
| `~/.codex/history.jsonl` | Persistent typed-prompt history. |
| `~/.codex/sessions/` | Rollout JSONL files. |
| `~/.codex/memories/` | Memory tool workspace. |
| `~/.codex/auth.json` | Login state. |
| `<repo>/AGENTS.md`, `<cwd>/AGENTS.md` | Project doc concat. |
| `<repo>/AGENTS.override.md` | Local override file. |
| Feature `MemoryTool` + config `use_memories` | Enable memories. |
| Feature `ChildAgentsMd` | Nested AGENTS.md hierarchy. |

## Edge cases & invariants

- Image stripping happens at `for_prompt` time based on the *current*
  model's input modalities — switching to a text-only model rewrites
  the prompt without touching history.
- `history_version` ensures compaction and rollback are observable to
  downstream consumers.
- Mid-turn compaction re-injects initial context above the last real
  user message; pre-turn / manual compaction clears the snapshot so the
  next regular turn rebuilds it from scratch.
- Persistent history's atomicity relies on `O_APPEND` + line ≤ `PIPE_BUF`;
  records that exceed the kernel boundary risk interleaving (the writer
  is mindful of this).
- `AGENTS.md` collection never traverses past the project root, even if
  more files exist further up.

## Open questions / gaps

- The exact contract of `templates/compact/prompt.md` and the strictness
  of summary structure expectations.
- The remote-compact `/compact` endpoint surface — request/response
  shape, error semantics.
- Concrete behavior when `context_window` is unknown
  (`turn_context.model_info.context_window`).

## See also

- [Skills](skills.md) — the skills catalog and on-demand body injection
  is the largest single context contributor.
- [Sessions & rollouts](sessions-rollouts.md) — disk format, resume,
  fork.
- [Hooks](hooks.md) — pre/post-compact hooks.
- [Turn loop](../operations/turn-loop.md) — how this page's pieces fit
  into the per-turn timeline.
