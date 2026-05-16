import { Session, OutputItem, Request, isToolCall } from '../types';

export type ConversationStep =
  | PrewarmStep
  | UserMessageStep
  | UserContextStep
  | DeveloperMessageStep
  | AssistantMessageStep
  | ReasoningStep
  | ToolPairStep
  | ToolGroupStep
  | ToolCallUnpairedStep
  | UnknownStep;

interface StepBase {
  stepIndex: number;
  requestIndex: number;
}

export interface PrewarmStep extends StepBase {
  kind: 'prewarm';
  /** Tool count + instructions size pulled from the prewarm request, if present. */
  toolCount: number;
  instructionsChars: number;
  totalTokens?: number;
}

export interface UserMessageStep extends StepBase {
  kind: 'user_message';
  text: string;
  raw: any;
}

/** Project-context message injected by the harness (e.g. AGENTS.md, environment_context).
 *  Still `role: user` on the wire, but visually it's harness-side context, not the human's typed prompt. */
export interface UserContextStep extends StepBase {
  kind: 'user_context';
  /** Compact label, e.g. "AGENTS.md instructions" or "environment_context". */
  label: string;
  text: string;
  raw: any;
}

export interface DeveloperMessageStep extends StepBase {
  kind: 'developer_message';
  text: string;
  raw: any;
}

export interface AssistantMessageStep extends StepBase {
  kind: 'assistant_message';
  text: string;
  raw: any;
}

export interface ReasoningStep extends StepBase {
  kind: 'reasoning';
  durationMs?: number;
  raw: any;
}

export type ToolStatus = 'ok' | 'error' | 'blocked' | 'unknown';

export interface ToolPairStep extends StepBase {
  kind: 'tool_pair';
  toolKind: 'function_call' | 'custom_tool_call';
  name: string;
  callId?: string;
  /** JSON args (function_call) or freeform input (custom_tool_call). */
  callBody: string;
  callIsJson: boolean;
  outputBody: string;
  outputRequestIndex: number;
  status: ToolStatus;
  exitCode?: number;
  wallTimeMs?: number;
  failureReason?: string;
}

/** N adjacent tool_pair steps with the same name folded into one collapsible group. */
export interface ToolGroupStep extends StepBase {
  kind: 'tool_group';
  name: string;
  toolKind: 'function_call' | 'custom_tool_call';
  members: ToolPairStep[];
  okCount: number;
  errorCount: number;
  blockedCount: number;
}

export interface ToolCallUnpairedStep extends StepBase {
  kind: 'tool_call_unpaired';
  toolKind: 'function_call' | 'custom_tool_call';
  name: string;
  callId?: string;
  callBody: string;
  callIsJson: boolean;
}

export interface UnknownStep extends StepBase {
  kind: 'unknown';
  typeLabel: string;
  raw: any;
}

/** Session-level policy chips extracted from the first developer + environment_context messages. */
export interface SessionPolicy {
  sandbox?: string;
  approval?: string;
  cwd?: string;
  shell?: string;
}

export interface ConversationModel {
  steps: ConversationStep[];
  policy: SessionPolicy;
  failureCount: number;
}

/** Build a single linear narrative across all requests.
 *
 *  Codex chains requests via the Responses API's `previous_response_id` — each
 *  request's `requestBody.input` carries only what is NEW since the prior response
 *  (the user prompt on request 2, tool outputs on subsequent requests). The full
 *  conversation is therefore the concatenation, in request order, of every
 *  request's `requestBody.input` followed by that request's `outputs`.
 *
 *  Tool call ↔ tool output pairing matches `call_id` across the rope so
 *  parallel tool calls (one request emits N calls, next request injects N outputs
 *  in their own order) pair correctly. */
