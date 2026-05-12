---
title: Debug LLM dump
kind: operation
status: draft
sources:
  - codex-rs/codex-client/src/dump.rs
  - codex-rs/codex-client/src/transport.rs
  - codex-rs/codex-api/src/endpoint/responses_websocket.rs
  - codex-rs/core/src/client.rs
  - codex-rs/core/src/session/session.rs
  - codex-rs/cli/src/main.rs
  - codex-rs/config/src/config_toml.rs
  - codex-rs/core/src/config/mod.rs
related:
  - concepts/streaming.md
  - concepts/sessions-rollouts.md
  - concepts/model-providers.md
last_reviewed: 2026-05-12
---

## TL;DR

Set `--debug-llm-dump <DIR>` (or `CODEX_DEBUG_LLM_DUMP=<DIR>`, or
`debug_llm_dump_dir = "..."` in `config.toml`) to record every outbound
LLM API call to disk, keyed per session. Two transports are captured:
HTTP (Responses API + compact + memories summarize + Realtime SDP) and
WebSocket (the Responses-over-WS transport that codex defaults to for
ChatGPT-authed sessions). Each session's dump folder is named for its
`thread_id`, matching the rollout file under `~/.codex/sessions/`.
Sensitive headers (`authorization`, `*cookie*`, `x-api-key`) are
redacted to `[REDACTED]`. Use this to learn exactly what the harness
sends to the model and what it gets back.

## Where it lives in the code

- Dumper core: [`codex-rs/codex-client/src/dump.rs`](../../codex-rs/codex-client/src/dump.rs) —
  `DumpConfig`, `Manifest`, `SessionDumper`, `DumpingTransport<T>`,
  `AnyTransport`, `DumpStream` (the async SSE-stream tee).
