---
title: MCP (Model Context Protocol)
kind: concept
status: stable
sources:
  - codex-rs/codex-mcp/src/lib.rs
  - codex-rs/codex-mcp/src/connection_manager.rs
  - codex-rs/codex-mcp/src/tools.rs
  - codex-rs/codex-mcp/src/mcp/mod.rs
  - codex-rs/codex-mcp/src/elicitation.rs
  - codex-rs/codex-mcp/src/mcp/auth.rs
  - codex-rs/rmcp-client/src/rmcp_client.rs
  - codex-rs/rmcp-client/src/oauth.rs
  - codex-rs/builtin-mcps/src/lib.rs
  - codex-rs/mcp-server/src/lib.rs
  - codex-rs/mcp-server/src/message_processor.rs
  - codex-rs/mcp-server/src/codex_tool_config.rs
  - codex-rs/config/src/mcp_types.rs
  - codex-rs/core/src/tools/handlers/mcp.rs
related:
  - concepts/tools.md
  - concepts/sandboxing-approvals.md
  - concepts/connectors.md
  - concepts/plugins.md
last_reviewed: 2026-05-10
---

## TL;DR

Codex implements MCP twice: as a **client** (connecting to external MCP
servers and surfacing their tools to the model) and as a **server**
(letting other MCP clients drive Codex's own conversation engine via
two tools, `codex` and `codex-reply`).

On the client side, `McpConnectionManager` owns one `RmcpClient` per
configured server (over stdio, HTTP long-polling, or in-process for the
built-in `memories` server) and exposes a unified `list_all_tools` /
`call_tool` API that the rest of the harness routes through `McpHandler`.

## Where it lives in the code

- Client crate: `codex-rs/codex-mcp/` (top-level `lib.rs:1`).
- Connection manager: `codex-rs/codex-mcp/src/connection_manager.rs:72` —
  `McpConnectionManager`, `list_all_tools` (`:368`), `call_tool` (`:567`).
- Tool name mapping: `codex-rs/codex-mcp/src/tools.rs:28` — `ToolInfo`,
  normalization (`:138`).
- Approval policy: `codex-rs/codex-mcp/src/mcp/mod.rs:43` (constants),
  `:69` (auto-approve rules), elicitation in `elicitation.rs:1`.
- Auth: `codex-rs/codex-mcp/src/mcp/auth.rs`, OAuth tokens via
  `codex-rs/rmcp-client/src/oauth.rs`.
- RMCP transport: `codex-rs/rmcp-client/src/rmcp_client.rs:77`.
- Built-in MCP servers: `codex-rs/builtin-mcps/src/lib.rs:1`.
- Codex-as-MCP-server: `codex-rs/mcp-server/src/lib.rs:62`,
  `message_processor.rs:250`, tool schemas in
  `codex_tool_config.rs:21`.
- Config schema: `codex-rs/config/src/mcp_types.rs:118`
  (`McpServerConfig`), `:364` (`McpServerTransportConfig`).
- Client-side bridge to the tool dispatch loop:
  `codex-rs/core/src/tools/handlers/mcp.rs:20`.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Codex harness                          │
│                                                           │
│  Tool registry  ──►  McpHandler ──►  McpConnectionManager │
│                                            │              │
│                       ┌────────────────────┼────────┐     │
│                       ▼                    ▼        ▼     │
│                 RmcpClient(stdio)   RmcpClient(http) ...  │
└─────────────────────│──────────────────────│──────────────┘
                      │                      │
                  ┌───▼───┐              ┌───▼───┐
                  │ stdio │              │ HTTP  │
                  │ proc  │              │ MCP   │
                  └───────┘              └───────┘
                external MCP servers (or built-in in-process)


