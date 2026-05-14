import { Session, Turn, isToolCall } from '../types';
import { buildConversationModel, ConversationStep, ToolPairStep } from './conversation';

/** Per-turn slice of where wall-clock time actually went.
 *  Wire events give us three useful boundaries inside a turn:
 *    startTs (response.create sent) → first reasoning item → first visible byte → endTs
 *  Treat reasoning-only stretches as "thinking" and the rest as streaming.
 *  Tool exec time lives BETWEEN turns, so it's tracked at the session level. */
export interface TurnTimeBreakdown {
  index: number;
  totalMs: number;
  /** Time until first output item — usually reasoning placeholder. */
  preReasoningMs: number;
  /** Time the wire was silent while reasoning tokens generated server-side. */
  reasoningMs: number;
  /** Time spent streaming visible bytes (text / tool args / patch input). */
  streamingMs: number;
}

export interface RepeatCommandGroup {
  /** A normalized signature used to group near-identical commands. */
  signature: string;
  /** First non-empty line of the command, for display. */
  displayLine: string;
  /** Per-occurrence rich detail in chronological order. */
  occurrences: Array<{
    turnIndex: number;
    fullCommand: string;
    status?: 'ok' | 'error' | 'blocked' | 'unknown';
    exitCode?: number;
  }>;
}

export interface FailureCluster {
  /** Short label users can scan: "exit 1", "timeout", "blocked", "patch rejected". */
  label: string;
  /** Tone for badge coloring. */
  tone: 'err' | 'warn';
  count: number;
  /** Sample turn indices (deduped, up to a few) to jump from the row. */
  sampleTurns: number[];
  /** A representative failure message line. */
  sampleMessage?: string;
}

export interface SessionInsights {
  /** End-to-end real time: last event ts − first event ts. Includes idle gaps
   *  when the user wasn't waiting on the model (local tool exec, harness work). */
  wallClockMs: number;
  /** Sum of per-turn API durations — what the LLM was actively "busy" for. */
  activeApiMs: number;
  /** wallClockMs − activeApiMs. Time spent outside model turns (local tool
   *  execution, idle between turns, sandbox approvals). */
  outOfApiMs: number;

  /** First human-typed user prompt (skipping AGENTS.md / environment_context). */
  userPrompt?: string;
  userPromptTurn?: number;
  /** Last assistant message body — usually the "done" summary. */
  finalAssistantMessage?: string;
  finalAssistantTurn?: number;

  /** Failures grouped by surface (timeout / exit / blocked / patch reject). */
  failureClusters: FailureCluster[];
  totalFailures: number;

  /** Identical-or-near-identical commands that ran more than once. */
  repeats: RepeatCommandGroup[];
  /** Sum of redundant runs (occurrences − 1 across all groups). */
  wastedCallCount: number;

  /** Turn-by-turn split of where wall-clock time inside the API went. */
  turnBreakdown: TurnTimeBreakdown[];
  /** Sum of reasoning time across turns (silent wire while CoT generates). */
  totalReasoningMs: number;
  /** Sum of streaming visible-byte time. */
  totalStreamingMs: number;

  /** Input tokens on the first non-prewarm turn vs the last turn — context bloat. */
  inputTokensFirstTurn?: number;
  inputTokensLastTurn?: number;
}

