# WIKI.md — Schema and conventions for the Codex Harness Wiki

This wiki is an LLM-maintained, persistent knowledge base distilled from the
**Codex codebase itself**. The codebase (everything under `/home/user/codex`,
primarily `codex-rs/`) is the immutable source of truth. The wiki is a
compounding artifact that summarizes, cross-links, and synthesizes how the
**Codex LLM harness** is built.

The wiki's job is to answer: *how does the Codex harness actually work?* —
focused on the layers an agent author cares about: skills, context
management, tools, MCP, and the surrounding harness machinery.

## Layers

1. **Source of truth — the code.** Files under `codex-rs/` (Rust crates),
   `codex-cli/`, `sdk/`, `docs/`, and `.codex/`. The wiki references them
   with `path:line` citations. The wiki **never** modifies them.

2. **The wiki itself.** Markdown files under `wiki/` organized as:
   - `wiki/index.md` — content catalog (entry point for navigation/search).
   - `wiki/log.md` — chronological append-only log of ingests/queries/lints.
   - `wiki/WIKI.md` — this schema document.
   - `wiki/concepts/` — conceptual pages (the "what" and "why" of harness
     subsystems). One page per concept, e.g. `skills.md`, `tools.md`.
   - `wiki/crates/` — per-crate reference pages (the "where in the code").
     One page per Rust crate that materially implements a concept.
   - `wiki/operations/` — cross-cutting flows (e.g. the turn loop, a tool
     call's life cycle, session persistence).
   - `wiki/glossary/` — short definition stubs for recurring terms.

3. **Schema (this file).** Tells future LLM sessions how to extend the wiki
   without drifting from conventions.

## Page conventions

Every wiki page begins with YAML frontmatter:

```yaml
---
title: <Human-readable title>
kind: concept | crate | operation | glossary
status: draft | stable
sources:
  - codex-rs/<crate>/src/<file>.rs
  - codex-rs/<crate>/src/<other>.rs
related:
  - concepts/<page>.md
  - crates/<page>.md
last_reviewed: YYYY-MM-DD
---
```

Body sections, in order:

1. **TL;DR** — 2–4 sentences. What this is and why it matters.
2. **Where it lives in the code** — bulleted list of `path:line` citations
   for the canonical types/entry points.
3. **Model / data types** — key structs, enums, traits, with their roles.
4. **Flow** — step-by-step description of the relevant control flow.
5. **Configuration** — config keys, environment variables, file paths.
6. **Edge cases & invariants** — sandboxing, truncation, cycles, retries.
7. **Open questions / gaps** — anything noted but not yet investigated.
8. **See also** — wikilinks to related pages.

Cite code with backticks and `path:line` so an editor can jump directly
(e.g. `codex-rs/core-skills/src/loader.rs:159`).

## Linking

Use plain Markdown links. Wikilink-style `[[page]]` is **not** used because
this wiki is browsed both in plain editors and on GitHub. Every page should
have at least one inbound link from `index.md` or another concept page —
orphans are flagged by lint.

## Operations

### Ingest (a new code area or PR)

When a new area of the codex code is to be folded in:

1. Read the relevant files in full or via subagents (`Explore` is good for
   broad sweeps; targeted Reads for depth).
2. Decide which concept page(s) and crate page(s) it touches.
3. Update those pages: add citations, refine summaries, surface new
   invariants, retire claims that the new code contradicts.
4. If a new concept emerges, create a new page under `concepts/` and link
   it from `index.md`.
5. Append an entry to `log.md`.

### Query

When a user asks a question:

1. Read `index.md` to find candidate pages.
2. Read the candidate concept/crate pages.
3. Confirm load-bearing claims by re-reading the cited code.
4. Answer with citations. If the answer is novel and reusable, file it
   back under `concepts/` or `operations/` as a new page.

### Lint

Run periodically (and before any large ingest):

- Detect orphan pages (no inbound links).
- Detect stale citations (`path:line` that no longer exists or whose
  surrounding code changed materially).
- Detect contradictions across pages.
- Detect concepts mentioned in prose without a dedicated page.
- Suggest follow-up reads (areas of the code under-represented in the
  wiki).

## Scope

**In scope.** Everything that shapes how the LLM agent operates: skills,
tools, MCP, context assembly, hooks, sandboxing, plugins, model providers,
slash commands, sessions/rollouts, multi-agent orchestration, code mode,
streaming, the app-server protocol, login/auth (only as it affects the
runtime), and the overall turn loop.

**Out of scope.** TUI styling and ratatui ergonomics, build/CI plumbing
(Bazel, cargo workspaces), licensing, marketing copy. These are
mentioned only when they affect harness semantics (e.g. snapshot tests
gating UI invariants, build-script data files, Bazel's effect on
`include_str!`).

## Style

- Direct, factual prose. No marketing tone.
- Prefer concrete code references over abstract description.
- Where the code's intent is obvious from naming, just cite — don't
  re-explain.
- When summarizing a complicated path, list the *call sites* in order
  rather than narrating each step.
- Keep pages under ~400 lines; split when they grow past that.

## Date

The wiki was bootstrapped on 2026-05-10 from commit
`178c3d3 Persist 'priority' service tier as fast in config (#21991)` on
branch `claude/codebase-llm-wiki-VWATX`.
