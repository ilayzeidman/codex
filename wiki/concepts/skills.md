---
title: Skills
kind: concept
status: stable
sources:
  - codex-rs/core-skills/src/model.rs
  - codex-rs/core-skills/src/loader.rs
  - codex-rs/core-skills/src/manager.rs
  - codex-rs/core-skills/src/injection.rs
  - codex-rs/core-skills/src/render.rs
  - codex-rs/core-skills/src/config_rules.rs
  - codex-rs/core-skills/src/invocation_utils.rs
  - codex-rs/skills/src/lib.rs
  - codex-rs/skills/src/assets/samples
  - codex-rs/protocol/src/protocol.rs
  - codex-rs/core/src/session/turn.rs
  - .codex/skills
related:
  - concepts/tools.md
  - concepts/plugins.md
  - concepts/context-management.md
  - crates/core-skills.md
last_reviewed: 2026-05-10
---

## TL;DR

A **Skill** is a directory containing a `SKILL.md` (markdown body with YAML
frontmatter) plus optional supporting files. Skills are *not* tools — they
are **context fragments** the harness injects into the model when relevant.
At session start the harness scans a layered set of root directories,
parses metadata, renders a brief catalog into the system prompt, and
injects full SKILL.md bodies on demand when a skill is mentioned or
implicitly triggered.

Skills are how Codex packages reusable, model-driven workflows (e.g.
`code-review`, `babysit-pr`, `skill-creator`) without baking them into the
binary or requiring a tool definition per workflow.

## Where it lives in the code

- Data model: `codex-rs/core-skills/src/model.rs:11` — `SkillMetadata`,
  `SkillScope`, `SkillLoadOutcome`.
- Discovery + parsing: `codex-rs/core-skills/src/loader.rs:159` —
  `load_skills_from_roots`, `discover_skills_under_root`,
  `extract_frontmatter` (`:599`).
- Caching/lifecycle: `codex-rs/core-skills/src/manager.rs:51` —
  `SkillsManager::skills_for_config`, `skill_roots_for_config`.
- Prompt rendering: `codex-rs/core-skills/src/render.rs:62` —
  `build_available_skills`, the `<skills_instructions>` envelope.
- On-demand injection: `codex-rs/core-skills/src/injection.rs:24` —
  `SkillInjection`, `build_skill_injections`.
- Implicit invocation indexes: `codex-rs/core-skills/src/invocation_utils.rs`.
- Embedded system skills: `codex-rs/skills/src/lib.rs:32` —
  `install_system_skills` (extracts `src/assets/samples/` to disk).
- Protocol surface (wire types): `codex-rs/protocol/src/protocol.rs` —
  `SkillScope`, the `<skill>` / `<skills_instructions>` tags.
- Repo-shipped examples: `.codex/skills/code-review/SKILL.md`,
  `.codex/skills/babysit-pr/SKILL.md`, etc.

## Model / data types

`SkillMetadata` (`core-skills/src/model.rs:11`):

| Field | Meaning |
|---|---|
| `name` | Identifier (≤64 chars, single line). |
| `description` | Full description used in the system-prompt catalog (≤1024 chars). |
| `short_description` | Optional UI preview line. |
| `interface` | UI metadata (`display_name`, icons, `brand_color`, `default_prompt`). |
| `dependencies.tools[]` | Declared tool requirements (type, value, transport, command, url). |
| `policy.allow_implicit_invocation` | Default `true`; gates auto-trigger. |
| `path_to_skills_md` | Absolute path on disk to `SKILL.md`. |
| `scope` | `SkillScope::{Repo, User, System, Admin}`. |
| `plugin_id` | Set when the skill came from a plugin. |

`SkillScope` ranks **Repo > User > System > Admin** for shadowing and
display order. Same-named skills resolve to the highest-priority scope.

`SkillLoadOutcome` (`core-skills/src/model.rs:89`) bundles:
- `skills` — the loaded list, sorted by scope rank then name.
- `errors` — parse/load failures (path + message).
- `disabled_paths` — skills suppressed by config rules.
- `file_systems_by_skill_path` — sandboxed `ExecutorFileSystem` per skill,
  used when the body is later read for injection.
- `implicit_skills_by_scripts_dir` / `implicit_skills_by_doc_path` —
  indexes used to detect implicit triggers when the user references files.

## SKILL.md format

```markdown
---
name: code-review
description: Run a final code review on a pull request
metadata:
  short-description: Review code for security, correctness, etc.
---

(markdown body — workflow instructions for the model)
```