export function computeSessionInsights(session: Session): SessionInsights {
  const turns = session.turns;
  const wsEvents = session.wsEvents;

  const firstTs = wsEvents[0]?.ts_ms ?? turns[0]?.startTs ?? session.manifest.started_at_unix_ms;
  const lastEvent = wsEvents[wsEvents.length - 1];
  const lastTs =
    lastEvent?.ts_ms ??
    turns[turns.length - 1]?.endTs ??
    (turns[turns.length - 1] ? turns[turns.length - 1].startTs + (turns[turns.length - 1].durationMs ?? 0) : firstTs);
  const wallClockMs = Math.max(0, lastTs - firstTs);
  const activeApiMs = session.totalDurationMs;
  const outOfApiMs = Math.max(0, wallClockMs - activeApiMs);

  const model = buildConversationModel(session);
  const steps = model.steps;

  let userPrompt: string | undefined;
  let userPromptTurn: number | undefined;
  let finalAssistantMessage: string | undefined;
  let finalAssistantTurn: number | undefined;
  for (const s of steps) {
    if (s.kind === 'user_message' && !userPrompt) {
      userPrompt = s.text;
      userPromptTurn = s.turnIndex;
    }
    if (s.kind === 'assistant_message') {
      finalAssistantMessage = s.text;
      finalAssistantTurn = s.turnIndex;
    }
  }

  const turnBreakdown = computeTurnBreakdowns(turns);
  const totalReasoningMs = turnBreakdown.reduce((s, b) => s + b.reasoningMs, 0);
  const totalStreamingMs = turnBreakdown.reduce((s, b) => s + b.streamingMs, 0);

  const { failureClusters, totalFailures } = clusterFailures(steps);
  const { repeats, wastedCallCount } = detectRepeats(steps);

  // First turn with actual input items (skip a possible prewarm), last turn.
  let inputTokensFirstTurn: number | undefined;
  let inputTokensLastTurn: number | undefined;
  for (const t of turns) {
    const hasInput = Array.isArray(t.request?.input) && t.request.input.length > 0;
    if (hasInput && t.usage?.input_tokens !== undefined) {
      inputTokensFirstTurn = t.usage.input_tokens;
      break;
    }
  }
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].usage?.input_tokens !== undefined) {
      inputTokensLastTurn = turns[i].usage!.input_tokens;
      break;
    }
  }

  return {
    wallClockMs,
    activeApiMs,
    outOfApiMs,
    userPrompt,
    userPromptTurn,
    finalAssistantMessage,
    finalAssistantTurn,
    failureClusters,
    totalFailures,
    repeats,
    wastedCallCount,
    turnBreakdown,
    totalReasoningMs,
    totalStreamingMs,
    inputTokensFirstTurn,
    inputTokensLastTurn,
  };
}

function computeTurnBreakdowns(turns: Turn[]): TurnTimeBreakdown[] {
  return turns.map(t => {
    const total = t.durationMs ?? 0;
    // ttftMs = time to first output_item.added (often a reasoning placeholder).
    // ttfvbMs = time to first visible byte (text / args / patch delta).
    const pre = t.ttftMs ?? 0;
    const visible = t.ttfvbMs ?? t.ttftMs ?? 0;
    const reasoning = Math.max(0, visible - pre);
    const streaming = Math.max(0, total - visible);
    return {
      index: t.index,
      totalMs: total,
      preReasoningMs: Math.min(pre, total),
      reasoningMs: Math.min(reasoning, total),
      streamingMs: Math.min(streaming, total),
    };
  });
}

function clusterFailures(steps: ConversationStep[]): {
  failureClusters: FailureCluster[];
  totalFailures: number;
} {
  type Bucket = { label: string; tone: 'err' | 'warn'; turns: number[]; sample?: string };
  const buckets = new Map<string, Bucket>();
  let total = 0;

  const add = (key: string, label: string, tone: 'err' | 'warn', turn: number, sample?: string) => {
    total += 1;
    let b = buckets.get(key);
    if (!b) {
      b = { label, tone, turns: [], sample };
      buckets.set(key, b);
    }
    b.turns.push(turn);
    if (!b.sample && sample) b.sample = sample;
  };

  const handlePair = (p: ToolPairStep) => {
    if (p.status === 'blocked') {
      add('blocked', 'blocked by sandbox', 'warn', p.turnIndex, p.failureReason);
      return;
    }
    if (p.status !== 'error') return;
    if (/timed?\s*out|timeout/i.test(p.failureReason ?? '') || p.exitCode === 124) {
      add('timeout', 'tool timeout', 'err', p.turnIndex, p.failureReason);
      return;
    }
    if (p.name === 'apply_patch') {
      add('patch-failed', 'apply_patch failed', 'err', p.turnIndex, p.failureReason);
      return;
    }
    if (p.exitCode !== undefined) {
      const key = `exit:${p.exitCode}`;
      add(key, `exit ${p.exitCode}`, 'err', p.turnIndex, p.failureReason);
      return;
    }
    add('error', 'tool error', 'err', p.turnIndex, p.failureReason);
  };

  for (const s of steps) {
    if (s.kind === 'tool_pair') handlePair(s);
    else if (s.kind === 'tool_group') {
      for (const m of s.members) handlePair(m);
    }
  }

  const clusters: FailureCluster[] = Array.from(buckets.values())
    .map(b => ({
      label: b.label,
      tone: b.tone,
      count: b.turns.length,
      sampleTurns: dedupe(b.turns).slice(0, 6),
      sampleMessage: b.sample,
    }))
    .sort((a, b) => b.count - a.count);
  return { failureClusters: clusters, totalFailures: total };
}