┌──────────────────────┐         ┌──────────────────────────┐
│  Other MCP clients   │ ──────► │  codex-mcp-server (binary)│
│  (Claude Desktop,    │ stdio   │   tools: codex, codex-reply│
│   etc.)              │         │   wraps a CodexThread     │
└──────────────────────┘         └──────────────────────────┘
```

## Client side

### Connection manager

`McpConnectionManager` (`connection_manager.rs:72`) holds a
`HashMap<String, AsyncManagedClient>` keyed by configured server name. It
is created with a map of `EffectiveMcpServer` entries (configured or
built-in), an auth status snapshot, the approval policy, and the
runtime environment (`:169`).

Public surface:

- `list_all_tools` (`:368`) — aggregates and normalizes tools across all
  servers.
- `call_tool(server, tool, args, meta)` (`:567`) — routes to the right
  client.
- `list_all_resources` / `list_all_resource_templates` /
  `read_resource` (`:430` onward) — paginated resource access.
- `parallel_tool_call_server_names` (`:133`) — feeds the parallel-tool
  config in [tools](tools.md).
- `begin_shutdown` / `shutdown` (`:102`) — drain clients, terminate
  stdio subprocesses cleanly.

Startup is concurrent (`:200`): for each enabled server, an async task
emits `McpStartupUpdateEvent(Starting)`, connects, initializes, lists
tools, and emits `McpStartupCompleteEvent` or `McpStartupFailure`.
Default startup timeout is `rmcp_client::DEFAULT_STARTUP_TIMEOUT`.

### Transports

`RmcpClient` (`rmcp-client/src/rmcp_client.rs:77`) covers three
transports:

| Variant | Use |
|---|---|
| `InProcess` | `tokio::io::DuplexStream` for built-in servers. |
| `Stdio` | `StdioServerTransport` — spawns subprocess, JSON-RPC over pipes. |
| `StreamableHttp` | `StreamableHttpClientTransport<…>` with optional `AuthClient` for OAuth. |

The MCP `Initialize` handshake discovers capabilities; resources,
prompts, and tools are listed afterward.

### Tool naming and namespacing

Constants in `mcp/mod.rs:43`:

- Prefix: `"mcp"`
- Delimiter: `"__"`
- `qualified_mcp_tool_name_prefix(server_name)` returns `"mcp__<server>__"`.

The resulting model-visible tool names look like
`mcp__github__list_repos`. `tools.rs:138` normalizes both server and
tool components to alphanumeric+underscore, ensures the result is ≤64
bytes, and appends a hash suffix on collision so each tool has a unique
callable name.

`ToolInfo` (`tools.rs:28`) is the metadata bundle:

- `server_name` — raw MCP server name (used for routing).
- `callable_namespace`, `callable_name` — sanitized model-facing names.
- `tool` — raw MCP `Tool` definition (sent verbatim to the server).
- `connector_id`, `connector_name` — provenance tracking back to the
  app/plugin that registered the connector.

### Configuration

TOML, under `[mcp_servers.<name>]`. `McpServerConfig` (`config/src/mcp_types.rs:118`):

- `enabled: bool` (default `true`)
- `required: bool` (fail session start if init fails)
- `supports_parallel_tool_calls: bool`
- `startup_timeout_sec`, `tool_timeout_sec`
- `default_tools_approval_mode` (`auto` / `prompt` / `approve`)
- `enabled_tools` / `disabled_tools` — allow/deny lists
- `scopes`, `oauth_resource` — for OAuth flow
- `tools.<name>.approval_mode` — per-tool override

Transport (`mcp_types.rs:364`):

```toml
# stdio
[mcp_servers.local_thing]
command = "/usr/bin/local-mcp"
args = ["--flag"]
env_vars = { local = ["MCP_TOKEN"] }

