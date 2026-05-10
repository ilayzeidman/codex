---
title: Slash commands
kind: concept
status: draft
sources:
  - codex-rs/tui/src/slash_command.rs
  - codex-rs/tui/src/bottom_pane/slash_commands.rs
  - codex-rs/tui/src/chatwidget/slash_dispatch.rs
  - docs/slash_commands.md
related:
  - concepts/skills.md
last_reviewed: 2026-05-10
---

## TL;DR

Slash commands are built-in directive verbs typed in the TUI composer
(`/model`, `/skills`, `/permissions`, etc.). They are a *fixed* enum,
not an extension surface — extensible workflows belong in
[skills](skills.md) or [plugins](plugins.md). The enum lives in
`tui/src/slash_command.rs`; dispatch lives in
`tui/src/chatwidget/slash_dispatch.rs`.

## Where it lives in the code

- Enum: `codex-rs/tui/src/slash_command.rs:12` — `SlashCommand`
  variants, display metadata at `:80` onward.
- Composer popup: `codex-rs/tui/src/bottom_pane/slash_commands.rs`.
- Dispatch: `codex-rs/tui/src/chatwidget/slash_dispatch.rs`.
- User-facing docs: `docs/slash_commands.md`.

## Conventions

- `/<name>` parses to a `SlashCommand` variant or surfaces an error in
  the composer.
- Each variant either changes session state directly (`/model`,
  `/permissions`) or opens a sub-UI (`/skills`, `/hooks`,
  `/settings`).
- Slash commands are presentation-only — they do not appear in the
  model's tool list and do not enter conversation context.

## Edge cases & invariants

- The composer treats a leading `/` ambiguously: if the rest typeahead-
  matches a known command, it's a slash command; otherwise it's a
  literal user message. Users escape with a leading space.
- Slash commands that *change* session state (`/model`, permissions)
  flow through the same context-update machinery as silent state
  changes — see [context management](context-management.md) on
  `<model_switch>` developer messages.

## Open questions / gaps

- The full enum of `SlashCommand` variants and their dispatch
  handlers — this page hasn't read `slash_dispatch.rs` line by line.
- How slash commands interact with snapshot tests in `tui/`.

## See also

- [Skills](skills.md) — what to use *instead* of adding a new slash
  command for an extensible workflow.
