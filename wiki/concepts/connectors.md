---
title: Connectors
kind: concept
status: draft
sources:
  - codex-rs/connectors/src/lib.rs
  - codex-rs/connectors/src/directory_cache.rs
  - codex-rs/connectors/src/filter.rs
  - codex-rs/connectors/src/merge.rs
  - codex-rs/connectors/src/metadata.rs
  - codex-rs/connectors/src/accessible.rs
  - codex-rs/plugin/src/lib.rs
related:
  - concepts/mcp.md
  - concepts/plugins.md
last_reviewed: 2026-05-10
---

## TL;DR

A **connector** is a directory entry describing an external service
(GitHub, Slack, Notion, etc.) the user can browse and authorize. The
`connectors` crate caches a remote directory of these entries
(`DirectoryApp`s), filters by accessibility, and exposes them to the
TUI and to plugins. Connectors typically resolve to MCP servers when
the user installs them, so the link to model context goes through
[MCP](mcp.md).

## Where it lives in the code

- Public API: `codex-rs/connectors/src/lib.rs:24` —
  `ConnectorDirectoryCacheKey`, `DirectoryApp`,
  `ConnectorDirectoryCacheContext`.
- Cache: `connectors/src/directory_cache.rs` (TTL ~1 hour).
- Filter / merge / metadata: `filter.rs`, `merge.rs`, `metadata.rs`.
- Accessibility checks: `accessible.rs`.
- Plugin link: `codex-rs/plugin/src/lib.rs:20` — `AppConnectorId` is
  the identifier that ties a plugin manifest entry to a connector.

## DirectoryApp

A `DirectoryApp` is the catalog record for a connector — id, name,
description, branding, and references to the install artifact (for
example a plugin manifest). The directory itself is fetched from a
remote endpoint and cached locally; `merge.rs` merges fetched entries
with locally-installed-only entries.

`accessible.rs` decides which connectors are *currently* connectable
(based on auth status, network, etc.) so the UI can grey-out or hide
unavailable items.

## Edge cases & invariants

- Cache TTL is short (~1h) so the directory stays fresh without
  hammering the remote endpoint.
- Connectors do not call the model directly; they are a discoverability
  layer over plugins/MCP servers.

## Open questions / gaps

- The exact endpoint serving the directory.
- Whether auth flows live in `connectors` or are deferred to MCP / the
  plugin manager.

## See also

- [MCP](mcp.md) — connectors typically register an MCP server when
  installed.
- [Plugins](plugins.md) — connector entries map to plugin manifests
  via `AppConnectorId`.
