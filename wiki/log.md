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

---

## [2026-05-10] lint | review pass

End-to-end citation + claim verification across every wiki page,
following the lint instructions in `WIKI.md`.

**Approach**

1. Read `WIKI.md`, `index.md`, `log.md`, `AGENTS.md`, every concept,
   operation, glossary, and crate page.
2. For each `path:line` citation, opened the cited file and confirmed
   the line still matched the claim. Where a function/type still
   existed nearby, updated the line number. Where the file or symbol
   did not exist, removed the claim.
3. Cross-checked substantive claims (skill scope ranking, hook event
   list, sandbox enum, code-mode tool names, MCP prefix, rollout
   path, message-history retry constants, etc.).
4. Verified glossary anchors against actual page headings and fixed
   broken cross-references.
5. Cross-checked `crates/index.md` against `ls codex-rs/`.

**Citations corrected (≈30 fixes across the wiki)**

- `concepts/context-management.md` — `ContextManager` `:32→:34`,
  `record_items` `:71→:99`, `for_prompt` `:98→:119`, `Prompt`
  `:27→:28`, `TurnContext` `:54→:55`, `TotalTokenUsageBreakdown`
  `:52→:54`, `compact_remote::run_remote_compact_task` `:41→:60`,
  `InitialContextInjection` `:50→:60`. Replaced misleading
  `~/.codex/memories/read/templates/...` path with the correct
  embedded-template location and `prompts.rs:12`/`:28` citations.
  Tightened message-history constants (`:47→:50`–`:51`,
  `:262→:263` and added `:48`/`:187`). Fixed
  `EventPersistenceMode` location (moved from
  `recorder.rs:196` to `policy.rs:6`). Fixed rollout file path
  (added `YYYY/MM/DD` subdir and `recorder.rs:1378`–`:1397`).
- `concepts/sessions-rollouts.md` — same rollout path fix. State DB
  filename corrected from `~/.codex/sessions.sqlite` to
  `~/.codex/state_5.sqlite` (`STATE_DB_FILENAME` at `state/src/lib.rs:64`).
  Replaced fictional `ForkParams` API with the actual
  `forked_from_id` field on `CreateThreadParams`. Removed unverified
  "plugin/marketplace bookkeeping" claim about state DB.
- `concepts/sandboxing-approvals.md` — fixed
  `SandboxablePreference` variants (`Forbid/Prefer/Always` →
  `Auto/Require/Forbid`). Replaced "`Rule` (rule.rs)" struct claim
  with the trait + `PrefixRule`/`NetworkRule` impls and added line
  numbers. `SessionConfiguration` cite `:64→:40`.
- `concepts/tools.md` — `spec_plan.rs:69` is
  `build_tool_registry_builder` not `register_builtin_tools`.
  `apply_patch.rs:33` (StreamingPatchParser) replaced with `:38`/
  `:59`/`:86` per actual symbols. `json_schema.rs:14→:15`. Code-mode
  augmentation moved from non-existent `router.rs:513` to
  `spec_plan.rs:76`–`:111`. Added `orchestrator.rs:127` for `run`.
- `concepts/mcp.md` — `tools.rs:28→:29`, `mcp/mod.rs:43→:44`–`:45`
  for constants. `connection_manager.rs` `:102→:104`, `:430→:432`.
  `RmcpClient` cite moved from `:77` (which is `PendingTransport`)
  to `:275`. Added 4th transport variant `StreamableHttpWithOAuth`.
  `mcp-server/src/lib.rs:62→:59`. `codex_tool_config.rs:21→:23`.
  `message_processor.rs:325→:324`–`:327`.
- `concepts/code-mode.md` — replaced non-existent `router.rs:513`
  with `spec_plan.rs:76` and `router.rs:81`–`:82`. Fixed
  `handlers/mod.rs:46→:47`–`:48` and pointed at the actual
  `code_mode/{execute_handler,wait_handler}.rs` line numbers.
- `concepts/multi-agent.md` — removed citations to
  `agent-identity/src/types.rs` and `store.rs` (these files do not
  exist; the crate is a single `lib.rs`). Replaced with line-number
  citations into `agent-identity/src/lib.rs`. Same fix to frontmatter
  `sources`. Replaced `external-agent-sessions/src/lib.rs:21` with
  the correct `:24` and `:31`.