export function buildConversationModel(session: Session): ConversationModel {
  const requests = session.requests;
  if (requests.length === 0) return { steps: [], policy: {}, failureCount: 0 };

  // call_id → originating request index for echoed-back tool calls.
  const callIdToRequest = new Map<string, number>();
  // IDs that originated as outputs in some prior request. When the harness
  // resumes a session after an interrupt, codex re-injects the entire prior
  // conversation as the next request's `input` — including function_calls,
  // assistant messages, and reasoning items that were originally outputs.
  // We use these sets to recognise replays and skip them, otherwise the
  // conversation pane shows every step twice.
  const outputCallIds = new Set<string>();
  for (const request of requests) {
    for (const out of request.outputs) {
      if (isToolCall(out) && out.callId && !callIdToRequest.has(out.callId)) {
        callIdToRequest.set(out.callId, request.index);
      }
      if (isToolCall(out) && out.callId) outputCallIds.add(out.callId);
    }
  }

  // The rope: every request's input items + outputs, in request order. Prewarm
  // requests (empty input AND empty outputs) are inserted as a synthetic step
  // so users see them rather than wonder why "Request 1" silently disappears.
  type Entry = { source: 'input' | 'output' | 'prewarm'; requestIndex: number; raw: any };
  const rope: Entry[] = [];
  // Track which function_call_output call_ids we've already injected so a
  // duplicate replayed by a later request's input doesn't add a phantom row.
  const seenOutputCallIds = new Set<string>();
  for (const request of requests) {
    const inputs: any[] = Array.isArray(request.requestBody?.input) ? request.requestBody.input : [];
    if (inputs.length === 0 && request.outputs.length === 0) {
      rope.push({ source: 'prewarm', requestIndex: request.index, raw: request });
      continue;
    }
    for (const it of inputs) {
      if (isResumeReplay(it, outputCallIds, seenOutputCallIds)) continue;
      rope.push({ source: 'input', requestIndex: request.index, raw: it });
      if (isOutputType(it) && it?.call_id) seenOutputCallIds.add(it.call_id);
    }
    for (const out of request.outputs) rope.push({ source: 'output', requestIndex: request.index, raw: out });
  }

  // Pre-index tool outputs by call_id so a tool call can claim its match
  // even when the call is one of N parallel calls (outputs come back in
  // their own order, not paired-adjacent).
  const outputIndicesByCallId = new Map<string, number[]>();
  for (let i = 0; i < rope.length; i++) {
    const e = rope[i];
    if (e.source === 'input' && isOutputType(e.raw) && e.raw.call_id) {
      const arr = outputIndicesByCallId.get(e.raw.call_id) ?? [];
      arr.push(i);
      outputIndicesByCallId.set(e.raw.call_id, arr);
    }
  }

  const raw: ConversationStep[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < rope.length; i++) {
    if (consumed.has(i)) continue;
    const entry = rope[i];
    const item = entry.raw;

    if (entry.source === 'prewarm') {
      const request = item as Request;
      raw.push({
        stepIndex: raw.length + 1,
        requestIndex: request.index,
        kind: 'prewarm',
        toolCount: Array.isArray(request.requestBody?.tools) ? request.requestBody.tools.length : 0,
        instructionsChars: typeof request.requestBody?.instructions === 'string'
          ? request.requestBody.instructions.length
          : 0,
        totalTokens: request.usage?.total_tokens,
      });
      continue;
    }

    if (entry.source === 'output' && isToolCallOutputItem(item) && item.callId) {
      const candidates = outputIndicesByCallId.get(item.callId) ?? [];
      const outIdx = candidates.find(idx => idx > i && !consumed.has(idx));
      if (outIdx !== undefined) {
        const outEntry = rope[outIdx];
        const toolKind: 'function_call' | 'custom_tool_call' = item.kind;
        const callBody = toolKind === 'function_call'
          ? (item as any).argsJson ?? ''
          : (item as any).input ?? '';
        const outputBody = stringifyOutput(outEntry.raw.output);
        const { status, exitCode, wallTimeMs, failureReason } = classifyOutput(outputBody, item.name);
        raw.push({
          stepIndex: raw.length + 1,
          requestIndex: entry.requestIndex,
          kind: 'tool_pair',
          toolKind,
          name: item.name,
          callId: item.callId,
          callBody: String(callBody),
          callIsJson: toolKind === 'function_call',
          outputBody,
          outputRequestIndex: outEntry.requestIndex,
          status,
          exitCode,
          wallTimeMs,
          failureReason,
        });
        consumed.add(outIdx);
        continue;
      }
    }

    raw.push(toSingleStep(item, entry.source, entry.requestIndex, callIdToRequest, raw.length + 1));
  }

  const grouped = groupAdjacentToolCalls(raw);
  const renumbered = grouped.map((s, i) => ({ ...s, stepIndex: i + 1 }));
  const policy = extractSessionPolicy(renumbered);
  const failureCount = renumbered.reduce((acc, s) => {
    if (s.kind === 'tool_pair' && (s.status === 'error' || s.status === 'blocked')) return acc + 1;
    if (s.kind === 'tool_group') return acc + s.errorCount + s.blockedCount;
    return acc;
  }, 0);
  return { steps: renumbered, policy, failureCount };
}

