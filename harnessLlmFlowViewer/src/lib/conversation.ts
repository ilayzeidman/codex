import { Session, OutputItem, isToolCall } from '../types';

export type ConversationStep =
  | UserMessageStep
  | DeveloperMessageStep
  | AssistantMessageStep
  | ReasoningStep
  | ToolPairStep
  | ToolCallUnpairedStep
  | UnknownStep;

interface StepBase {
  stepIndex: number;
  turnIndex: number;
}

export interface UserMessageStep extends StepBase {
  kind: 'user_message';
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

export interface ToolPairStep extends StepBase {
  kind: 'tool_pair';
  toolKind: 'function_call' | 'custom_tool_call';
  name: string;
  callId?: string;
  /** JSON args (function_call) or freeform input (custom_tool_call). */
  callBody: string;
  /** Hint: when true, expanded body should pretty-print as JSON. */
  callIsJson: boolean;
  outputBody: string;
  outputTurnIndex: number;
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

/** Build a single linear narrative across all turns.
 *
 *  Codex chains turns via the Responses API's `previous_response_id` — each
 *  turn's `request.input` carries only what is NEW since the prior response
 *  (the user prompt on turn 2, tool outputs on subsequent turns). The full
 *  conversation is therefore the concatenation, in turn order, of every
 *  turn's `request.input` followed by that turn's `outputs`.
 *
 *  Tool call ↔ tool output pairing: a function_call in turn N's outputs is
 *  followed in the linear walk by its function_call_output in turn N+1's
 *  input (matched by call_id). Pairing detects that adjacency and emits a
 *  single `tool_pair` step. */
export function buildConversationSteps(session: Session): ConversationStep[] {
  const turns = session.turns;
  if (turns.length === 0) return [];

  // call_id → originating turn index. Used to attribute echoed tool outputs
  // back to the turn whose model first emitted the call.
  const callIdToTurn = new Map<string, number>();
  for (const turn of turns) {
    for (const out of turn.outputs) {
      if (isToolCall(out) && out.callId && !callIdToTurn.has(out.callId)) {
        callIdToTurn.set(out.callId, turn.index);
      }
    }
  }

  // The rope: every turn's input items + outputs, in turn order. Each entry
  // remembers the turn it came from so steps carry correct attribution.
  type Entry = { source: 'input' | 'output'; turnIndex: number; raw: any };
  const rope: Entry[] = [];
  for (const turn of turns) {
    const inputs: any[] = Array.isArray(turn.request?.input) ? turn.request.input : [];
    for (const it of inputs) rope.push({ source: 'input', turnIndex: turn.index, raw: it });
    for (const out of turn.outputs) rope.push({ source: 'output', turnIndex: turn.index, raw: out });
  }

  // Pre-index tool outputs by call_id so a tool call can claim its matching
  // result even when the call is one of N parallel calls in the same turn
  // (the outputs come back in their own order, not paired-adjacent).
  const outputIndicesByCallId = new Map<string, number[]>();
  for (let i = 0; i < rope.length; i++) {
    const e = rope[i];
    if (e.source === 'input' && isOutputType(e.raw) && e.raw.call_id) {
      const arr = outputIndicesByCallId.get(e.raw.call_id) ?? [];
      arr.push(i);
      outputIndicesByCallId.set(e.raw.call_id, arr);
    }
  }

  const steps: ConversationStep[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < rope.length; i++) {
    if (consumed.has(i)) continue;
    const entry = rope[i];
    const item = entry.raw;

    if (entry.source === 'output' && isToolCallOutputItem(item) && item.callId) {
      const candidates = outputIndicesByCallId.get(item.callId) ?? [];
      const outIdx = candidates.find(idx => idx > i && !consumed.has(idx));
      if (outIdx !== undefined) {
        const outEntry = rope[outIdx];
        const toolKind: 'function_call' | 'custom_tool_call' = item.kind;
        const callBody = toolKind === 'function_call'
          ? (item as any).argsJson ?? ''
          : (item as any).input ?? '';
        steps.push({
          stepIndex: steps.length + 1,
          turnIndex: entry.turnIndex,
          kind: 'tool_pair',
          toolKind,
          name: item.name,
          callId: item.callId,
          callBody: String(callBody),
          callIsJson: toolKind === 'function_call',
          outputBody: stringifyOutput(outEntry.raw.output),
          outputTurnIndex: outEntry.turnIndex,
        });
        consumed.add(outIdx);
        continue;
      }
    }

    steps.push(toSingleStep(item, entry.source, entry.turnIndex, callIdToTurn, steps.length + 1));
  }
  return steps;
}

function isToolCallOutputItem(item: any): boolean {
  return item?.kind === 'function_call' || item?.kind === 'custom_tool_call';
}

function isOutputType(it: any): boolean {
  return it?.type === 'function_call_output' || it?.type === 'custom_tool_call_output';
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

function toSingleStep(
  item: any,
  source: 'input' | 'output',
  turnIndex: number,
  callIdToTurn: Map<string, number>,
  stepIndex: number,
): ConversationStep {
  if (source === 'output') {
    const out = item as OutputItem;
    if (out.kind === 'message') {
      return { stepIndex, turnIndex, kind: 'assistant_message', text: out.text, raw: out };
    }
    if (out.kind === 'reasoning') {
      const duration = out.doneTs !== undefined ? out.doneTs - out.addedTs : undefined;
      return { stepIndex, turnIndex, kind: 'reasoning', durationMs: duration, raw: out };
    }
    if (out.kind === 'function_call' || out.kind === 'custom_tool_call') {
      const callBody = out.kind === 'function_call' ? out.argsJson : out.input;
      return {
        stepIndex,
        turnIndex,
        kind: 'tool_call_unpaired',
        toolKind: out.kind,
        name: out.name,
        callId: out.callId,
        callBody,
        callIsJson: out.kind === 'function_call',
      };
    }
    return { stepIndex, turnIndex, kind: 'unknown', typeLabel: (out as any).kind ?? 'unknown', raw: out };
  }

  // source === 'input'
  if (item?.type === 'message') {
    const text = extractMessageText(item.content);
    const role: string = item.role ?? 'user';
    if (role === 'user') return { stepIndex, turnIndex, kind: 'user_message', text, raw: item };
    if (role === 'developer' || role === 'system') {
      return { stepIndex, turnIndex, kind: 'developer_message', text, raw: item };
    }
    return { stepIndex, turnIndex, kind: 'assistant_message', text, raw: item };
  }
  if (item?.type === 'reasoning') {
    return { stepIndex, turnIndex, kind: 'reasoning', raw: item };
  }
  if (item?.type === 'function_call' || item?.type === 'custom_tool_call') {
    const toolKind: 'function_call' | 'custom_tool_call' = item.type;
    const callBody = toolKind === 'function_call'
      ? String(item.arguments ?? '')
      : String(item.input ?? '');
    const callTurn = item.call_id ? (callIdToTurn.get(item.call_id) ?? turnIndex) : turnIndex;
    return {
      stepIndex,
      turnIndex: callTurn,
      kind: 'tool_call_unpaired',
      toolKind,
      name: String(item.name ?? '<unnamed>'),
      callId: item.call_id,
      callBody,
      callIsJson: toolKind === 'function_call',
    };
  }
  if (item?.type === 'function_call_output' || item?.type === 'custom_tool_call_output') {
    // Orphan output (no preceding call in the rope) — should be rare.
    return { stepIndex, turnIndex, kind: 'unknown', typeLabel: item.type, raw: item };
  }
  return { stepIndex, turnIndex, kind: 'unknown', typeLabel: String(item?.type ?? 'item'), raw: item };
}