- `concepts/plugins.md` — `plugin/src/lib.rs:19→:15` (re-export),
  with separate cites for `AppConnectorId` (`:20`),
  `PluginCapabilitySummary` (`:23`), `PluginHookSource` (`:33`).
- `concepts/connectors.md` — `connectors/src/lib.rs:24` split into
  `:20`, `:25`, `:66`; added `CONNECTORS_CACHE_TTL` constant cite.
- `concepts/streaming.md` & `concepts/model-providers.md` &
  `operations/turn-loop.md` — `sse.rs:9→:12`. Removed broken `[Login](#)`
  TODO link from model-providers.
- `concepts/slash-commands.md` — `slash_command.rs:8→:12`.
- `operations/session-lifecycle.md` — `Session` `:11→:14`,
  `SessionConfiguration` `:64→:40`, `TurnContext` `:54→:55`. Replaced
  `ForkParams` claim with `CreateThreadParams.forked_from_id` and
  `ThreadForkParams` (in app-server-protocol).
- `operations/tool-call-lifecycle.md` — `orchestrator.rs:57` (now
  `run_attempt`) split from `:127` (`run`); mutation gate cite
  pointed at `registry.rs:386`.

**Other corrections**

- `concepts/overview.md` — fixed broken frontmatter `related` link
  `concepts/turn-loop.md` → `operations/turn-loop.md`.
- `glossary/index.md` — pointed `Tool registry` entry at the actual
  `concepts/tools.md#dispatch-loop` heading (the previous anchor
  did not exist).
- `crates/index.md` — added missing crates that were absent from
  the table: `backend-client`, `codex-backend-openapi-models`,
  `codex-experimental-api-macros`, `collaboration-mode-templates`,
  `exec-server`, `test-binary-support`, `utils`.
- `concepts/app-server.md` and `concepts/slash-commands.md` —
  added the missing "Open questions / gaps" sections required by
  the schema for `draft` pages.
- `operations/turn-loop.md` and `operations/session-lifecycle.md` —
  same.

**Substantive claims spot-checked and confirmed**

- Skills: `SkillScope` ranks `Repo > User > System > Admin`
  (`core-skills/src/loader.rs:210`–`:218`,
  `core-skills/src/manager.rs:255`–`:259`).
- Skills: user roots are `$HOME/.agents/skills` (modern) and
  `$CODEX_HOME/skills/` (legacy/back-compat); embedded system skills
  at `$CODEX_HOME/skills/.system` (`core-skills/src/loader.rs:293`–`:320`,
  `skills/src/lib.rs:18`–`:32`).
- Hooks: 8 events in `HOOK_EVENT_NAMES` and 6 with matchers
  (`hooks/src/lib.rs:18`/`:34`).
- Sandbox enum has exactly the four variants `None`,
  `MacosSeatbelt`, `LinuxSeccomp`, `WindowsRestrictedToken`
  (`sandboxing/src/manager.rs:23`).
- Code mode constants `PUBLIC_TOOL_NAME = "exec"` and
  `WAIT_TOOL_NAME = "wait"` (`code-mode/src/lib.rs:33`–`:34`).
- MCP tool name prefix `"mcp"` and delimiter `"__"`
  (`codex-mcp/src/mcp/mod.rs:44`–`:45`).
- Rollout filename pattern
  `~/.codex/sessions/YYYY/MM/DD/rollout-YYYY-MM-DDTHH-MM-SS-<uuid>.jsonl`
  (`rollout/src/recorder.rs:1378`–`:1397`).

**Not fixed / left as-is**

- Plugins page: still draft, exact manifest schema not folded in
  (matches existing open questions).
- Streaming and app-server pages: still draft, per-provider variants
  and full v2 RPC enumeration left for a follow-up read.

**Status changes**

- No page status was upgraded or downgraded; stable pages were
  factually accurate after citation fixes (no remaining hedging),
  and all draft pages now have an "Open questions / gaps" section.

**Follow-ups noted (not done in this pass)**

- The state-DB schema (in `codex_state` crate) is referenced from
  multiple pages but not documented end-to-end; could become its
  own concept page.
- `core-skills/src/system.rs` and the implicit-invocation
  `mention_counts.rs` were not exercised here and remain
  candidates for a deeper read.
- Multiple crate pages under `crates/` are stubs (no per-crate
  pages exist beyond `index.md`); the schema allows them but they
  haven't been written yet.
