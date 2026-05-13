# Codex Harness · LLM Flow Viewer

A local React + Vite app that parses a `--debug-llm-dump` session folder
and renders the per-turn LLM flow as a navigable, annotated UI. Pairs with
the [debug-llm-dump operations page](../wiki/operations/debug-llm-dump.md).

Everything is parsed in the browser — no upload, no backend.

## What it shows

For each session folder (named after the codex `thread_id`):

- **Overview** — a timeline bar per turn, scaled by wall-clock duration,
  annotated with tool-call count, message indicator, and token total.
- **Turn detail** — for each turn:
  - **Outbound `response.create`**: input items, tools exposed, system
    instructions size, plus a structured preview of each input item
    (developer prompt, user prompt, prior `function_call` /
    `function_call_output`).
  - **Reconstructed output items**, in arrival order: reasoning blobs,
    streamed assistant messages (text reassembled from
    `output_text.delta` frames), function calls with their JSON
    arguments (reassembled from `function_call_arguments.delta`).
  - **Timings**: time-to-first-delta, per-item start/end offsets,
    total turn duration.
  - **Token usage** pulled from `response.completed.usage`.
  - Collapsed views of the full raw event list and the verbatim
    `response.create` / `response.completed` JSON for the turn.
- **Insights** — per-turn duration vs token bars, tool-call frequency,
  and a histogram over every WS event type observed.
- **Raw event log** — searchable + filterable view over every NDJSON
  line, with JSON inspector on click.

## Supported inputs

- WebSocket transport dump: `manifest.json` + `ws-events.ndjson` (e.g.
  ChatGPT-authed sessions).
- HTTP transport dump: `manifest.json` + numbered triplets
  `NNNNNN-<ts>-request.json`, `NNNNNN-<ts>-stream.ndjson`,
  `NNNNNN-<ts>-response.json`.

Both shapes coexist if a session uses both transports.

## Run it

```powershell
cd C:\Development\research\codex\harnessLlmFlowViewer
npm install
npm run dev
```

Then open the printed URL (default <http://localhost:5180>), drop a
session folder onto the page (or click **Choose folder**). The folder
you drop is the one named after the thread UUID, e.g.
`C:\tmp\dump-metering\019e1ab2-ce48-7791-8758-ad9e680d780d\`.

## Capture a fresh dump to view

The cheat sheet (PowerShell + bash + loops + VS Code extension notes)
lives in the wiki:
**[wiki/operations/debug-llm-dump.md → Cheat sheet](../wiki/operations/debug-llm-dump.md#cheat-sheet--capture-more-dumps)**.

Two most common one-liners:

```powershell
# PowerShell — single prompt
$env:CODEX_DEBUG_LLM_DUMP = 'C:\tmp\codex-dump'
$codex = 'C:\Development\research\codex\codex-rs\target\debug\codex.exe'
cmd /c "$codex exec --skip-git-repo-check ""your prompt here"" < NUL"
```

```bash
# Git Bash — single prompt
export CODEX_DEBUG_LLM_DUMP='C:/tmp/codex-dump'
/c/Development/research/codex/codex-rs/target/debug/codex.exe \
  exec --skip-git-repo-check "your prompt here" < /dev/null
```

`--skip-git-repo-check` is required if your shell's working directory
isn't inside a git repo — codex refuses by default with
`Not inside a trusted directory…`. The flag belongs to the `exec`
subcommand, so it must come **after** `exec`. Alternative: use root
flag `-C C:\Development\research\codex` before `exec` to point codex
at the codex source tree (which is a git repo).

Each `codex exec` produces one new `<thread-uuid>` folder under
`$CODEX_DEBUG_LLM_DUMP`. Drop that folder onto the viewer to inspect
it. Longer story (loops, TUI capture, VS Code extension) → cheat sheet
above.

For a worked example walking through a real prompt + dump, see
[`../codex-dump-walkthrough.md`](../codex-dump-walkthrough.md).

## Production build

```powershell
npm run build       # produces dist/
npm run preview     # serves dist/ on localhost
```

The output in `dist/` is fully static — drop it on any static host or
open `dist/index.html` through a tiny local server (`npx serve dist`).
The app does **not** talk to the network at runtime.

## Layout

```
src/
├── App.tsx                  # top-level layout + view switcher
├── main.tsx                 # React entry
├── index.css                # tailwind base + scrollbar/json tweaks
├── types.ts                 # Session / Turn / OutputItem types
├── parser.ts                # NDJSON + HTTP-triplet → Session
├── lib/
│   └── format.ts            # duration, bytes, iso, clock helpers
└── components/
    ├── FolderPicker.tsx     # drag-drop / directory picker entry
    ├── SessionHeader.tsx    # manifest banner + totals
    ├── TurnList.tsx         # sidebar nav (overview / insights / raw / turns)
    ├── Overview.tsx         # timeline + "what you're looking at" panel
    ├── TurnDetail.tsx       # per-turn breakdown
    ├── Insights.tsx         # bar charts
    ├── RawEventLog.tsx      # filterable NDJSON log
    ├── JsonView.tsx         # dark-themed react-json-view-lite wrapper
    └── Stat.tsx             # numeric tile
```

## How turn segmentation works

A turn begins on each outbound `response.create` (sent) and ends on the
next `response.completed` (received). Events between those two
brackets are attributed to the turn, plus the `response.create` itself
so the turn detail can render the full outbound payload.

For HTTP-transport dumps the segmentation is one turn per
request-stream-response triplet — they're sorted by sequence number.

## What gets reconstructed

| Stream of frames | Reconstructed into |
|---|---|
| `response.output_item.added` (type=message) + `output_text.delta` × N + `output_text.done` | One `ReconstructedMessage` with the full text |
| `response.output_item.added` (type=function_call) + `function_call_arguments.delta` × N + `function_call_arguments.done` | One `ReconstructedFunctionCall` with the full JSON args (parsed when valid) |
| `response.output_item.added` (type=reasoning) + `response.output_item.done` | One `ReconstructedReasoning` placeholder — encrypted reasoning content is not stored in the dump in plaintext |
| `response.completed.response.usage` | `TokenUsage` (input / cached / output / reasoning / total) |
| `codex.rate_limits` | Attached to the turn |

See [`src/parser.ts`](src/parser.ts) for the authoritative state
machine.
