---
title: Plugins
kind: concept
status: draft
sources:
  - codex-rs/plugin/src/lib.rs
  - codex-rs/plugin/src/load_outcome.rs
  - codex-rs/plugin/src/plugin_id.rs
  - codex-rs/core-plugins/src/lib.rs
  - codex-rs/core-plugins/src/manager.rs
  - codex-rs/core-plugins/src/loader.rs
  - codex-rs/core-plugins/src/manifest.rs
  - codex-rs/core-plugins/src/marketplace.rs
  - codex-rs/core-plugins/src/store.rs
related:
  - concepts/skills.md
  - concepts/hooks.md
  - concepts/mcp.md
  - concepts/connectors.md
last_reviewed: 2026-05-10
---

## TL;DR

A **plugin** is a versioned bundle that can contribute one or more of:
skills, hooks, MCP servers, or app connectors. Plugins are identified by
a `PluginId` (`namespace/name@marketplace`) and live in marketplaces
(`openai-curated`, `openai-bundled`, `user-local`). `PluginsManager`
(`core-plugins/src/manager.rs`) loads installed plugins and folds their
contributions into the session's skill, hook, MCP, and connector
registries.

## Where it lives in the code

- Identity & summary types: `codex-rs/plugin/src/lib.rs:15` re-exports
  `PluginId`; `AppConnectorId` at `:20`,
  `PluginCapabilitySummary` at `:23`, `PluginHookSource` at `:33`.
- Manager: `codex-rs/core-plugins/src/manager.rs` — `PluginsManager`,
  `LoadedPlugin`.
- Loader: `core-plugins/src/loader.rs`.
- Manifest schema: `core-plugins/src/manifest.rs`.
- Marketplaces: `core-plugins/src/marketplace.rs`,
  `installed_marketplaces.rs`, `marketplace_add.rs`,
  `marketplace_remove.rs`, `marketplace_upgrade.rs`.
- Remote / bundle distribution: `core-plugins/src/remote.rs`,
  `remote_bundle.rs`, `remote_legacy.rs`.
- Local store: `core-plugins/src/store.rs`.
- Startup sync: `core-plugins/src/startup_sync.rs`,
  `startup_remote_sync.rs`.
- Toggles: `core-plugins/src/toggles.rs`.

## Plugin contributions

A single plugin manifest can declare any subset of:

- **Skills** — directories shipped inside the plugin become
  `SkillScope::User` skills tagged with `plugin_id`. See
  [skills](skills.md).
- **Hooks** — `PluginHookDeclaration`s registered in
  `codex-rs/hooks/src/declarations.rs`. See [hooks](hooks.md).
- **MCP servers** — manifest entries that produce
  `EffectiveMcpServer::Configured` records consumed by
  `McpConnectionManager`. See [MCP](mcp.md).
- **App connectors** — referenced via `AppConnectorId`
  (`plugin/src/lib.rs:20`); see [connectors](connectors.md).

`PluginCapabilitySummary` (`plugin/src/lib.rs:23`) is the compact
listing the harness uses to render the "available plugins" block in
the system prompt and the TUI plugin manager.

## Marketplaces and distribution

A *marketplace* is a logical source of plugins:

- **`openai-curated`** — fetched remotely.
- **`openai-bundled`** — included with the binary.
- **`user-local`** — manually installed paths.

`marketplace_add` / `marketplace_remove` / `marketplace_upgrade`
(`core-plugins/src/marketplace_*.rs`) implement the lifecycle.
`startup_sync.rs` / `startup_remote_sync.rs` reconcile local state
with remote manifests at session start.

`PluginId` parses `namespace/name@marketplace` (`plugin_id.rs`) so the
same plugin name can coexist in multiple marketplaces.

## Lifecycle

1. **Install / upgrade** — manifests fetched, contents extracted to a
   per-plugin directory.
2. **Load** — `PluginsManager` reads each enabled plugin's manifest and
   builds `LoadedPlugin`s.
3. **Merge** — skills, hooks, MCP servers, and connectors are merged
   into their respective registries before session bootstrap.
4. **Toggle** — `toggles.rs` controls per-plugin enable/disable without
   uninstall.
5. **Uninstall** — store + marketplace bookkeeping; outstanding state
   in skills/hooks/MCP is dropped at next session start.

## Edge cases & invariants

- A plugin can be enabled and still contribute nothing if its manifest
  is empty — the registries simply skip it.
- Skill name collisions between plugin and repo follow the standard
  scope ranking (Repo > User > System).
- A plugin's MCP servers are subject to the same approval/auth flow as
  user-configured ones — the plugin namespace doesn't grant any
  additional trust.

## Open questions / gaps

- Exact manifest schema (TOML keys for skills/hooks/MCP/connectors) —
  see `core-plugins/src/manifest.rs`.
- The signing / attestation model for remote marketplace plugins.
- How `request_plugin_install` (a built-in tool, see [tools](tools.md))
  composes with the marketplace lifecycle.

## See also

- [Skills](skills.md) — most plugins ship at least one skill.
- [Hooks](hooks.md) — plugins are the typical hook source.
- [MCP](mcp.md) — plugins can ship configured MCP servers.
- [Connectors](connectors.md) — connector directory entries.