function detectRepeats(steps: ConversationStep[]): {
  repeats: RepeatCommandGroup[];
  wastedCallCount: number;
} {
  type Occ = RepeatCommandGroup['occurrences'][number] & { signature: string; displayLine: string };
  const occs: Occ[] = [];

  const visit = (p: ToolPairStep) => {
    if (p.name !== 'shell_command' && p.name !== 'apply_patch') return;
    const { signature, displayLine } = signatureForCall(p);
    if (!signature) return;
    occs.push({
      signature,
      displayLine,
      turnIndex: p.turnIndex,
      fullCommand: p.callBody,
      status: p.status,
      exitCode: p.exitCode,
    });
  };

  for (const s of steps) {
    if (s.kind === 'tool_pair') visit(s);
    else if (s.kind === 'tool_group') {
      for (const m of s.members) visit(m);
    }
  }

  const groups = new Map<string, RepeatCommandGroup>();
  for (const o of occs) {
    let g = groups.get(o.signature);
    if (!g) {
      g = {
        signature: o.signature,
        displayLine: o.displayLine,
        occurrences: [],
      };
      groups.set(o.signature, g);
    }
    g.occurrences.push({
      turnIndex: o.turnIndex,
      fullCommand: o.fullCommand,
      status: o.status,
      exitCode: o.exitCode,
    });
  }

  const repeats = Array.from(groups.values())
    .filter(g => g.occurrences.length >= 2)
    .sort((a, b) => b.occurrences.length - a.occurrences.length);
  const wastedCallCount = repeats.reduce((sum, g) => sum + (g.occurrences.length - 1), 0);
  return { repeats, wastedCallCount };
}

/** Reduce a shell command (JSON args) or apply_patch body to a coarse
 *  signature so semantically-similar calls collapse together:
 *  - shell_command: take just the first verb token + first file/path arg
 *  - apply_patch: take just the first `*** Update File` target
 *  Different signatures from the same tool stay separate. */
function signatureForCall(pair: ToolPairStep): { signature: string; displayLine: string } {
  if (pair.name === 'apply_patch') {
    const m = pair.callBody.match(/\*\*\* (?:Update|Add|Delete) File:\s*([^\n]+)/);
    const target = m ? m[1].trim() : '';
    const displayLine = m ? `apply_patch ${target}` : firstLine(pair.callBody);
    return { signature: `apply_patch:${target.toLowerCase()}`, displayLine };
  }
  // shell_command: callBody is JSON like {"command":"...", "workdir":"..."}
  let cmd = '';
  try {
    const obj = JSON.parse(pair.callBody);
    cmd = String(obj?.command ?? '');
  } catch {
    cmd = pair.callBody;
  }
  if (!cmd) return { signature: '', displayLine: '' };
  const first = firstLine(cmd).trim();
  // Keep the first ~3 tokens — captures `Get-Content src\App.tsx` or `npm run build`
  // without conflating two unrelated commands by their leading verb alone.
  const tokens = first.split(/\s+/).slice(0, 3);
  const signature = `cmd:${tokens.join(' ').toLowerCase()}`;
  return { signature, displayLine: first };
}

function firstLine(s: string): string {
  const idx = s.indexOf('\n');
  return idx === -1 ? s : s.slice(0, idx);
}

function dedupe<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of arr) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
