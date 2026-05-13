import { useMemo, useState } from 'react';
import { Session, Turn } from '../types';
import {
  buildConversationModel,
  ConversationStep,
  SessionPolicy,
  ToolPairStep,
  ToolGroupStep,
  splitToolName,
  toolOrigin,
} from '../lib/conversation';
import { fmtBytes, fmtDurationMs, fmtNumber } from '../lib/format';
import { ExpandableValue } from './ExpandableValue';
import { ApplyPatchBody } from './ApplyPatchBody';
import { JsonView } from './JsonView';
import { Copyable } from './Copyable';

interface Props {
  session: Session;
}

type Bulk = 'default' | 'all-open' | 'all-closed';
type FilterMode = 'all' | 'failures' | 'tools' | 'messages';

export function Conversation({ session }: Props) {
  const model = useMemo(() => buildConversationModel(session), [session]);
  const allSteps = model.steps;
  const [hideReasoning, setHideReasoning] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [bulk, setBulk] = useState<Bulk>('default');
  const [overrides, setOverrides] = useState<Map<number, boolean>>(new Map());

  const turnById = useMemo(() => {
    const m = new Map<number, Turn>();
    for (const t of session.turns) m.set(t.index, t);
    return m;
  }, [session.turns]);

  const visibleSteps = useMemo(() => {
    let steps = allSteps;
    if (hideReasoning) steps = steps.filter(s => s.kind !== 'reasoning');
    if (filterMode === 'failures') {
      steps = steps.filter(s =>
        (s.kind === 'tool_pair' && (s.status === 'error' || s.status === 'blocked')) ||
        (s.kind === 'tool_group' && (s.errorCount > 0 || s.blockedCount > 0)),
      );
    } else if (filterMode === 'tools') {
      steps = steps.filter(s =>
        s.kind === 'tool_pair' || s.kind === 'tool_group' || s.kind === 'tool_call_unpaired',
      );
    } else if (filterMode === 'messages') {
      steps = steps.filter(s =>
        s.kind === 'user_message' || s.kind === 'assistant_message' || s.kind === 'developer_message',
      );
    }
    return steps;
  }, [allSteps, hideReasoning, filterMode]);

  function isExpanded(step: ConversationStep): boolean {
    if (overrides.has(step.stepIndex)) return overrides.get(step.stepIndex)!;
    if (bulk === 'all-open') return true;
    if (bulk === 'all-closed') return false;
    return defaultExpanded(step);
  }

  function toggleStep(step: ConversationStep) {
    const cur = isExpanded(step);
    setOverrides(prev => {
      const next = new Map(prev);
      next.set(step.stepIndex, !cur);
      return next;
    });
  }

  if (allSteps.length === 0) {
    return (
      <div className="p-6 text-ink-400 italic">
        No conversation steps. The dump may not contain any turns with input or outputs yet.
      </div>
    );
  }

  // Count failures across both grouped and ungrouped tool calls.
  const failureCount = model.failureCount;

  return (
    <div className="overflow-y-auto">
      <div className="sticky top-0 z-20 bg-ink-950/95 backdrop-blur border-b border-ink-700">
        <div className="px-6 py-3 flex items-center gap-3 flex-wrap">
          <label className="text-sm text-ink-300 flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideReasoning}
              onChange={e => setHideReasoning(e.target.checked)}
              className="accent-accent-text"
            />
            Hide reasoning
          </label>
          <div className="flex rounded-md border border-ink-700 overflow-hidden">
            <FilterChip current={filterMode} mode="all" onClick={setFilterMode} label="All" count={allSteps.length} />
            <FilterChip
              current={filterMode}
              mode="failures"
              onClick={setFilterMode}
              label="Failures"
              count={failureCount}
              accent={failureCount > 0 ? 'err' : undefined}
            />
            <FilterChip current={filterMode} mode="tools" onClick={setFilterMode} label="Tools" />
            <FilterChip current={filterMode} mode="messages" onClick={setFilterMode} label="Messages" />
          </div>
          <button
            onClick={() => { setBulk('all-open'); setOverrides(new Map()); }}
            className="px-2.5 py-1 text-xs bg-ink-800 border border-ink-700 rounded hover:bg-ink-700 text-ink-200"
          >
            Expand all
          </button>
          <button
            onClick={() => { setBulk('all-closed'); setOverrides(new Map()); }}
            className="px-2.5 py-1 text-xs bg-ink-800 border border-ink-700 rounded hover:bg-ink-700 text-ink-200"
          >
            Collapse all
          </button>
          <span className="text-xs text-ink-500 ml-auto">
            {visibleSteps.length} of {allSteps.length} steps · {session.turns.length} turns
          </span>
        </div>
        <SessionPolicyBar policy={model.policy} />
      </div>

      <div className="p-6 max-w-5xl mx-auto">
        <p className="text-ink-400 text-sm mb-4 max-w-3xl">
          The full algorithm as one linear flow — user prompt → reasoning → tool call → tool output → … → final
          message. Each step is collapsible. Tool calls and their matching outputs are paired (output indented
          under call); parallel calls share one row.
        </p>

        <ol className="space-y-2 list-none">
          {renderWithTurnDividers(visibleSteps, turnById, (step) => (
            <ConversationStepView
              step={step}
              expanded={isExpanded(step)}
              onToggle={() => toggleStep(step)}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}

function FilterChip({
  current,
  mode,
  onClick,
  label,
  count,
  accent,
}: {
  current: FilterMode;
  mode: FilterMode;
  onClick: (m: FilterMode) => void;
  label: string;
  count?: number;
  accent?: 'err';
}) {
  const active = current === mode;
  const cls = active
    ? 'bg-ink-700 text-ink-100'
    : accent === 'err' && count
      ? 'bg-ink-900 text-accent-err hover:bg-ink-800'
      : 'bg-ink-900 text-ink-300 hover:bg-ink-800';
  return (
    <button
      onClick={() => onClick(mode)}
      className={`px-2.5 py-1 text-xs border-r border-ink-700 last:border-r-0 ${cls}`}
    >
      {label}
      {count !== undefined && <span className="ml-1 text-ink-500">({count})</span>}
    </button>
  );
}

function SessionPolicyBar({ policy }: { policy: SessionPolicy }) {
  const entries: Array<[string, string | undefined, 'ok' | 'warn' | 'neutral']> = [
    ['sandbox', policy.sandbox, policy.sandbox === 'read-only' || policy.sandbox === 'restricted' ? 'warn' : 'neutral'],
    ['approval', policy.approval, policy.approval === 'never' ? 'warn' : 'neutral'],
    ['cwd', policy.cwd, 'neutral'],
    ['shell', policy.shell, 'neutral'],
  ];
  const visible = entries.filter(e => e[1]);
  if (visible.length === 0) return null;
  return (
    <div className="px-6 py-1.5 border-t border-ink-800 flex items-center gap-3 flex-wrap text-[11px]">
      <span className="uppercase tracking-wide text-ink-500">Policy</span>
      {visible.map(([k, v, tone]) => (
        <span key={k} className="font-mono flex items-center gap-1">
          <span className="text-ink-500">{k}</span>
          <span className={tone === 'warn' ? 'text-amber-400' : 'text-ink-200'}>{v}</span>
        </span>
      ))}
    </div>
  );
}

function renderWithTurnDividers(
  steps: ConversationStep[],
  turnById: Map<number, Turn>,
  renderStep: (step: ConversationStep) => React.ReactNode,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let prevTurn: number | null = null;
  for (const step of steps) {
    if (step.turnIndex !== prevTurn) {
      const t = turnById.get(step.turnIndex);
      out.push(
        <li
          key={`divider-${step.stepIndex}-${step.turnIndex}`}
          className="sticky top-[5.5rem] z-[5] bg-ink-950/90 backdrop-blur py-1 px-2 text-[11px] text-ink-400 border-l-2 border-accent-tool/40 flex items-center gap-3 flex-wrap"
        >
          <span className="font-semibold text-ink-300">Turn {step.turnIndex}</span>
          {t?.durationMs !== undefined && (
            <span>
              <span className="text-ink-500">dur</span> {fmtDurationMs(t.durationMs)}
            </span>
          )}
          {t?.ttfvbMs !== undefined && (
            <span>
              <span className="text-ink-500">ttfvb</span> {fmtDurationMs(t.ttfvbMs)}
            </span>
          )}
          {t?.usage?.total_tokens !== undefined && (
            <span>
              <span className="text-ink-500">tok</span> {fmtNumber(t.usage.total_tokens)}
              {t.usage.input_cached_tokens !== undefined && (
                <span className="text-ink-500"> (cached {fmtNumber(t.usage.input_cached_tokens)})</span>
              )}
            </span>
          )}
          {t?.interrupted && <span className="text-accent-err">interrupted</span>}
        </li>,
      );
      prevTurn = step.turnIndex;
    }
    out.push(<li key={step.stepIndex}>{renderStep(step)}</li>);
  }
  return out;
}

function defaultExpanded(step: ConversationStep): boolean {
  if (step.kind === 'user_message') return step.text.length <= 400;
  if (step.kind === 'assistant_message') return step.text.length <= 400;
  if (step.kind === 'tool_pair' && (step.status === 'error' || step.status === 'blocked')) return true;
  if (step.kind === 'tool_group' && (step.errorCount > 0 || step.blockedCount > 0)) return true;
  return false;
}

function ConversationStepView({
  step,
  expanded,
  onToggle,
}: {
  step: ConversationStep;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="bg-ink-900 border border-ink-700 rounded-md overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-ink-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-text"
      >
        <span className="text-ink-500 text-xs font-mono pt-0.5 w-8 shrink-0 text-right">
          {step.stepIndex}
        </span>
        <StepHeaderContent step={step} expanded={expanded} />
      </button>
      {expanded && (
        <div className="px-3 pb-3 pl-14">
          <StepBody step={step} />
        </div>
      )}
    </div>
  );
}

function StepHeaderContent({ step, expanded }: { step: ConversationStep; expanded: boolean }) {
  const turnChip = (
    <span className="text-[10px] uppercase tracking-wide text-ink-500 shrink-0">
      Turn {step.turnIndex}
    </span>
  );
  const caret = (
    <span className="text-ink-500 text-xs ml-auto shrink-0">{expanded ? '▾' : '▸'}</span>
  );

  switch (step.kind) {
    case 'prewarm':
      return (
        <>
          <Badge icon="🤝" color="muted" label="Prewarm" />
          <span className="flex-1 min-w-0 text-xs text-ink-400 truncate">
            handshake — no input/outputs · {fmtNumber(step.toolCount)} tools · instructions{' '}
            {fmtBytes(step.instructionsChars)}
          </span>
          {turnChip}
          {caret}
        </>
      );
    case 'user_message':
      return (
        <>
          <Badge icon="👤" color="text" label="User prompt" />
          <span className="flex-1 min-w-0 text-sm text-ink-200 truncate">
            {firstLine(step.text)}
          </span>
          {turnChip}
          {caret}
        </>
      );
    case 'user_context':
      return (
        <>
          <Badge icon="📁" color="muted" label={`Context · ${step.label}`} />
          <span className="flex-1 min-w-0 text-xs text-ink-400 truncate">
            {fmtBytes(step.text.length)} · {firstLine(step.text)}
          </span>
          {turnChip}
          {caret}
        </>
      );
    case 'developer_message':
      return (
        <>
          <Badge icon="⚙️" color="muted" label="Developer" />
          <span className="flex-1 min-w-0 text-xs text-ink-400 truncate">
            {fmtBytes(step.text.length)} · {firstLine(step.text)}
          </span>
          {turnChip}
          {caret}
        </>
      );
    case 'assistant_message':
      return (
        <>
          <Badge icon="🤖" color="text" label="Model" />
          <span className="flex-1 min-w-0 text-sm text-ink-200 truncate">
            {firstLine(step.text)}
          </span>
          {turnChip}
          {caret}
        </>
      );
    case 'reasoning':
      return (
        <>
          <Badge icon="🧠" color="muted" label="Reasoning" />
          <span className="flex-1 min-w-0 text-xs text-ink-500 truncate">
            {step.durationMs !== undefined
              ? `${fmtDurationMs(step.durationMs)} (encrypted)`
              : 'encrypted blob'}
          </span>
          {turnChip}
          {caret}
        </>
      );
    case 'tool_pair':
    case 'tool_call_unpaired': {
      const icon = step.toolKind === 'function_call' ? '🛠' : '🧩';
      const origin = toolOrigin(step.name);
      const originLabel =
        origin === 'mcp' ? 'MCP' : origin === 'skill' ? 'Skill' : step.toolKind === 'custom_tool_call' ? 'Custom' : 'Tool';
      const status = step.kind === 'tool_pair' ? step.status : undefined;
      const wallTime = step.kind === 'tool_pair' ? step.wallTimeMs : undefined;
      const exitCode = step.kind === 'tool_pair' ? step.exitCode : undefined;
      const failureReason = step.kind === 'tool_pair' ? step.failureReason : undefined;
      const preview = step.callIsJson
        ? prettyArgsPreview(step.callBody, 70)
        : firstLine(step.callBody).slice(0, 70);
      return (
        <>
          <Badge icon={icon} color={origin === 'mcp' ? 'mcp' : origin === 'skill' ? 'skill' : 'tool'} label={originLabel} />
          <ToolNameDisplay name={step.name} />
          <span className="flex-1 min-w-0 font-mono text-xs text-ink-400 truncate">
            {preview && (
              <>
                <span className="text-ink-500">(</span>
                {preview}
                <span className="text-ink-500">)</span>
              </>
            )}
            {step.kind === 'tool_call_unpaired' && (
              <span className="ml-2 text-accent-err/80">awaiting output</span>
            )}
            {failureReason && (
              <span className="ml-2 text-accent-err/80 truncate">{failureReason}</span>
            )}
          </span>
          <StatusPill status={status} wallTimeMs={wallTime} exitCode={exitCode} />
          {turnChip}
          {caret}
        </>
      );
    }
    case 'tool_group': {
      const icon = step.toolKind === 'function_call' ? '🛠' : '🧩';
      const origin = toolOrigin(step.name);
      const originLabel = origin === 'mcp' ? 'MCP' : origin === 'skill' ? 'Skill' : 'Tool';
      return (
        <>
          <Badge icon={icon} color={origin === 'mcp' ? 'mcp' : origin === 'skill' ? 'skill' : 'tool'} label={originLabel} />
          <ToolNameDisplay name={step.name} />
          <span className="flex-1 min-w-0 font-mono text-xs text-ink-400 truncate">
            <span className="text-ink-500">×</span> {step.members.length} calls
          </span>
          <GroupStatusPills group={step} />
          {turnChip}
          {caret}
        </>
      );
    }
    case 'unknown':
      return (
        <>
          <Badge icon="❓" color="muted" label={step.typeLabel} />
          <span className="flex-1" />
          {turnChip}
          {caret}
        </>
      );
  }
}

function StepBody({ step }: { step: ConversationStep }) {
  switch (step.kind) {
    case 'prewarm':
      return (
        <div className="mt-2 text-xs text-ink-400 space-y-1">
          <p>
            <span className="text-ink-300 font-medium">Prewarm turn:</span> codex opens the stream with an empty{' '}
            <code className="text-ink-200">input</code> and{' '}
            <code className="text-ink-200">generate=false</code> so subsequent turns can reference it via{' '}
            <code className="text-ink-200">previous_response_id</code>. No model output is produced; the request
            simply seeds the response-id chain and primes the prefix cache.
          </p>
          <ul className="list-disc pl-5 text-ink-500">
            <li>Tools catalog exposed: <span className="text-ink-200">{step.toolCount}</span></li>
            <li>System instructions: <span className="text-ink-200">{fmtBytes(step.instructionsChars)}</span></li>
            {step.totalTokens !== undefined && (
              <li>Tokens (input side, mostly cached): <span className="text-ink-200">{fmtNumber(step.totalTokens)}</span></li>
            )}
          </ul>
        </div>
      );
    case 'user_message':
    case 'developer_message':
    case 'user_context':
    case 'assistant_message':
      return (
        <pre className="whitespace-pre-wrap break-words text-sm text-ink-100 bg-ink-950 border border-ink-800 rounded p-3 mt-2 max-h-[40rem] overflow-auto">
          {step.text || <span className="text-ink-500 italic">(empty)</span>}
        </pre>
      );
    case 'reasoning':
      return (
        <div className="mt-2 space-y-2">
          <div className="text-xs text-ink-500 italic">
            Encrypted reasoning blob — content is not sent in plaintext over the wire.
          </div>
          <details>
            <summary className="cursor-pointer text-xs text-ink-400 hover:text-ink-200">Raw item JSON</summary>
            <div className="mt-1">
              <JsonView data={step.raw} />
            </div>
          </details>
        </div>
      );
    case 'tool_pair':
      return <ToolPairBody pair={step} />;
    case 'tool_call_unpaired':
      return (
        <div className="mt-2 space-y-2">
          {step.callId && (
            <div className="text-[11px] text-ink-500 font-mono">
              call_id: <Copyable value={step.callId} title="click to copy" />
            </div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">
              {step.toolKind === 'function_call' ? 'Arguments' : 'Input (freeform)'}
            </div>
            <ToolBodyBlock body={step.callBody} isJson={step.callIsJson} name={step.name} />
          </div>
          <div className="text-xs text-ink-500 italic">
            No matching output in this dump — call was the model's last emission, or the turn was interrupted
            before the output was injected.
          </div>
        </div>
      );
    case 'tool_group':
      return (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-ink-400">
            {step.members.length} adjacent calls to <code className="text-ink-200">{step.name}</code> were folded.
            Each is independently collapsible below.
          </p>
          <ul className="space-y-1.5">
            {step.members.map(m => (
              <li key={m.stepIndex} className="bg-ink-950 border border-ink-800 rounded p-2">
                <details>
                  <summary className="cursor-pointer text-xs text-ink-300 flex items-center gap-2 list-none">
                    <span className="text-ink-500 font-mono">#{m.stepIndex}</span>
                    <StatusPill
                      status={m.status}
                      wallTimeMs={m.wallTimeMs}
                      exitCode={m.exitCode}
                      compact
                    />
                    <span className="font-mono text-ink-400 truncate flex-1">
                      {m.callIsJson ? prettyArgsPreview(m.callBody, 80) : firstLine(m.callBody).slice(0, 80)}
                    </span>
                  </summary>
                  <div className="mt-2">
                    <ToolPairBody pair={m} hideHeader />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'unknown':
      return (
        <div className="mt-2">
          <JsonView data={step.raw} />
        </div>
      );
  }
}

function ToolPairBody({ pair, hideHeader }: { pair: ToolPairStep; hideHeader?: boolean }) {
  const failed = pair.status === 'error' || pair.status === 'blocked';
  return (
    <div className={hideHeader ? 'space-y-2' : 'mt-2 space-y-2'}>
      {!hideHeader && pair.callId && (
        <div className="text-[11px] text-ink-500 font-mono">
          call_id: <Copyable value={pair.callId} title="click to copy" />
        </div>
      )}
      {failed ? (
        <>
          <ToolOutputPanel pair={pair} />
          <details>
            <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-ink-500 hover:text-ink-300">
              Proposed {pair.toolKind === 'function_call' ? 'arguments' : 'input'} — never executed
            </summary>
            <div className="mt-1">
              <ToolBodyBlock body={pair.callBody} isJson={pair.callIsJson} name={pair.name} />
            </div>
          </details>
        </>
      ) : (
        <>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">
              {pair.toolKind === 'function_call' ? 'Arguments' : 'Input (freeform)'}
            </div>
            <ToolBodyBlock body={pair.callBody} isJson={pair.callIsJson} name={pair.name} />
          </div>
          <ToolOutputPanel pair={pair} />
        </>
      )}
    </div>
  );
}

function ToolOutputPanel({ pair }: { pair: ToolPairStep }) {
  const failed = pair.status === 'error' || pair.status === 'blocked';
  const borderCls = failed ? 'border-accent-err/50' : 'border-ink-700';
  const headerCls = failed ? 'text-accent-err' : 'text-ink-500';
  return (
    <div className={`border-l-2 ${borderCls} pl-3 ml-2`}>
      <div className={`text-[10px] uppercase tracking-wide ${headerCls} mb-1 flex items-center gap-2`}>
        <span>↩️ Output</span>
        <span className="text-ink-600">· injected on Turn {pair.outputTurnIndex}</span>
        {pair.status === 'ok' && <span className="text-accent-recv">· exit 0</span>}
        {pair.status === 'error' && pair.exitCode !== undefined && <span>· exit {pair.exitCode}</span>}
        {pair.status === 'blocked' && <span>· rejected</span>}
      </div>
      <ExpandableValue text={pair.outputBody || '(empty)'} previewChars={800} />
    </div>
  );
}

function ToolBodyBlock({ body, isJson, name }: { body: string; isJson: boolean; name: string }) {
  if (name === 'apply_patch' && /\*\*\* (?:Begin Patch|Update File|Add File|Delete File)/.test(body)) {
    return <ApplyPatchBody patch={body} />;
  }
  if (isJson) {
    return <ExpandableValue text={body || '{}'} previewChars={400} prettyJson />;
  }
  return <ExpandableValue text={body || '(empty)'} previewChars={400} />;
}

function StatusPill({
  status,
  wallTimeMs,
  exitCode,
  compact,
}: {
  status: 'ok' | 'error' | 'blocked' | 'unknown' | undefined;
  wallTimeMs?: number;
  exitCode?: number;
  compact?: boolean;
}) {
  if (!status || status === 'unknown') return null;
  const text =
    status === 'ok'
      ? wallTimeMs !== undefined ? `✓ ${fmtDurationMs(wallTimeMs)}` : '✓'
      : status === 'blocked'
        ? '⛔ blocked'
        : exitCode !== undefined
          ? `✗ exit ${exitCode}`
          : '✗ err';
  const cls =
    status === 'ok'
      ? 'text-accent-recv'
      : status === 'blocked'
        ? 'text-amber-400'
        : 'text-accent-err';
  return (
    <span className={`text-[10px] font-mono ${cls} shrink-0 ${compact ? '' : 'ml-1'}`}>
      {text}
    </span>
  );
}

function GroupStatusPills({ group }: { group: ToolGroupStep }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] shrink-0">
      {group.okCount > 0 && <span className="text-accent-recv">✓ {group.okCount}</span>}
      {group.errorCount > 0 && <span className="text-accent-err">✗ {group.errorCount}</span>}
      {group.blockedCount > 0 && <span className="text-amber-400">⛔ {group.blockedCount}</span>}
    </span>
  );
}

function ToolNameDisplay({ name }: { name: string }) {
  const parts = splitToolName(name);
  if (parts.length === 1) {
    return (
      <span className="font-mono text-sm text-accent-tool max-w-[40%] truncate shrink" title={name}>
        {name}
      </span>
    );
  }
  return (
    <span className="font-mono text-sm max-w-[50%] truncate shrink" title={name}>
      {parts.slice(0, -1).map((p, i) => (
        <span key={i} className="text-ink-500">
          {p}
          <span className="text-ink-700">·</span>
        </span>
      ))}
      <span className="text-accent-tool">{parts[parts.length - 1]}</span>
    </span>
  );
}

function Badge({
  icon,
  label,
  color,
}: {
  icon: string;
  label: string;
  color: 'text' | 'tool' | 'muted' | 'mcp' | 'skill';
}) {
  const cls =
    color === 'text'
      ? 'bg-accent-text/20 text-accent-text border-accent-text/40'
      : color === 'tool'
        ? 'bg-accent-tool/20 text-accent-tool border-accent-tool/40'
        : color === 'mcp'
          ? 'bg-purple-500/20 text-purple-300 border-purple-400/40'
          : color === 'skill'
            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40'
            : 'bg-ink-700 text-ink-300 border-ink-600';
  return (
    <span
      className={`px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded border shrink-0 ${cls}`}
    >
      <span className="mr-1">{icon}</span>
      {label}
    </span>
  );
}

function firstLine(s: string): string {
  const idx = s.indexOf('\n');
  if (idx === -1) return s;
  return s.slice(0, idx);
}

function prettyArgsPreview(json: string, max: number): string {
  try {
    const parsed = JSON.parse(json);
    const compact = JSON.stringify(parsed);
    return compact.length > max ? compact.slice(0, max) + '…' : compact;
  } catch {
    return json.length > max ? json.slice(0, max) + '…' : json;
  }
}