/** Back-compat shim — older callers can keep using buildConversationSteps. */
export function buildConversationSteps(session: Session): ConversationStep[] {
  return buildConversationModel(session).steps;
}

function isToolCallOutputItem(item: any): boolean {
  return item?.kind === 'function_call' || item?.kind === 'custom_tool_call';
}

function isOutputType(it: any): boolean {
  return it?.type === 'function_call_output' || it?.type === 'custom_tool_call_output';
}

/** When codex resumes a session after an interrupt, the next request's `input`
 *  carries the entire prior conversation as a sequence of replayed items —
 *  function_calls the model previously emitted, the assistant messages it
 *  streamed, and its encrypted reasoning blobs. These all already appear in
 *  earlier requests' `outputs`, so showing them again clutters the conversation
 *  flow with phantom "awaiting output" rows. Detect them here. */
function isResumeReplay(
  it: any,
  outputCallIds: Set<string>,
  seenOutputCallIds: Set<string>,
): boolean {
  if (!it || typeof it !== 'object') return false;
  // function_call as input → always a replay (model only emits these as outputs).
  if (it.type === 'function_call' || it.type === 'custom_tool_call') {
    return Boolean(it.call_id && outputCallIds.has(it.call_id));
  }
  // function_call_output appears once normally (in the request after the call).
  // If we've already injected one for this call_id, the duplicate is a replay.
  if (isOutputType(it)) {
    return Boolean(it.call_id && seenOutputCallIds.has(it.call_id));
  }
  // Assistant messages and reasoning in `input` come from the model, so any
  // occurrence in the input array is by definition a replay of a prior output.
  if (it.type === 'message' && it.role === 'assistant') return true;
  if (it.type === 'reasoning') return true;
  return false;
}

function stringifyOutput(out: any): string {
  if (typeof out === 'string') return out;
  if (out === undefined || out === null) return '';
  return JSON.stringify(out, null, 2);
}

function extractMessageText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** Codex tool outputs follow a predictable prefix. Parse it once at build
 *  time so the collapsed UI row can show ✓/⛔/✗ + wall time without
 *  reading the whole body. */
function classifyOutput(
  body: string,
  toolName: string,
): { status: ToolStatus; exitCode?: number; wallTimeMs?: number; failureReason?: string } {
  if (!body) return { status: 'unknown' };
  // apply_patch / custom tools — rejection lines come first.
  const rejected = body.match(/^(?:[^\n]*?)?(patch rejected|rejected by [^\n]+|denied|blocked by[^\n]*)/im);
  if (rejected) {
    return { status: 'blocked', failureReason: rejected[1].trim() };
  }
  // Codex shell_command wraps stdout/err with these headers.
  const exitMatch = body.match(/Exit code:\s*(-?\d+)/);
  const wallMatch = body.match(/Wall time:\s*([\d.]+)\s*seconds?/i);
  if (exitMatch) {
    const exitCode = Number(exitMatch[1]);
    const wallTimeMs = wallMatch ? Math.round(Number(wallMatch[1]) * 1000) : undefined;
    return {
      status: exitCode === 0 ? 'ok' : 'error',
      exitCode,
      wallTimeMs,
      failureReason: exitCode !== 0 ? extractFirstErrorLine(body) : undefined,
    };
  }
  // MCP-style tools (chrome_devtools, etc.) — codex prepends a `Wall time:` header
  // and a JSON payload like `[{"type":"text","text":"..."}]`. Their presence
  // means the tool transport succeeded; content keywords inside the JSON
  // (`[error]` console lines, "Unable to navigate" pages, etc.) describe the
  // *world*, not the tool call. Treat as ok and let the user inspect the body.
  if (wallMatch) {
    return { status: 'ok', wallTimeMs: Math.round(Number(wallMatch[1]) * 1000) };
  }
  // Some tools return a success/error JSON or string. Heuristics:
  if (/^success\b/i.test(body)) return { status: 'ok' };
  if (toolName === 'apply_patch' && /Success\./i.test(body)) return { status: 'ok' };
  if (/^error\b|cannot|failed|not recognized/i.test(body)) {
    return { status: 'error', failureReason: extractFirstErrorLine(body) };
  }
  return { status: 'unknown' };
}