# HTTP long-polling
[mcp_servers.cloud_thing]
url = "https://api.example.com/mcp"
bearer_token_env_var = "EXAMPLE_TOKEN"
http_headers = { "X-Trace-Id" = "codex" }
```

### Approval flow

`mcp/mod.rs:69` decides per-call:

1. If the tool's approval mode is `Approve` → auto-approve.
2. If the policy is `Never` *and* the active permission profile
   already grants full disk write → auto-approve.
3. Otherwise: prompt (if policy != `Never`) or deny (if policy ==
   `Never`).

Server-initiated `createElicitation` requests (e.g. asking the user a
question, or confirming a destructive action) are routed through
`ElicitationRequestManager` (`elicitation.rs:1`), which decides between
auto-approve, auto-deny, or surfacing a TUI/app-server event.

### OAuth / auth

`rmcp-client/src/oauth.rs` stores tokens at
`~/.codex/mcp_oauth/<server_name>.json`. Discovery happens in the
server's `Initialize` response. Per-server bearer tokens can also be
sourced from environment variables via `bearer_token_env_var`. The
auth status (`mcp/auth.rs`) is computed before the connection manager
boots so disconnected servers can be flagged early.

### Built-in MCP servers

`codex-rs/builtin-mcps/src/lib.rs:1` ships one in-process server today:

- **`memories`** — exposed as `BuiltinMcpServer::Memories`. Launched in
  the same process via `codex-memories-mcp::run_server()`. Supports
  parallel tool calls; flagged as not polluting context.

Built-in servers connect over `RmcpClient::InProcess` (no subprocess
spawn).

## Codex as MCP server

The `mcp-server` crate exposes Codex itself as an MCP server, so Claude
Desktop (or any MCP client) can drive a Codex session.

Two tools (`mcp-server/src/message_processor.rs:325`):

| Tool | Input | Behavior |
|---|---|---|
| `codex` | `CodexToolCallParam` (prompt, model, sandbox, config overrides; `codex_tool_config.rs:21`) | Creates a new Codex session and runs the model + tools to completion. |
| `codex-reply` | `CodexToolCallReplyParam` (thread_id, prompt) | Continues an existing thread. |

Capabilities (`message_processor.rs:250`) advertise `tools` only —
resources, resource templates, and prompts return not-implemented or
minimal stubs (`:308`). Transport is stdin/stdout JSON-RPC
(`mcp-server/src/lib.rs:62`). Approval / elicitation requests for
exec/patch within the wrapped session are routed back through a callback
channel to the MCP client.

## Tool dispatch

When the model emits a function call whose name is `mcp__server__tool`:

1. The tool router parses the payload into
   `ToolPayload::Mcp { server, tool, raw_arguments }`
   (see [tools](tools.md)).
2. `McpHandler` (`core/src/tools/handlers/mcp.rs:20`) is the registered
   handler; it looks up the namespaced `ToolInfo` and calls
   `manager.call_tool(server, tool, args)`.
3. Pre-call, the per-server `ToolFilter` is consulted
   (`connection_manager.rs:575`); disabled tools error early.
4. Post-call, the response is wrapped in `McpToolOutput` (with `result`,
   `tool_input`, `wall_time`, `TruncationPolicy`) and serialized back
   to the model.
5. `Pre/PostToolUse` hooks fire around the call, with the namespaced
   tool name flattened for the hook payload.

## Edge cases & invariants

- Tool name collisions across servers are resolved by hash suffix —
  raw MCP names are preserved on `ToolInfo.tool.name` for the actual
  protocol call, while the model-visible name is unique.
- `required = true` servers cause session start to fail if init fails;
  default behavior is to log and proceed without that server's tools.
- Codex-as-MCP-server does not expose resources or prompts. External
  servers may, but Codex client uses *only* their tools for model
  context (resources are listed/read but not auto-injected).
- Per-server `supports_parallel_tool_calls` is what gates concurrent
  MCP calls in the tool router.

## Open questions / gaps

- Exact behavior when a streaming HTTP MCP server drops mid-call — does
  the harness retry, or surface error to the model?
- What `meta` is allowed on `call_tool` and how it propagates to the
  server (telemetry, trace headers, etc.).

## See also

- [Tools](tools.md) — the dispatch loop that ultimately calls
  `McpHandler`.
- [Connectors](connectors.md) — directory of preconfigured MCP-style
  apps.
- [Sandboxing & approvals](sandboxing-approvals.md) — how MCP tool
  approval composes with general approval policy.
- [Plugins](plugins.md) — plugins can register MCP servers.
