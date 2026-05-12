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
injects full `SKILL.md` bodies only for explicit mentions it can resolve
before sampling. Otherwise the model sees only the catalog and must open the
skill file itself with normal file-reading tools.

Skills are how Codex packages reusable, model-driven workflows (e.g.
`code-review`, `babysit-pr`, `skill-creator`) without baking them into the
binary or requiring a tool definition per workflow.

## Harness <-> model flow

```text
Session / turn context build
    |
    v
Harness builds a Responses API request
  instructions = base instructions
  input += developer message with <skills_instructions>...</skills_instructions>
  tools = normal tool list only
    |
    v
User submits a turn
    |
    v
Harness scans UserInput for explicit skill mentions
  - structured UserInput::Skill
  - text mentions like $skill-name
  - linked mentions pointing at a specific SKILL.md path
    |
  +---------+---------+
  |                   |
  v                   v
no explicit match     explicit match resolves
  |                   |
  |             Harness reads matching SKILL.md
  |             and appends a user fragment:
  |             <skill><name>...<path>...body...</skill>
  |                   |
  +---------+---------+
    |
    v
Model receives the request
  - it can follow an already-injected skill body
  - or, from the catalog alone, decide to open a skill file itself
    using ordinary file/search/shell tools
    |
    v
Later shell/file actions can be recognized as "implicit invocation"
for telemetry, but that does not itself inject a skill body
```

## Where it lives in the code

- Data model: `codex-rs/core-skills/src/model.rs:11` — `SkillMetadata`,
  `SkillScope`, `SkillLoadOutcome`.
- Discovery + parsing: `codex-rs/core-skills/src/loader.rs:159` —
  `load_skills_from_roots`; `discover_skills_under_root` (`:456`);
  `parse_skill_file` (`:599`); `extract_frontmatter` (`:957`).
- Caching/lifecycle: `codex-rs/core-skills/src/manager.rs:51` —
  `SkillsManager`; `skills_for_config` at `:90`.
- Prompt rendering: `codex-rs/core-skills/src/render.rs:160` —
  `build_available_skills`. The `<skills_instructions>` envelope tags
  come from `codex-rs/protocol/src/protocol.rs:96`.
- On-demand injection: `codex-rs/core-skills/src/injection.rs:25` —
  `SkillInjection`; `build_skill_injections` at `:31`.
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
  indexes used to recognize later shell/file access as implicit invocation.

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

`extract_frontmatter` (`loader.rs:957`) requires the leading `---` block;
missing frontmatter raises `SkillParseError::MissingFrontmatter`. If `name`
is omitted the loader falls back to the parent directory name. Optional
`agents/openai.yaml` alongside the skill directory carries the `interface`,
`dependencies`, `policy` metadata (see e.g. `.codex/skills/babysit-pr/agents/openai.yaml`).

## Discovery flow

`SkillsManager::skills_for_config` resolves the skill root list from the
config layer stack, then `load_skills_from_roots` walks each root.

Roots, in scope order (`loader.rs:267` `skill_roots_from_layer_stack_inner`,
plus repo roots from `repo_agents_skill_roots` at `:342`):

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

There are three different mechanisms, and it helps to keep them separate:

### 1. What is sent in the initial model request

The provider request is assembled in `core/src/client.rs:716` as a
`ResponsesApiRequest { instructions, input, tools, ... }`.

For skills, the important split is:

- `instructions` = the base instruction string for the model.
- `input` = the conversation history plus injected context fragments.
- `tools` = normal model-visible tools; **skills are not listed here**.

So there is no dedicated "skill API" on the wire. Skills are represented as
ordinary input messages plus prompt conventions.

### 2. Catalog injection (thread / turn context build)

`render.rs:160` (`build_available_skills`) selects skills for the prompt;
the actual body is rendered by `render_available_skills_body` (`render.rs:62`),
wrapped in `<skills_instructions>` … `</skills_instructions>` by the
session before injection (tags from `protocol/src/protocol.rs:96`).