function extractFirstErrorLine(body: string): string | undefined {
  // After "Output:\n", grab the first non-empty error-y line.
  const after = body.split(/^Output:\s*$/m)[1] ?? body;
  const lines = after.split('\n').map(l => l.trim()).filter(Boolean);
  for (const l of lines) {
    if (/error|fail|denied|not recognized|cannot/i.test(l)) return l.slice(0, 200);
  }
  return lines[0]?.slice(0, 200);
}

/** Fold runs of adjacent tool_pair steps sharing the same `name` into a single
 *  collapsible `tool_group`. Reduces 11 parallel `Select-String` calls to one
 *  row with status totals. Threshold = 2; a lone tool call stays a tool_pair. */
function groupAdjacentToolCalls(steps: ConversationStep[]): ConversationStep[] {
  const out: ConversationStep[] = [];
  let i = 0;
  while (i < steps.length) {
    const cur = steps[i];
    if (cur.kind !== 'tool_pair') {
      out.push(cur);
      i++;
      continue;
    }
    let j = i + 1;
    while (j < steps.length) {
      const next = steps[j];
      if (next.kind !== 'tool_pair') break;
      if (next.name !== cur.name) break;
      // Group across one-request-apart pairs too (parallel tool calls span N+1's
      // input fold). Same request or adjacent: collapse.
      if (Math.abs(next.requestIndex - cur.requestIndex) > 1) break;
      j++;
    }
    if (j - i >= 2) {
      const members = steps.slice(i, j) as ToolPairStep[];
      const okCount = members.filter(m => m.status === 'ok').length;
      const errorCount = members.filter(m => m.status === 'error').length;
      const blockedCount = members.filter(m => m.status === 'blocked').length;
      out.push({
        stepIndex: cur.stepIndex,
        requestIndex: cur.requestIndex,
        kind: 'tool_group',
        name: cur.name,
        toolKind: cur.toolKind,
        members,
        okCount,
        errorCount,
        blockedCount,
      });
      i = j;
    } else {
      out.push(cur);
      i++;
    }
  }
  return out;
}

/** Pull sandbox/approval/cwd/shell from the first developer + user_context
 *  messages so the toolbar can render a one-glance policy bar. */
function extractSessionPolicy(steps: ConversationStep[]): SessionPolicy {
  const policy: SessionPolicy = {};
  for (const step of steps) {
    if (step.kind === 'developer_message') {
      // Codex emits: `sandbox_mode` is `read-only`: ...
      // Tolerate backticks around the field and value, and an optional
      // "currently" / "is set to" between "is" and the value.
      const sand = step.text.match(/`?sandbox_mode`?\s+(?:is(?:\s+set\s+to)?|=)\s+(?:currently\s+)?`?([\w-]+)`?/i);
      if (sand && !policy.sandbox) policy.sandbox = sand[1];
      // "Approval policy is currently never." or "Approval policy: never"
      const appr = step.text.match(/[Aa]pproval\s+policy\s*(?:is|:)\s*(?:currently\s+)?`?([\w-]+)`?/);
      if (appr && !policy.approval) policy.approval = appr[1];
    }
    if (step.kind === 'user_context' && step.label === 'environment_context') {
      const cwd = step.text.match(/<cwd>([^<]+)<\/cwd>/);
      if (cwd && !policy.cwd) policy.cwd = cwd[1];
      const shell = step.text.match(/<shell>([^<]+)<\/shell>/);
      if (shell && !policy.shell) policy.shell = shell[1];
    }
    if (policy.sandbox && policy.approval && policy.cwd && policy.shell) break;
  }
  return policy;
}

/** Detect harness-injected project context vs the human's typed prompt.
 *  Both arrive on the wire as `role: user`, but content shape distinguishes:
 *  - `<environment_context>...</environment_context>` is codex's pre-prompt
 *  - `# AGENTS.md instructions ...` is project context the harness scrapes
 *  - anything else is treated as the human's prompt */
