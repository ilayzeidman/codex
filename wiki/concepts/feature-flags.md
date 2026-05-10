---
title: Feature flags
kind: concept
status: stable
sources:
  - codex-rs/features/src/lib.rs
  - codex-rs/features/src/feature_configs.rs
  - codex-rs/features/src/legacy.rs
related:
  - concepts/context-management.md
  - concepts/skills.md
  - concepts/multi-agent.md
last_reviewed: 2026-05-10
---

## TL;DR

The `features` crate is a typed registry of harness-wide feature flags
with an explicit lifecycle stage per flag (`UnderDevelopment`,
`Experimental`, `Stable`, `Deprecated`, `Removed`). Flags are merged
from config sources and resolved into a `Features` set used to gate
behavior across the codebase.

## Where it lives in the code

- Public API: `codex-rs/features/src/lib.rs:26` — `Stage`, `Feature`,
  `Features`, `FeatureOverrides`, `FeatureConfigSource`.
- Config parsing: `features/src/feature_configs.rs`.
- Legacy mappings: `features/src/legacy.rs` — `LegacyFeatureToggles`
  bridges old TOML keys (e.g. `web_search_request`) to current
  `Feature` enum variants.

## Stage lifecycle

```rust
// features/src/lib.rs:26
pub enum Stage {
    UnderDevelopment,
    Experimental { name, … },
    Stable,
    Deprecated,
    Removed,
}
```

Only `Experimental` carries display metadata (`name`, an
`announcement` string). `UnderDevelopment` flags are visible only to
internal builds; `Removed` flags reject configuration that still
references them.

## How flags are resolved

1. `FeatureConfigSource` collects per-layer config (`features` TOML
   block) — workspace, user, session.
2. `FeatureOverrides::apply` merges into a `Features` set, recording
   `LegacyFeatureUsage` entries for any flag set via a legacy alias
   (so the user can be warned).
3. The result is a `BTreeSet<Feature>` exposed to the rest of the
   codebase.

`feature.stage()` lets call sites special-case experimental UI affordances
(e.g. only show in `/experimental`).

## Examples of features mentioned elsewhere in this wiki

- `MemoryTool` — gates the memory developer-instruction injection
  ([context management](context-management.md)).
- `ChildAgentsMd` — enables nested AGENTS.md hierarchy
  ([context management](context-management.md)).
- `WebSearchRequest` — legacy alias `web_search_request` (`legacy.rs`).

## Edge cases & invariants

- `Stable` flags can still be turned off explicitly; they're "stable"
  in the sense of API surface, not "always on".
- Legacy aliases survive removal of a feature only if the underlying
  `Feature` variant still exists (otherwise resolution errors).

## See also

- [Context management](context-management.md) — `MemoryTool` /
  `ChildAgentsMd` consumers.
- [Skills](skills.md) — `bundled_skills_enabled` is configured in
  the skills section, not features, but interacts with the same
  layered config model.
