import { useMemo, useState } from 'react';
import { Session } from '../types';
import { buildConversationSteps, ConversationStep } from '../lib/conversation';
import { fmtDurationMs } from '../lib/format';
import { ExpandableValue } from './ExpandableValue';
import { JsonView } from './JsonView';
import { Copyable } from './Copyable';

interface Props {
  session: Session;
}

type Bulk = 'default' | 'all-open' | 'all-closed';

export function Conversation({ session }: Props) {
  const allSteps = useMemo(() => buildConversationSteps(session), [session]);
  const [hideReasoning, setHideReasoning] = useState(false);
  const [bulk, setBulk] = useState<Bulk>('default');
  const [overrides, setOverrides] = useState<Map<number, boolean>>(new Map());

  const visibleSteps = useMemo(
    () => (hideReasoning ? allSteps.filter(s => s.kind !== 'reasoning') : allSteps),
    [allSteps, hideReasoning],
  );

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

  function expandAll() {
    setBulk('all-open');
    setOverrides(new Map());
  }
  function collapseAll() {
    setBulk('all-closed');
    setOverrides(new Map());
  }

  if (allSteps.length === 0) {
    return (
      <div className="p-6 text-ink-400 italic">
        No conversation steps. The dump may not contain any turns with input or outputs yet.
      </div>
    );
  }

  return (
    <div className="overflow-y-auto">
      <div className="sticky top-0 z-10 bg-ink-950/95 backdrop-blur border-b border-ink-700 px-6 py-3 flex items-center gap-4 flex-wrap">
        <label className="text-sm text-ink-300 flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideReasoning}
            onChange={e => setHideReasoning(e.target.checked)}
            className="accent-accent-text"
          />
          Hide reasoning
        </label>
        <button
          onClick={expandAll}
          className="px-2.5 py-1 text-xs bg-ink-800 border border-ink-700 rounded hover:bg-ink-700 text-ink-200"
        >
          Expand all
        </button>
        <button
          onClick={collapseAll}
          className="px-2.5 py-1 text-xs bg-ink-800 border border-ink-700 rounded hover:bg-ink-700 text-ink-200"
        >
          Collapse all
        </button>
        <span className="text-xs text-ink-500 ml-auto">
          {visibleSteps.length} step{visibleSteps.length === 1 ? '' : 's'} · {session.turns.length} turn
          {session.turns.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="p-6 max-w-5xl mx-auto">
        <p className="text-ink-400 text-sm mb-4 max-w-3xl">
          The full algorithm as one linear flow — user prompt → reasoning → tool call → tool output → … → final
          message. Each step is collapsible. Tool calls and their matching outputs are paired (output indented
          under call). Truncation in the per-turn view is gone here: click any item to see the exact wire body.
        </p>

        <ol className="space-y-2 list-none">
          {visibleSteps.map(step => (
            <li key={step.stepIndex}>
              <ConversationStepView
                step={step}
                expanded={isExpanded(step)}
                onToggle={() => toggleStep(step)}
              />
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function defaultExpanded(step: ConversationStep): boolean {
  if (step.kind === 'user_message') return step.text.length <= 400;
  if (step.kind === 'assistant_message') return step.text.length <= 400;
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
    case 'user_message':
      return (
        <>
          <Badge icon="👤" color="text" label="User" />
          <span className="flex-1 min-w-0 text-sm text-ink-200 truncate">
            {firstLine(step.text)}
          </span>
          {turnChip}
          {caret}
        </>
      );
    case 'developer_message':
      return (
        <>
          <Badge icon="⚙️" color="muted" label="Developer" />
          <span className="flex-1 min-w-0 text-sm text-ink-300 truncate">
            {firstLine(step.text)}
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
      const isCustom = step.toolKind === 'custom_tool_call';
      const preview = step.callIsJson
        ? prettyArgsPreview(step.callBody, 80)
        : firstLine(step.callBody).slice(0, 80);
      return (
        <>
          <Badge icon={icon} color="tool" label={isCustom ? 'Tool · custom' : 'Tool'} />
          <span className="font-mono text-sm text-accent-tool shrink-0">{step.name}</span>
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
          </span>
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
    case 'user_message':
    case 'developer_message':
    case 'assistant_message':
      return (
        <pre className="whitespace-pre-wrap break-words text-sm text-ink-100 bg-ink-950 border border-ink-800 rounded p-3 mt-2">
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
            <summary className="cursor-pointer text-xs text-ink-400 hover:text-ink-200">
              Raw item JSON
            </summary>
            <div className="mt-1">
              <JsonView data={step.raw} />
            </div>
          </details>
        </div>
      );
    case 'tool_pair':
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
            <ToolBodyBlock body={step.callBody} isJson={step.callIsJson} />
          </div>
          <div className="border-l-2 border-ink-700 pl-3 ml-2">
            <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1 flex items-center gap-2">
              <span>↩️ Output</span>
              <span className="text-ink-600">· injected on Turn {step.outputTurnIndex}</span>
            </div>
            <ExpandableValue text={step.outputBody || '(empty)'} previewChars={800} />
          </div>
        </div>
      );
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
            <ToolBodyBlock body={step.callBody} isJson={step.callIsJson} />
          </div>
          <div className="text-xs text-ink-500 italic">
            No matching output in this dump — call was the model's last emission, or the turn was interrupted
            before the output was injected.
          </div>
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

function ToolBodyBlock({ body, isJson }: { body: string; isJson: boolean }) {
  if (isJson) {
    return <ExpandableValue text={body || '{}'} previewChars={400} prettyJson />;
  }
  return <ExpandableValue text={body || '(empty)'} previewChars={400} />;
}

function Badge({
  icon,
  label,
  color,
}: {
  icon: string;
  label: string;
  color: 'text' | 'tool' | 'muted';
}) {
  const cls =
    color === 'text'
      ? 'bg-accent-text/20 text-accent-text border-accent-text/40'
      : color === 'tool'
        ? 'bg-accent-tool/20 text-accent-tool border-accent-tool/40'
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
    // Compact one-line preview
    const compact = JSON.stringify(parsed);
    return compact.length > max ? compact.slice(0, max) + '…' : compact;
  } catch {
    return json.length > max ? json.slice(0, max) + '…' : json;
  }
}