function classifyUserMessage(text: string): { kind: 'user_context'; label: string } | { kind: 'user_message' } {
  const trimmed = text.trim();
  if (/^<environment_context>/i.test(trimmed)) {
    return { kind: 'user_context', label: 'environment_context' };
  }
  if (/^# AGENTS\.md\b/i.test(trimmed)) {
    return { kind: 'user_context', label: 'AGENTS.md project context' };
  }
  if (/^# CLAUDE\.md\b/i.test(trimmed)) {
    return { kind: 'user_context', label: 'CLAUDE.md project context' };
  }
  return { kind: 'user_message' };
}

function toSingleStep(
  item: any,
  source: 'input' | 'output' | 'prewarm',
  requestIndex: number,
  callIdToRequest: Map<string, number>,
  stepIndex: number,
): ConversationStep {
  if (source === 'output') {
    const out = item as OutputItem;
    if (out.kind === 'message') {
      return { stepIndex, requestIndex, kind: 'assistant_message', text: out.text, raw: out };
    }
    if (out.kind === 'reasoning') {
      const duration = out.doneTs !== undefined ? out.doneTs - out.addedTs : undefined;
      return { stepIndex, requestIndex, kind: 'reasoning', durationMs: duration, raw: out };
    }
    if (out.kind === 'function_call' || out.kind === 'custom_tool_call') {
      const callBody = out.kind === 'function_call' ? out.argsJson : out.input;
      return {
        stepIndex,
        requestIndex,
        kind: 'tool_call_unpaired',
        toolKind: out.kind,
        name: out.name,
        callId: out.callId,
        callBody,
        callIsJson: out.kind === 'function_call',
      };
    }
    return { stepIndex, requestIndex, kind: 'unknown', typeLabel: (out as any).kind ?? 'unknown', raw: out };
  }

  // source === 'input'
  if (item?.type === 'message') {
    const text = extractMessageText(item.content);
    const role: string = item.role ?? 'user';
    if (role === 'user') {
      const c = classifyUserMessage(text);
      if (c.kind === 'user_context') {
        return { stepIndex, requestIndex, kind: 'user_context', label: c.label, text, raw: item };
      }
      return { stepIndex, requestIndex, kind: 'user_message', text, raw: item };
    }
    if (role === 'developer' || role === 'system') {
      return { stepIndex, requestIndex, kind: 'developer_message', text, raw: item };
    }
    return { stepIndex, requestIndex, kind: 'assistant_message', text, raw: item };
  }
  if (item?.type === 'reasoning') {
    return { stepIndex, requestIndex, kind: 'reasoning', raw: item };
  }
  if (item?.type === 'function_call' || item?.type === 'custom_tool_call') {
    const toolKind: 'function_call' | 'custom_tool_call' = item.type;
    const callBody = toolKind === 'function_call'
      ? String(item.arguments ?? '')
      : String(item.input ?? '');
    const callRequest = item.call_id ? (callIdToRequest.get(item.call_id) ?? requestIndex) : requestIndex;
    return {
      stepIndex,
      requestIndex: callRequest,
      kind: 'tool_call_unpaired',
      toolKind,
      name: String(item.name ?? '<unnamed>'),
      callId: item.call_id,
      callBody,
      callIsJson: toolKind === 'function_call',
    };
  }
  if (item?.type === 'function_call_output' || item?.type === 'custom_tool_call_output') {
    return { stepIndex, requestIndex, kind: 'unknown', typeLabel: item.type, raw: item };
  }
  return { stepIndex, requestIndex, kind: 'unknown', typeLabel: String(item?.type ?? 'item'), raw: item };
}

/** Pretty-render a tool name with namespace separators. Handles:
 *  - `mcp__server__action` → ["mcp", "server", "action"]
 *  - `claude_ai_Google_Drive__do_thing` → ["claude_ai_Google_Drive", "do_thing"]
 *  - plain names → [name] */
export function splitToolName(name: string): string[] {
  if (!name) return ['<unnamed>'];
  if (name.includes('__')) return name.split('__');
  return [name];
}

/** Heuristic toolkit-of-origin from the tool name. */
export function toolOrigin(name: string): 'mcp' | 'skill' | 'builtin' {
  if (/^mcp[_:]|^mcp__/.test(name)) return 'mcp';
  if (/^skill[_:]/.test(name)) return 'skill';
  return 'builtin';
}
