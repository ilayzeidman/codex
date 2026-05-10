---
title: Sandboxing & approvals
kind: concept
status: stable
sources:
  - codex-rs/sandboxing/src/lib.rs
  - codex-rs/sandboxing/src/manager.rs
  - codex-rs/sandboxing/src/seatbelt.rs
  - codex-rs/sandboxing/src/landlock.rs
  - codex-rs/sandboxing/src/bwrap.rs
  - codex-rs/sandboxing/src/policy_transforms.rs
  - codex-rs/execpolicy/src/policy.rs
  - codex-rs/execpolicy/src/rule.rs
  - codex-rs/execpolicy/src/decision.rs
  - codex-rs/core/src/tools/sandboxing.rs
  - codex-rs/core/src/tools/orchestrator.rs
  - codex-rs/process-hardening
related:
  - concepts/tools.md
  - concepts/hooks.md
last_reviewed: 2026-05-10
---

## TL;DR

The harness gates tool execution through two cooperating subsystems:
`SandboxManager` (transforms a command into one wrapped by the active
platform sandbox) and the approval flow in `core/src/tools/sandboxing.rs`
(decides whether the user must say yes, and caches that yes for
subsequent identical calls). `execpolicy` provides an allow/deny rule
engine consulted before either kicks in.

## Where it lives in the code

- Public API: `codex-rs/sandboxing/src/lib.rs:13` — `SandboxManager`,
  `SandboxType`, `SandboxablePreference`, `SandboxExecRequest`.
- `SandboxType` enum: `codex-rs/sandboxing/src/manager.rs:23` —
  `None | MacosSeatbelt | LinuxSeccomp | WindowsRestrictedToken`.
- Platform selection: `manager.rs:48` — `get_platform_sandbox`.
- Per-platform implementations: `seatbelt.rs`, `landlock.rs`,
  `bwrap.rs`, plus the `codex-rs/linux-sandbox/`,
  `codex-rs/windows-sandbox-rs/`, and `codex-rs/bwrap/` crates that
  hold larger native glue.
- Policy transforms: `sandboxing/src/policy_transforms.rs` — convert a
  `PermissionProfile` into `SandboxExecRequest`.
- Rule engine: `codex-rs/execpolicy/src/policy.rs`,
  `rule.rs`, `decision.rs` — `ExecPolicy`, `Rule`, `Decision`.
- Approval cache: `codex-rs/core/src/tools/sandboxing.rs:42` —
  `ApprovalStore`, `with_cached_approval` (`:72`).
- Orchestrator: `codex-rs/core/src/tools/orchestrator.rs:41` —
  `ToolOrchestrator` and the run sequence (`:57`).
- Process hardening: `codex-rs/process-hardening/` — once the harness
  itself starts, it locks down its own privileges.

## Sandbox flavors

| Variant | Platform | Backed by |
|---|---|---|
| `MacosSeatbelt` | macOS | `/usr/bin/sandbox-exec` + sbpl profiles (`seatbelt_base_policy.sbpl`, `seatbelt_network_policy.sbpl`, `restricted_read_only_platform_defaults.sbpl`). |
| `LinuxSeccomp` | Linux | seccomp + Landlock (`landlock.rs`) and Bubblewrap (`bwrap.rs`) for filesystem and network containment. |
| `WindowsRestrictedToken` | Windows | restricted token + custom hardening (`windows-sandbox-rs`). |
| `None` | any | command runs unwrapped (only for explicit opt-out). |

`SandboxablePreference` (`manager.rs:42`) is the user's preference
stack: `Auto`, `Require`, `Forbid`. `SandboxManager` reconciles
preference with what the platform actually supports (`manager.rs:148`).

## Approval flow

`ApprovalStore` (`tools/sandboxing.rs:42`) is a HashMap keyed on the
serialized approval request. `with_cached_approval` (`:72`) checks if
all requested keys are already approved, skipping prompts when so.

`ToolOrchestrator::run` (`orchestrator.rs:57`):

1. **Begin network approval** — defers if a `NetworkApproval` token is
   needed for the call.
2. **Build a `SandboxAttempt`** with the requested permissions.
3. **Run** under the chosen sandbox.
4. **Finish deferred network approval** — releases or denies the
   reservation post-hoc.
5. **Escalate on denial** — recreates the attempt with broader
   permissions and retries; the cached approval is reused so the user
   isn't re-prompted.

Approvals can also be sourced from a Guardian service for managed
deployments — the `sandboxing.rs` gateway routes to it when configured.

## execpolicy

`execpolicy` is the rule engine consulted to classify shell commands
before they reach the sandbox.

- `Rule` trait (`rule.rs:214`) implemented by concrete rule kinds
  (`PrefixRule` at `:111`, `NetworkRule` at `:149`).
- `Policy` (`policy.rs:28`) — bundled rules with provenance.
- `Decision` (`decision.rs:9`) — outcome (Allow / Deny / Prompt).
- `execpolicycheck.rs` — entry point for evaluating a candidate command.

Rules cover binary path patterns, network operations, and
context-specific overrides (e.g. allow `git status` but prompt on
`git push --force`).

## Permission profiles

A *permission profile* names a coherent bundle of capabilities (e.g.
"read-only project", "write project", "full disk read-only"). The
profile is what the user toggles via the TUI's permissions menu and
what `policy_transforms.rs` reads to construct
`SandboxExecRequest`s. The active profile is part of the
`SessionConfiguration` (`core/src/session/session.rs:40`).

## Edge cases & invariants

- The harness never runs a tool *without* deciding which `SandboxType`
  to use first (`SandboxType::None` is itself an explicit decision).
- `manager.rs:148` short-circuits to `SandboxType::None` only when
  `SandboxablePreference::Forbid` is set.
- Approval keys are stable across the session, so escalating from
  read-only to read-write on the same call doesn't double-prompt.
- `process-hardening` applies to the harness binary itself — child
  processes are sandboxed by the per-platform variant above, not by
  this layer.
- The `CODEX_SANDBOX=*` environment markers documented in
  `AGENTS.md` are how downstream code (and tests) detect that they
  are running inside a sandbox.

## See also

- [Tools](tools.md) — the dispatch loop that hands off to the
  orchestrator.
- [Hooks](hooks.md) — `PermissionRequest` hook can short-circuit the
  approval prompt.
- [MCP](mcp.md) — MCP tool approvals plug into the same flow.