`extract_frontmatter` (`loader.rs:599`) requires the leading `---` block;
missing frontmatter raises `SkillParseError::MissingFrontmatter`. If `name`
is omitted the loader falls back to the parent directory name. Optional
`agents/openai.yaml` alongside the skill directory carries the `interface`,
`dependencies`, `policy` metadata (see e.g. `.codex/skills/babysit-pr/agents/openai.yaml`).

## Discovery flow

`SkillsManager::skills_for_config` resolves the skill root list from the
config layer stack, then `load_skills_from_roots` walks each root.

Roots, in scope order (`loader.rs:248`):

1. **Repo** — `.agents/skills/` in the project root and its ancestors up to
   the workspace boundary. Uses the repo's `ExecutorFileSystem`.
2. **User** — `$HOME/.agents/skills/` (modern) and `$CODEX_HOME/skills/`
   (legacy, kept for back-compat). Uses `LOCAL_FS`.
3. **System** — embedded sample skills from `codex-rs/skills/src/assets/samples/`
   via `include_dir!`, extracted to `$CODEX_HOME/skills/.system/` on first
   run. Fingerprinted (`.codex-system-skills.marker`) so re-extraction only
   happens when the bundled assets change. Gated by `bundled_skills_enabled`.
4. **Admin** — `/etc/codex/skills` on Unix.
5. **Plugin** — additional `PluginSkillRoot`s contributed by installed
   plugins, tagged with their `plugin_id` (still scoped as `User`).

Scanning (`loader.rs:456`) is breadth-first to depth 6, capped at 2000
directories per root. Hidden directories are skipped. Symlinks are
followed for everything except `System` (integrity).

Disable rules (`config_rules.rs:30`) read the `[skills]` config section
across layers; later layers override earlier ones. Selectors match by
`name` or `path`. Disabled paths drop into `SkillLoadOutcome.disabled_paths`
and are filtered out of the visible list.

## How skills reach the model

There are two surfaces:

### 1. Catalog injection (every turn)

`render.rs:62` (`build_available_skills`) renders the discovered skills
into a markdown block wrapped in `<skills_instructions>` … `</skills_instructions>`
(tags from `protocol/src/protocol.rs:96`). It includes:

- A skill-roots alias table (when used) so paths can be referenced as
  short prefixes without spending tokens on absolute paths.
- One line per skill: `name + description + path`.
- Trigger rules and progressive-disclosure guidance (constants at
  `render.rs:27`).

A budget cap of ~2 % of the context window (8000 char baseline,
`render.rs:17`) truncates descriptions when too many skills are present
and emits warnings.

### 2. Body injection (when triggered)

When the user explicitly mentions a skill, or when implicit-invocation
indexes detect a referenced path/script:

- `build_skill_injections` (`injection.rs:31`) loads each requested
  `SKILL.md` via the per-skill sandboxed FS.
- Each body is wrapped in `<skill name="..." path="...">…</skill>` and
  appended to the conversation as a context fragment by
  `core/src/session/turn.rs`.
- The same path also collects `InvocationType::Explicit` /
  `InvocationType::Implicit` telemetry.

## Configuration

Relevant config keys (TOML):

```toml
[skills]
bundled_skills_enabled = true   # extract embedded system skills

[[skills.config]]
name = "code-review"            # selector by name or path
enabled = false
```

Roots can also be augmented by plugins (see [plugins](plugins.md)).

## Edge cases & invariants

- Skills are **never callable** as a tool. They are markdown injected
  into context. The model's only "skill API" is reading the catalog and
  saying the skill name (or referencing a tracked path).
- Same-named skill in two scopes: the higher-rank scope wins; the lower
  is dropped from the visible list (still loaded into outcome metadata
  for auditing).
- A skill body is only read from disk when actually injected — discovery
  reads only the frontmatter.
- The system-skill installer is fingerprinted: re-extraction is keyed on
  embedded asset hash, so version bumps refresh the cache automatically.
- `policy.allow_implicit_invocation == false` removes the skill from the
  implicit-invocation indexes, but it is still listed in the catalog and
  can still be invoked by explicit mention.

## Open questions / gaps

- The exact mention-parsing regex used in `core/src/session/turn.rs` is
  not yet captured here — see [turn loop](../operations/turn-loop.md).
- How plugin-bundled skill assets are versioned alongside the plugin
  manifest — see [plugins](plugins.md).

## See also

- [Tools](tools.md) — what skills *don't* register as.
- [Plugins](plugins.md) — how third-party skills get distributed.
- [Context management](context-management.md) — what happens to skill
  bodies once injected, and how budget interacts with compaction.
- [Turn loop](../operations/turn-loop.md) — where skill catalog and body
  injection happen during a turn.