The session adds that fragment during `build_initial_context`
(`core/src/session/mod.rs:2567` and `:2679`) as a **developer-role** message
via `AvailableSkillsInstructions`
(`core/src/context/available_skills_instructions.rs:8`).

What the model sees in that block is a catalog, not the full skill bodies:

It includes:

- A skill-roots alias table (when used) so paths can be referenced as
  short prefixes without spending tokens on absolute paths.
- One line per skill: `name + description + path`.
- Trigger rules and progressive-disclosure guidance (constants at
  `render.rs:27`).

A budget cap of ~2 % of the context window (8000 char baseline,
`render.rs:17`) truncates descriptions when too many skills are present
and emits warnings.

This is the only skills-related content guaranteed to be present before the
model decides what to do.

### 3. Explicit skill-body injection (before first sample of a turn)

When a user turn starts, `run_turn` (`core/src/session/turn.rs:132`) resolves
explicit skill mentions **before** the first sampling request.

The flow is:

1. `collect_explicit_skill_mentions` (`core-skills/src/injection.rs:115`) scans
   the incoming `UserInput` values.
2. It recognizes:
   - structured `UserInput::Skill { name, path }`
   - text mentions such as `$skill-name`
   - linked mentions that point at a concrete skill path
3. `build_skill_injections` (`core-skills/src/injection.rs:31`) reads the
   matching `SKILL.md` files from the per-skill filesystem.
4. `run_turn` turns them into `SkillInstructions` and records them into
   conversation history before calling `run_sampling_request`
   (`core/src/session/turn.rs:272`, `:353`, `:460`).

Each injected body is a **user-role** message fragment rendered as:

```text
<skill>
<name>...</name>
<path>...</path>
...full SKILL.md contents...
</skill>
```

The wrapper lives in `core/src/context/skill_instructions.rs:6`.

This means the model does **not** ask the harness to inject a skill via a
special function call. The harness decides up front, from the user's turn
input, whether a matching skill body should already be in `input`.

### 4. What the model itself chooses

Once the request is in flight, the model can make only normal model choices:

- Follow a skill body that the harness already injected.
- Read the catalog in `<skills_instructions>` and decide that a skill is
  relevant even though no body was pre-injected.
- Open the listed `SKILL.md` path itself using standard file/search/shell
  tools, because the catalog explicitly tells it to do that.

That last case is important: the catalog text in `render.rs` tells the model,
in plain language, "after deciding to use a skill, open its `SKILL.md`".
So the current design is a hybrid:

- explicit user mention -> harness pre-injects the full body
- implicit model choice -> model reads the file itself

There is no mid-turn "please inject skill X now" API.

### 5. What "implicit invocation" means in code

`implicit_skills_by_scripts_dir` and `implicit_skills_by_doc_path` are used by
`detect_implicit_skill_invocation_for_command`
(`core-skills/src/invocation_utils.rs:29`).

Today this is mainly used when the model later runs shell/exec commands that:

- execute a script under a skill's `scripts/` directory, or
- read the skill's `SKILL.md` with commands like `cat`, `sed`, `head`, etc.

The shell and unified-exec handlers call
`maybe_emit_implicit_skill_invocation` (`core/src/skills.rs:174`; used from
`tools/handlers/shell/shell_command.rs:219` and
`tools/handlers/unified_exec/exec_command.rs:185`).

That path records telemetry/metrics for `InvocationType::Implicit`; it does
**not** load and inject the skill body into context.

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
  into context. On the wire they appear as `input` messages, not as entries
  in the model's `tools[]` list.
- Same-named skill in two scopes: the higher-rank scope wins; the lower
  is dropped from the visible list (still loaded into outcome metadata
  for auditing).
- Discovery reads only frontmatter. The full `SKILL.md` body is read later
  only when the harness performs explicit-body injection, or when the model
  itself opens the file using ordinary tools.
- The system-skill installer is fingerprinted: re-extraction is keyed on
  embedded asset hash, so version bumps refresh the cache automatically.
- `policy.allow_implicit_invocation == false` removes the skill from the
  automatic matching/telemetry indexes, but the skill is still listed in the
  visible catalog and can still be injected by explicit mention.

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
