import { Session, Turn, isToolCall } from '../types';
import { fmtDurationMs } from '../lib/format';

type View =
  | { kind: 'overview' }
  | { kind: 'turn'; index: number }
  | { kind: 'conversation' }
  | { kind: 'insights' }
  | { kind: 'raw' };

interface Props {
  session: Session;
  view: View;
  onSelect: (v: View) => void;
}

export function TurnList({ session, view, onSelect }: Props) {
  return (
    <nav className="bg-ink-900 border-r border-ink-700 overflow-y-auto">
      <div className="px-3 py-3 sticky top-0 bg-ink-900 border-b border-ink-700 z-10">
        <div className="text-[11px] uppercase tracking-wide text-ink-400 px-2">Navigation</div>
      </div>
      <ul className="px-2 py-2 space-y-1">
        <Row
          active={view.kind === 'overview'}
          onClick={() => onSelect({ kind: 'overview' })}
          label="Overview"
          icon="🗂"
        />
        <Row
          active={view.kind === 'conversation'}
          onClick={() => onSelect({ kind: 'conversation' })}
          label="Conversation"
          icon="🧵"
        />
        <Row
          active={view.kind === 'insights'}
          onClick={() => onSelect({ kind: 'insights' })}
          label="Insights"
          icon="📊"
        />
        <Row
          active={view.kind === 'raw'}
          onClick={() => onSelect({ kind: 'raw' })}
          label="Raw event log"
          icon="🪵"
        />
      </ul>

      <div className="px-3 py-2 mt-2 text-[11px] uppercase tracking-wide text-ink-400 border-t border-ink-800">
        Turns ({session.turns.length})
      </div>

      <ul className="px-2 pb-6 space-y-1">
        {session.turns.map(t => (
          <TurnRow
            key={t.index}
            turn={t}
            active={view.kind === 'turn' && view.index === t.index}
            onClick={() => onSelect({ kind: 'turn', index: t.index })}
          />
        ))}
      </ul>
    </nav>
  );
}

function Row({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: string;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={
          'w-full text-left px-3 py-2 rounded-md text-sm ' +
          (active ? 'bg-ink-700 text-ink-100' : 'text-ink-300 hover:bg-ink-800')
        }
      >
        <span className="mr-2">{icon}</span>
        {label}
      </button>
    </li>
  );
}

function TurnRow({
  turn,
  active,
  onClick,
}: {
  turn: Turn;
  active: boolean;
  onClick: () => void;
}) {
  const toolCalls = turn.outputs.filter(isToolCall).length;
  const hasMessage = turn.outputs.some(o => o.kind === 'message' && o.text.length > 0);
  return (
    <li>
      <button
        onClick={onClick}
        className={
          'w-full text-left px-3 py-2 rounded-md ' +
          (active ? 'bg-ink-700 text-ink-100' : 'text-ink-300 hover:bg-ink-800')
        }
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm">Turn {turn.index}</span>
          <span className="text-[10px] text-ink-400">{fmtDurationMs(turn.durationMs)}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[10px]">
          {toolCalls > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-accent-tool/20 text-accent-tool border border-accent-tool/40">
              🛠 {toolCalls}
            </span>
          )}
          {hasMessage && (
            <span className="px-1.5 py-0.5 rounded bg-accent-text/20 text-accent-text border border-accent-text/40">
              💬 msg
            </span>
          )}
          {turn.usage?.total_tokens !== undefined && (
            <span className="text-ink-500">{turn.usage.total_tokens.toLocaleString()} tok</span>
          )}
        </div>
      </button>
    </li>
  );
}

export type { View };
