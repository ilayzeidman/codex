---
name: dev-server
description: Start a local web dev server (Vite, Next.js, CRA, generic `npm run dev`) from a sandboxed codex shell without tripping Windows process-spawn gotchas. Use when the user asks to "start the dev server", "run the dev server", "serve this app", "npm run dev", "open in browser", or otherwise needs a long-running local HTTP server before browser verification. Solves three repeatedly-hit traps: PowerShell `Start-Process npm` failing without `.cmd`, foreground dev-server commands tripping the shell timeout, and Vite picking a different port than configured when `strictPort: false`.
---

# Dev Server

## Objective

Start a long-running local dev server, return the **actual** URL it bound to (not the configured one), and leave it running for the rest of the codex session. Do this in **one** tool call, not eight.

## When to use

- User asks to "start the dev server", "run `npm run dev`", "serve this app", "open `<folder>` in browser", or any phrasing that implies a long-running local HTTP server.
- Before browser verification flows (the Chrome DevTools MCP needs a URL to navigate to).
- Vite, Next.js, Create React App, Vue CLI, generic `npm run dev` / `pnpm dev` / `yarn dev`.

## When NOT to use

- One-shot commands that exit (`npm run build`, `npm test`, `tsc`). Run those in the foreground with the normal shell tool.
- Production servers (`npm start` in prod mode, `node server.js` for a real service).
- Any command you expect to complete in under a few seconds.

## The three Windows gotchas (the killer set)

These have cost ~14 turns combined across two prior codex sessions in this repo. Internalize them:

1. **`npm` is not `npm.cmd`.** PowerShell's `Start-Process -FilePath npm` fails resolution. **Always** use `npm.cmd` (or `npx.cmd`, `pnpm.cmd`, `yarn.cmd`). The bare name only works from inside an existing PowerShell session, not from `Start-Process`.
2. **Dev servers don't exit.** Running `npm.cmd run dev` in the foreground inside the shell tool will *always* trip the shell timeout, regardless of whether Vite started successfully. Exit code 124 / "command timed out after N milliseconds" on a dev-server command is not a failure — it usually means it worked. **Never run a dev-server command in the foreground.** Always background-spawn with stdout/stderr redirected to files.
3. **Configured port ≠ bound port.** `vite.config.ts` with `strictPort: false` (Vite's default) silently picks the next free port if the configured one is occupied. The server may say "ready" but be on `5181`, not `5180`. Always read the actual port from the log's `Local: http://...:PORT` line. Never assume the configured one.

## Workflow (5 steps)

Run the helper script. It encodes the working pattern from the first codex session in this repo that successfully started Vite:

```pwsh
pwsh -NoProfile -File .codex/skills/dev-server/scripts/start_dev_server.ps1 `
  -Cwd <absolute-path-to-project> `
  -Cmd "npm run dev"
```

The script:

1. Resolves `npm` → `npm.cmd` (and `npx`/`pnpm`/`yarn` similarly) automatically on Windows.
2. Background-spawns via `Start-Process -WindowStyle Hidden` with stdout + stderr redirected to log files in `$env:TEMP`.
3. Polls the stdout log every 250ms for a "Local: http://..." (or "ready on", or "started server on") line.
4. GETs the extracted URL with `Invoke-WebRequest -TimeoutSec 2 -UseBasicParsing` to confirm liveness.
5. Prints one JSON line to stdout: `{"pid":<n>,"url":"<u>","log":"<p>","status":"started"}` and exits 0.

On timeout, the script prints the last 50 lines of stderr and exits 1. On finding an already-running dev server for this `-Cwd` (via the sidecar `.codex-devserver.pid` file), it returns the existing `{pid, url}` with `"status":"already-running"` instead of starting a duplicate.

## Liveness check (if you need to verify mid-session)

```pwsh
Invoke-WebRequest -Uri <url> -TimeoutSec 2 -UseBasicParsing | Select-Object StatusCode
```

Or `curl --max-time 2 -s -o NUL -w "%{http_code}" <url>` if curl is available.

**Do NOT use `Get-NetTCPConnection -LocalPort <port>`.** It requires admin privileges on some Windows hosts and silently returns empty even when the port is bound — that exact false negative cost three turns of detective work in T8–T10 of session `019e24fe-865d-7af0-a28b-dee152a48eaf`.

## Teardown

Codex does not auto-kill spawned processes when the session ends (per `codex-rs/app-server/src/request_processors/thread_processor.rs:688` — `finalize_thread_teardown` is thread-scoped, not process-scoped). The script writes the PID to `<cwd>/.codex-devserver.pid`. When you're done, tell the user:

> "I left the dev server running as PID `<n>` on `<url>`. Stop it with `taskkill /T /F /PID <n>` (or `powershell -NoProfile -File .codex/skills/dev-server/scripts/start_dev_server.ps1 -Cwd <cwd> -Stop`)."

**Why `taskkill /T /F /PID` and not `Stop-Process -Id`?** `npm.cmd run dev` spawns a cmd.exe wrapper that re-spawns `node.exe` (Vite). `Stop-Process` only kills the wrapper — the node child keeps running and the port stays bound. `taskkill /T` walks the descendant tree.

## Platform note

This skill is currently **Windows / PowerShell only** — both observed pain sessions were on Windows and the gotchas are all PowerShell-specific. On macOS / Linux, run the underlying commands inline:

```bash
cd <cwd> && npm run dev > /tmp/dev-server.out 2> /tmp/dev-server.err &
echo $! > .codex-devserver.pid
# Then poll /tmp/dev-server.out for the "Local: http://..." line.
```

If the unix workflow grows its own gotchas in a future session, add a `start_dev_server.sh` alongside the `.ps1`.

## Verification

```pwsh
pwsh -NoProfile -File .codex/skills/dev-server/scripts/start_dev_server.ps1 `
  -Cwd C:\Development\research\codex\harnessLlmFlowViewer
```

Expected output (JSON, one line):

```json
{"pid":12345,"url":"http://127.0.0.1:5180/","log":"C:\\Users\\...\\AppData\\Local\\Temp\\codex-devserver-<hash>.out.log","status":"started"}
```

Then `Invoke-WebRequest http://127.0.0.1:5180/` returns 200.
