import { useMemo } from 'react';
import { Session, isToolCall } from '../types';
import { fmtDurationMs, fmtIso } from '../lib/format';
import { computeSessionInsights } from '../lib/sessionInsights';
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
      for (const o of t.outputs) if (isToolCall(o)) toolCalls++;
      totalTokens += t.usage?.total_tokens ?? 0;
    }
    return { sent, received, toolCalls, totalTokens, total: session.wsEvents.length };
  }, [session]);

  const insights = useMemo(() => computeSessionInsights(session), [session]);

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

      <div className="px-6 pb-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 gap-3">
        <Stat label="Turns" value={session.turns.length} />
        <Stat
          label="Wall clock"
          value={fmtDurationMs(insights.wallClockMs)}
          hint="first event → last event"
        />
        <Stat
          label="API time"
          value={fmtDurationMs(insights.activeApiMs)}
          hint={`out-of-api ${fmtDurationMs(insights.outOfApiMs)}`}
        />
        <Stat label="Tool calls" value={counts.toolCalls} accent="tool" />
        <Stat
          label="Failures"
          value={insights.totalFailures}
          accent={insights.totalFailures > 0 ? 'err' : 'default'}
          hint={
            insights.wastedCallCount > 0
              ? `${insights.wastedCallCount} redundant repeat${insights.wastedCallCount === 1 ? '' : 's'}`
              : undefined
          }
        />
        <Stat
          label="WS events"
          value={counts.total}
          hint={`${counts.sent} sent · ${counts.received} received`}
        />
        <Stat label="Total tokens" value={counts.totalTokens ? counts.totalTokens.toLocaleString() : '—'} />
      </div>
    </header>
  );
}
