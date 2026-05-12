import { useMemo } from 'react';
import { Session } from '../types';
import { fmtDurationMs, fmtIso } from '../lib/format';
import { Stat } from './Stat';
import { Copyable } from './Copyable';

interface Props {
  session: Session;
  onReset: () => void;
}

export function SessionHeader({ session, onReset }: Props) {
  const m = session.manifest;
  const counts = useMemo(() => {
    let sent = 0;
    let received = 0;
    for (const e of session.wsEvents) {
      if (e.direction === 'sent') sent++;
      else if (e.direction === 'received') received++;
    }
    let toolCalls = 0;
    let totalTokens = 0;
    for (const t of session.turns) {
      for (const o of t.outputs) if (o.kind === 'function_call') toolCalls++;
      totalTokens += t.usage?.total_tokens ?? 0;
    }
    return { sent, received, toolCalls, totalTokens, total: session.wsEvents.length };
  }, [session]);

  const startedLabel = m.started_at_unix_ms ? fmtIso(m.started_at_unix_ms) : '—';

  return (
    <header className="border-b border-ink-700 bg-ink-900">
      <div className="px-6 py-4 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-ink-400">
            {m.session_source || 'unknown'} · {m.model_provider_id || 'unknown'}
          </div>
          <div className="mt-1 text-2xl font-semibold flex items-baseline flex-wrap gap-x-2">
            <Copyable value={m.model || '—'} className="select-text" />
            <span className="text-ink-400 font-normal text-base">· codex {m.codex_version || '—'}</span>
          </div>
          <div className="mt-1 text-sm text-ink-300 flex items-center gap-2 flex-wrap">
            <Copyable
              value={m.thread_id}
              className="font-mono text-xs"
              title="thread_id (click to copy)"
            />
            <span className="text-ink-500">·</span>
            <span>{startedLabel}</span>
          </div>
        </div>
        <button
          type="button"
          className="px-3 py-1.5 text-sm bg-ink-800 border border-ink-700 rounded-md hover:bg-ink-700 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-text"
          onClick={onReset}
        >
          Load another dump
        </button>
      </div>

      <div className="px-6 pb-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Turns" value={session.turns.length} />
        <Stat
          label="Duration"
          value={fmtDurationMs(session.totalDurationMs)}
          hint="sum of completed-vs-start per turn"
        />
        <Stat label="Tool calls" value={counts.toolCalls} accent="tool" />
        <Stat
          label="WS events"
          value={counts.total}
          hint={`${counts.sent} sent · ${counts.received} received`}
        />
        <Stat label="HTTP calls" value={session.httpCalls.length} />
        <Stat label="Total tokens" value={counts.totalTokens ? counts.totalTokens.toLocaleString() : '—'} />
      </div>
    </header>
  );
}