- HTTP hook: [`codex-rs/codex-client/src/transport.rs:26-30`](../../codex-rs/codex-client/src/transport.rs#L26-L30) —
  the `HttpTransport` trait. `DumpingTransport<T>` wraps any inner
  transport (it implements the same trait).
- WS hook: [`codex-rs/codex-api/src/endpoint/responses_websocket.rs`](../../codex-rs/codex-api/src/endpoint/responses_websocket.rs) —
  the `WsStream::new` pump task taps every `sent` / `received` frame
  with `dump_ws_frame` before forwarding it. The `connect_websocket`
  function also writes a `connect` event with the WS URL.
- Construction: [`codex-rs/core/src/session/session.rs:817-844`](../../codex-rs/core/src/session/session.rs#L817-L844) —
  builds the optional `SessionDumper` and `Manifest` at session init
  from `config.debug_llm_dump_dir`. Passed into [`ModelClient::new`](../../codex-rs/core/src/client.rs#L311).
- Per-call wiring: [`codex-rs/core/src/client.rs`](../../codex-rs/core/src/client.rs) —
  `ModelClient::make_transport()` (line 362) returns
  `AnyTransport::Dumping(...)` when a dumper is present; replaces
  every previous `ReqwestTransport::new(build_reqwest_client())` site
  (lines 462, 550, 581, 1262). The WS path passes
  `self.state.dumper.clone()` into `ApiWebSocketResponsesClient::connect`
  at line 847.
- CLI flag: [`codex-rs/cli/src/main.rs`](../../codex-rs/cli/src/main.rs) —
  `DebugDumpOptions` (around line 719). Folded into
  `root_config_overrides.raw_overrides` so it propagates to every
  subcommand the same way `--enable` / `--disable` do.
- Config: [`codex-rs/config/src/config_toml.rs`](../../codex-rs/config/src/config_toml.rs)
  (`pub debug_llm_dump_dir: Option<PathBuf>`) and
  [`codex-rs/core/src/config/mod.rs:712`](../../codex-rs/core/src/config/mod.rs#L712)
  (same field on `Config`, populated by the builder at line 3100).

## Data types

- `DumpConfig { root_dir: PathBuf, extra_redacted_headers: Vec<String> }` —
  caller-supplied configuration. `extra_redacted_headers` lets a host
  add more header names to redact on top of the defaults.
- `Manifest` — codex version, session id, thread id, session source,
  started-at timestamps, model provider id, model name, redaction
  list. Written lazily on the first dump write to
  `<dir>/<thread-uuid>/manifest.json`.
- `SessionDumper(Arc<SessionDumperInner>)` — clone-cheap. Owns one
  per-session folder and its monotonic `AtomicU64` sequence counter.
  Methods:
  - `for_session(&cfg, label, manifest)` — root sessions; label is
    typically the thread UUID.
  - `no_session(&cfg)` — early-startup calls before a session exists;
    writes under `<root>/_no-session/`.
  - `dump_ws_event(direction, payload)` — appends one NDJSON line to
    `ws-events.ndjson`.
- `DumpingTransport<T: HttpTransport>` — decorator. Implements
  `HttpTransport` so it slots in transparently.
- `AnyTransport { Plain(ReqwestTransport), Dumping(DumpingTransport<...>) }` —
  enum dispatch so callers keep a stable concrete return type whether
  dumping is on or off. Avoids `Box<dyn HttpTransport>` which would
  force changes to every `T: HttpTransport` generic bound in
  `codex-api`.
- `DumpStream` — wraps the SSE `ByteStream` returned by
  `HttpTransport::stream`. On each `poll_next`: synchronously appends
  one NDJSON line to `*-stream.ndjson`, accumulates the body, forwards
  the chunk. On end-of-stream or error, flushes the aggregated
  `*-response.json`. `Drop` flushes as a safety net.

## On-disk layout

```
<dump-dir>/
  <thread-uuid>/
    manifest.json                       # one per session, written on first call
    NNNNNN-<unix-ms>-request.json       # HTTP request: method, url, redacted headers, body
    NNNNNN-<unix-ms>-stream.ndjson      # HTTP SSE: one JSON line per chunk with elapsed_ms
    NNNNNN-<unix-ms>-response.json      # HTTP response: status, headers, aggregated body
    ...                                 # next request gets NNNNNN+1
    ws-events.ndjson                    # WS: one JSON line per frame, chronological
  <other-thread-uuid>/                  # another session = separate folder
    ...
  _no-session/                          # early-startup calls without a session id (optional)
    ...
```

Notes:
- `<thread-uuid>` matches the rollout file name under
  `~/.codex/sessions/YYYY/MM/DD/rollout-...-<thread-uuid>.jsonl`. Use
  it to correlate the dump with the rollout 1:1.
- `NNNNNN` is a per-session monotonic counter shared across all
  request paths in that session (a turn that compacts + summarizes
  memories + makes a model call will see seq increment for each).
- Retries inside the streaming retry loop ([client.rs:1242](../../codex-rs/core/src/client.rs#L1242))
  each get their own sequence number, so you can see how many
  attempts the harness made.

## WS event schema (`ws-events.ndjson`)

Each line is a single JSON object:

```jsonc
{
  "ts_ms": 1778563761956,             // wall-clock millis since epoch
  "direction": "connect"               // | "sent" | "received" | "closed"
                | "sent" | "received" | "closed",
  "body": { ... } | "<text>" | "<close>" | "<url-stub>"
}
```

`body` is the parsed JSON payload when the frame is valid JSON,
otherwise a string. The `connect` event records a `{"url": "wss://..."}`
stub so you can see which endpoint the WS attached to. `Ping` / `Pong` /
`Frame` (continuation) frames are intentionally NOT recorded — they're
transport plumbing, not application-level messages.

Typical event flow for one user turn:

```
connect          (wss://…/v1/responses)        ← only on cold connect; reused across turns
sent             response.create                ← request payload incl. tools, prompt, instructions
received         response.created               ← server confirms receipt
received         response.in_progress           ← model began generating
received         response.output_item.added     ← first item starting
received         response.content_part.added
received         response.output_text.delta     ← streamed text chunks
received         response.output_text.delta
received         response.output_text.delta
received         response.output_text.done      ← final text for this part
received         response.content_part.done
received         response.output_item.done
received         codex.rate_limits              ← rate-limit envelope codex appended
received         response.completed             ← end of turn
```

Codex usually opens with a **prewarm** request (`generate: false`) on a
new WS connection, then sends the real `response.create`. Both appear
as their own `sent` events — you'll see two `response.create` cycles
in a single fresh-connection turn. See
[`stream_responses_websocket`](../../codex-rs/core/src/client.rs#L1356)
for the prewarm logic.

## HTTP file schema

`NNNNNN-<unix-ms>-request.json`:

```jsonc
{
  "method": "POST",
  "url": "https://.../v1/responses",
  "headers": [
    {"name": "Authorization", "value": "[REDACTED]"},
    {"name": "Content-Type", "value": "application/json"},
    ...
  ],
  "body": { ... }                                     // the harness's payload, pre-serialization
}
```

`NNNNNN-<unix-ms>-stream.ndjson` (one line per SSE chunk):

```jsonc
{
  "chunk": 0,                                          // monotonic per stream
  "elapsed_ms": 134,                                   // since stream open
  "bytes_len": 412,
  "body": "data: { ... }\n\n"
}
```

`NNNNNN-<unix-ms>-response.json`:

```jsonc
{
  "status": 200,
  "headers": [...],
  "elapsed_ms": 2731,
  "body": { ... },                                     // aggregated body if JSON-parseable
  "truncated_by_error": "stream broke ..."             // only present if mid-stream error
  "stream_chunks": 87                                  // only present for streaming responses
}
```

## Configuration

Three equivalent ways to enable, in clap precedence order:

1. CLI flag: `codex --debug-llm-dump C:\path\to\dumps exec "..."`
2. Env var: `CODEX_DEBUG_LLM_DUMP=C:\path\to\dumps`
3. Config TOML: add to `~/.codex/config.toml`:
   ```toml
   debug_llm_dump_dir = "C:/path/to/dumps"
   ```

The flag is `global = true`, so it works as a root flag for every
subcommand (`codex exec`, the interactive TUI, `codex review`, etc.).
It does **not** automatically propagate to `codex responses-api-proxy`
— that subcommand has its own `--dump-dir` flag with similar
semantics (see [`responses-api-proxy/src/dump.rs`](../../codex-rs/responses-api-proxy/src/dump.rs)).

## Redaction

Header values redacted to `[REDACTED]` (case-insensitive match):

- `authorization`
- any header name containing `cookie` (matches `cookie`, `set-cookie`,
  `cookie-jar`, etc.)
- `x-api-key`
- plus anything in `DumpConfig.extra_redacted_headers`

Bodies are dumped verbatim. If a body contains a secret in the JSON
payload (e.g. a user prompt that quotes credentials), that secret will
appear in the dump. Treat the dump directory like the rollout
directory — local-only, not for sharing.

## How to read a dump

For learning what the harness sends/receives end-to-end on a single
turn:

1. Open `manifest.json` first to see session id, thread id, model,
   provider, and start timestamp. Cross-reference the rollout file at
   `~/.codex/sessions/.../rollout-...-<thread-uuid>.jsonl`.
2. For ChatGPT-authed sessions, the whole turn is in
   `ws-events.ndjson`. Sort by `ts_ms` (already chronological). Scan
   for `direction == "sent"` to find each request payload, then read
   forward through the `received` events to see the model's response
   in order.
3. For non-WS providers (custom HTTP endpoints, OSS via Ollama/LM
   Studio, or any time the WS path falls back to HTTP), each turn is
   one HTTP exchange: `*-request.json` → `*-stream.ndjson` →
   `*-response.json`. `stream.ndjson` shows arrival timing per chunk.
4. A single turn may produce multiple sequence numbers — e.g.
   compaction calls a separate compact endpoint, memory summarization
   calls another, and the streaming retry loop counts each attempt.
   Read the `*-request.json` body to know which endpoint each one
   targeted.

## Session boundaries

One folder = one Codex session. The folder name is the session's
`thread_id` (the same UUID embedded in the rollout filename). When a
new `codex exec` or interactive session starts, a fresh folder is
created with a fresh sequence counter at `1`. Subagent flows that
fork a child thread create a separate folder for the child.

The `manifest.json` `session_source` field disambiguates roots
(`"Exec"`, `"TUI"`, etc.) from subagent sessions
(`"SubAgent { ... }"`).

## Operational characteristics

- **I/O is synchronous from inside `Stream::poll_next` (HTTP) and the
  WS pump task (WS).** Per-chunk write latency is tens of µs and SSE
  chunks arrive at human latency, so blocking the runtime is
  negligible in practice. If perf ever matters, the upgrade path is
  an `mpsc` writer task. See `DumpStream::append_chunk` and
  `dump_ws_frame` for the current direct-write paths.
- **Errors during dump never propagate.** All I/O is wrapped in
  `let _ =` with `tracing::warn!` on failure. The dump is best-effort;
  a failed write does not affect the actual model call.
- **Concurrency safety.** `SessionDumper` is `Clone` over an `Arc`
  with `AtomicU64` for the sequence counter, so two concurrent
  streams in the same session get distinct sequence numbers without
  contention. Each stream's own files are not shared, so there is no
  file-level write contention.

## Known gaps / follow-ups

- The memories-write subagent at
  [`codex-rs/memories/write/src/runtime.rs:175`](../../codex-rs/memories/write/src/runtime.rs#L175)
  constructs its own `ModelClient` with `dumper: None`. Its LLM calls
  for memory summarization are therefore not captured in the dump
  even when `--debug-llm-dump` is set. To fix, thread the parent
  thread's `SessionDumper` through `MemoriesWriteRuntime`.
- The `model-provider` catalog-fetch path at
  [`codex-rs/model-provider/src/models_endpoint.rs:91`](../../codex-rs/model-provider/src/models_endpoint.rs#L91)
  runs before any session exists; it is not yet wrapped with
  `SessionDumper::no_session` (the plan called this out as optional
  if plumbing through `build_models_manager` proved invasive). To
  capture it, plumb `Option<Arc<DumpConfig>>` through
  `build_models_manager` and wrap the transport.
- `cargo test -p codex-client dump` requires the MSVC `INCLUDE`/`LIB`
  env vars set (e.g. by launching from a "Developer PowerShell for
  VS 2022") and NASM installed (`winget install NASM.NASM`),
  because the dev-dep `rcgen` transitively pulls in `aws-lc-sys`
  which needs both. Unit tests for the dumper are written but have
  not yet been run under that environment.

## Verification

```powershell
# From a fresh shell:
$env:CODEX_DEBUG_LLM_DUMP = 'C:\tmp\codex-dump'

# Run two sessions back-to-back to demonstrate boundaries:
cmd /c "C:\Development\research\codex\codex-rs\target\debug\codex.exe exec ""Say hi in exactly three words."" < NUL"
cmd /c "C:\Development\research\codex\codex-rs\target\debug\codex.exe exec ""Write a haiku about Rust."" < NUL"

# Inspect:
Get-ChildItem -Recurse C:\tmp\codex-dump
# Expected: two <thread-uuid> folders, each containing manifest.json + ws-events.ndjson
```

For a one-line summary of the chronological event flow:

```powershell
Get-Content "C:\tmp\codex-dump\<thread-uuid>\ws-events.ndjson" |
  ForEach-Object { $o = $_ | ConvertFrom-Json; "{0,8} {1,9} {2}" -f
    $o.direction, ($o.ts_ms % 100000), $o.body.type }
```

## See also

- [Streaming](../concepts/streaming.md) — the underlying HTTP/SSE
  pipeline this feature taps into.
- [Sessions & rollouts](../concepts/sessions-rollouts.md) — where
  `thread_id` and the rollout filenames come from.
- [Model providers](../concepts/model-providers.md) — provider config,
  including `supports_websockets` which decides HTTP vs WS transport.
