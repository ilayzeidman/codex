import { useMemo } from 'react';
import { Session, isToolCall } from '../types';
import { fmtDurationMs, fmtNumber, truncate } from '../lib/format';
import { computeSessionInsights, FailureCluster, RepeatCommandGroup, TurnTimeBreakdown } from '../lib/sessionInsights';

interface Props {
  session: Session;
}

export function Insights({ session }: Props) {
  const turns = session.turns;
  const insights = useMemo(() => computeSessionInsights(session), [session]);

  const eventHistogram = useMemo(() => {
    const m = new Map<string, number>();
    for (const ev of session.wsEvents) {
      const key = `${ev.direction} · ${ev.body?.type ?? '(no type)'}`;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [session.wsEvents]);

  const toolHistogram = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of turns) {
      for (const o of t.outputs) {
        if (isToolCall(o)) {
          // Distinguish custom tools so apply_patch doesn't blend with a JSON
          // tool named "apply_patch" (if one ever existed).
          const key = o.kind === 'custom_tool_call' ? `${o.name} (custom)` : o.name;
          m.set(key, (m.get(key) ?? 0) + 1);
        }
      }
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [turns]);

  const maxEventCount = eventHistogram[0]?.[1] ?? 1;
  const maxToolCount = toolHistogram[0]?.[1] ?? 1;
  const { maxTurnDur, maxTokens } = useMemo(() => {
    let dur = 1;
    let tok = 1;
    for (const t of turns) {
      const d = t.durationMs ?? 0;
      const k = t.usage?.total_tokens ?? 0;
      if (d > dur) dur = d;
      if (k > tok) tok = k;
    }
    return { maxTurnDur: dur, maxTokens: tok };
  }, [turns]);

  return (
    <div className="p-6 space-y-6 overflow-y-auto">
      <Section title="Where did wall-clock time go?">
        <p className="text-ink-400 text-sm mb-4">
          <span className="text-accent-text">{fmtDurationMs(insights.wallClockMs)}</span> total ·
          <span className="ml-2 text-ink-200">{fmtDurationMs(insights.activeApiMs)} inside model turns</span> ·
          <span className="ml-2 text-amber-300">
            {fmtDurationMs(insights.outOfApiMs)} between turns
          </span>{' '}
          (local tool execution, sandbox approvals, idle).
        </p>
        <WallClockBar
          activeApiMs={insights.activeApiMs}
          outOfApiMs={insights.outOfApiMs}
          reasoningMs={insights.totalReasoningMs}
          streamingMs={insights.totalStreamingMs}
        />
      </Section>

      <Section title="Per-turn time breakdown (reasoning vs streaming)">
        <p className="text-ink-400 text-sm mb-4">
          Within each turn: the API stays silent while server-side reasoning runs (
          <span className="text-ink-200">grey</span>), then visible bytes stream (
          <span className="text-accent-recv">green</span>). A turn dominated by grey means the model
          spent its time "thinking" — usually a sign it lacked the local context to act decisively.
        </p>
        <TurnBreakdownChart breakdowns={insights.turnBreakdown} />
      </Section>

      {insights.failureClusters.length > 0 && (
        <Section title="Failure clusters">
          <p className="text-ink-400 text-sm mb-4">
            Tool calls that returned non-zero, timed out, or were blocked by the sandbox. Repeated
            patterns suggest the model is retrying without diagnosing the root cause.
          </p>
          <FailureClusterList clusters={insights.failureClusters} />
        </Section>
      )}

      {insights.repeats.length > 0 && (
        <Section title={`Repeat commands (${insights.repeats.length})`}>
          <p className="text-ink-400 text-sm mb-4">
            Commands grouped by their leading verb + first argument. Each row shows every turn that
            ran a near-identical command — useful for spotting redundant probes ({' '}
            <span className="text-ink-200">npm run build × 3</span>,{' '}
            <span className="text-ink-200">Get-Content App.tsx × 2</span>, …).
          </p>
          <RepeatCommandList repeats={insights.repeats} />
        </Section>
      )}

      <Section title="Per-turn duration vs tokens">
        <p className="text-ink-400 text-sm mb-4">
          Top bar = wall-clock duration of the round-trip. Bottom bar = total tokens reported in the
          <code className="text-ink-200 mx-1">response.completed.usage</code> object.
        </p>
        <div className="space-y-3">
          {turns.map(t => (
            <div key={t.index} className="grid grid-cols-12 gap-2 items-center text-xs">
              <div className="col-span-1 text-ink-400 text-right">T{t.index}</div>
              <div className="col-span-11 space-y-1">
                <div className="relative h-5 bg-ink-900 rounded border border-ink-700 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-accent-recv/30 border-r border-accent-recv/60"
                    style={{ width: `${((t.durationMs ?? 0) / maxTurnDur) * 100}%` }}
                  />
                  <span className="absolute inset-0 flex items-center px-2 font-mono text-ink-200">
                    {fmtDurationMs(t.durationMs)} · ttft {fmtDurationMs(t.ttftMs)}
                    {t.ttfvbMs !== undefined && t.ttfvbMs !== t.ttftMs && (
                      <span className="ml-2 text-ink-500">
                        · ttfvb {fmtDurationMs(t.ttfvbMs)}
                      </span>
                    )}
                  </span>
                </div>
                <div className="relative h-5 bg-ink-900 rounded border border-ink-700 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-accent-text/30 border-r border-accent-text/60"
                    style={{
                      width: `${((t.usage?.total_tokens ?? 0) / maxTokens) * 100}%`,
                    }}
                  />
                  <span className="absolute inset-0 flex items-center px-2 font-mono text-ink-200">
                    {fmtNumber(t.usage?.total_tokens)} tok
                    {t.usage?.reasoning_tokens !== undefined && t.usage.reasoning_tokens > 0 && (
                      <span className="ml-3 text-ink-500">
                        ({fmtNumber(t.usage.reasoning_tokens)} reasoning)
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {toolHistogram.length > 0 && (
        <Section title="Tool call frequency">
          <ul className="space-y-1.5">
            {toolHistogram.map(([name, count]) => (
              <li key={name} className="grid grid-cols-12 gap-2 items-center text-xs">
                <div className="col-span-3 font-mono text-accent-tool truncate">{name}</div>
                <div className="col-span-8 relative h-5 bg-ink-900 rounded border border-ink-700 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-accent-tool/30 border-r border-accent-tool/60"
                    style={{ width: `${(count / maxToolCount) * 100}%` }}
                  />
                </div>
                <div className="col-span-1 text-right font-mono text-ink-200">{count}</div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Event histogram">
        <ul className="space-y-1.5">
          {eventHistogram.map(([key, count]) => {
            const color = key.startsWith('sent')
              ? 'bg-accent-sent/30 border-accent-sent/60'
              : key.startsWith('received')
                ? 'bg-accent-recv/30 border-accent-recv/60'
                : 'bg-ink-700 border-ink-600';
            return (
              <li key={key} className="grid grid-cols-12 gap-2 items-center text-xs">
                <div className="col-span-4 font-mono text-ink-300 truncate">{key}</div>
                <div className="col-span-7 relative h-5 bg-ink-900 rounded border border-ink-700 overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 border-r ${color}`}
                    style={{ width: `${(count / maxEventCount) * 100}%` }}
                  />
                </div>
                <div className="col-span-1 text-right font-mono text-ink-200">{count}</div>
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-ink-900/50 border border-ink-700 rounded-lg p-5">
      <h3 className="text-sm font-semibold mb-3 text-ink-100">{title}</h3>
      {children}
    </section>
  );
}

function WallClockBar({
  activeApiMs,
  outOfApiMs,
  reasoningMs,
  streamingMs,
}: {
  activeApiMs: number;
  outOfApiMs: number;
  reasoningMs: number;
  streamingMs: number;
}) {
  const total = Math.max(1, activeApiMs + outOfApiMs);
  const pct = (n: number) => Math.max(0, (n / total) * 100);
  // Reasoning + streaming live INSIDE activeApi. Keep them as separate
  // sub-segments so the bar shows the breakdown at-a-glance.
  // Other = activeApi - reasoning - streaming (pre-reasoning latency, etc.)
  const otherApi = Math.max(0, activeApiMs - reasoningMs - streamingMs);
  return (
    <div className="space-y-2">
      <div className="flex h-7 rounded overflow-hidden border border-ink-700 bg-ink-900">
        {reasoningMs > 0 && (
          <div
            className="bg-ink-500/60 border-r border-ink-700 flex items-center justify-center text-[10px] font-mono text-ink-100"
            style={{ width: `${pct(reasoningMs)}%` }}
            title={`Reasoning silence ${fmtDurationMs(reasoningMs)}`}
          >
            {pct(reasoningMs) > 8 ? 'reasoning' : ''}
          </div>
        )}
        {streamingMs > 0 && (
          <div
            className="bg-accent-recv/40 border-r border-ink-700 flex items-center justify-center text-[10px] font-mono text-ink-100"
            style={{ width: `${pct(streamingMs)}%` }}
            title={`Streaming visible bytes ${fmtDurationMs(streamingMs)}`}
          >
            {pct(streamingMs) > 8 ? 'streaming' : ''}
          </div>
        )}
        {otherApi > 0 && (
          <div
            className="bg-accent-text/30 border-r border-ink-700 flex items-center justify-center text-[10px] font-mono text-ink-100"
            style={{ width: `${pct(otherApi)}%` }}
            title={`Other API latency ${fmtDurationMs(otherApi)}`}
          >
            {pct(otherApi) > 8 ? 'api' : ''}
          </div>
        )}
        {outOfApiMs > 0 && (
          <div
            className="bg-amber-500/30 flex items-center justify-center text-[10px] font-mono text-ink-100"
            style={{ width: `${pct(outOfApiMs)}%` }}
            title={`Out-of-API (local tool exec, idle) ${fmtDurationMs(outOfApiMs)}`}
          >
            {pct(outOfApiMs) > 8 ? `between turns ${fmtDurationMs(outOfApiMs)}` : ''}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-400">
        <LegendChip color="bg-ink-500/60" label={`reasoning ${fmtDurationMs(reasoningMs)}`} />
        <LegendChip color="bg-accent-recv/40" label={`streaming ${fmtDurationMs(streamingMs)}`} />
        <LegendChip color="bg-accent-text/30" label={`other api ${fmtDurationMs(otherApi)}`} />
        <LegendChip color="bg-amber-500/30" label={`between turns ${fmtDurationMs(outOfApiMs)}`} />
      </div>
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-3 h-3 rounded-sm border border-ink-700 ${color}`} />
      <span>{label}</span>
    </span>
  );
}

function TurnBreakdownChart({ breakdowns }: { breakdowns: TurnTimeBreakdown[] }) {
  const max = Math.max(1, ...breakdowns.map(b => b.totalMs));
  return (
    <div className="space-y-1.5">
      {breakdowns.map(b => {
        const pre = (b.preReasoningMs / max) * 100;
        const reason = (b.reasoningMs / max) * 100;
        const stream = (b.streamingMs / max) * 100;
        return (
          <div key={b.index} className="grid grid-cols-12 gap-2 items-center text-xs">
            <div className="col-span-1 text-right text-ink-400 font-mono">T{b.index}</div>
            <div className="col-span-10 relative h-5 bg-ink-900 rounded border border-ink-700 overflow-hidden flex">
              <div
                className="bg-accent-text/40 border-r border-ink-700"
                style={{ width: `${pre}%` }}
                title={`Pre-reasoning latency ${fmtDurationMs(b.preReasoningMs)}`}
              />
              <div
                className="bg-ink-500/60 border-r border-ink-700"
                style={{ width: `${reason}%` }}
                title={`Reasoning silence ${fmtDurationMs(b.reasoningMs)}`}
              />
              <div
                className="bg-accent-recv/40"
                style={{ width: `${stream}%` }}
                title={`Streaming visible bytes ${fmtDurationMs(b.streamingMs)}`}
              />
              <span className="absolute inset-0 flex items-center px-2 font-mono text-ink-200 pointer-events-none">
                {fmtDurationMs(b.totalMs)}
                {b.reasoningMs > 0 && (
                  <span className="ml-3 text-ink-400">
                    · {fmtDurationMs(b.reasoningMs)} thinking
                  </span>
                )}
              </span>
            </div>
            <div className="col-span-1 text-right text-ink-500 text-[11px]">
              {b.reasoningMs > 0
                ? `${Math.round((b.reasoningMs / Math.max(1, b.totalMs)) * 100)}%`
                : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FailureClusterList({ clusters }: { clusters: FailureCluster[] }) {
  return (
    <ul className="space-y-2">
      {clusters.map(c => (
        <li
          key={c.label}
          className={
            'flex items-start gap-3 rounded border px-3 py-2 ' +
            (c.tone === 'err'
              ? 'border-accent-err/40 bg-accent-err/5'
              : 'border-amber-500/40 bg-amber-500/5')
          }
        >
          <span
            className={
              'text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded shrink-0 ' +
              (c.tone === 'err'
                ? 'bg-accent-err/20 text-accent-err border border-accent-err/40'
                : 'bg-amber-500/20 text-amber-300 border border-amber-500/40')
            }
          >
            {c.label}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-ink-100">
              <span className="font-semibold">{c.count}</span>
              <span className="text-ink-400"> occurrence{c.count === 1 ? '' : 's'}</span>
              <span className="text-ink-500 ml-2 font-mono text-[11px]">
                turn{c.sampleTurns.length === 1 ? '' : 's'}{' '}
                {c.sampleTurns.join(', ')}
                {c.count > c.sampleTurns.length && '…'}
              </span>
            </div>
            {c.sampleMessage && (
              <div className="mt-1 text-xs text-ink-400 truncate font-mono">
                {truncate(c.sampleMessage, 240)}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function RepeatCommandList({ repeats }: { repeats: RepeatCommandGroup[] }) {
  return (
    <ul className="space-y-2">
      {repeats.map(r => (
        <li key={r.signature} className="border border-ink-700 rounded bg-ink-950 px-3 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded bg-accent-tool/20 text-accent-tool border border-accent-tool/40 shrink-0">
              × {r.occurrences.length}
            </span>
            <span className="font-mono text-sm text-ink-100 truncate">
              {truncate(r.displayLine, 100)}
            </span>
          </div>
          <ul className="mt-1.5 ml-1 flex flex-wrap gap-1.5">
            {r.occurrences.map((o, i) => {
              const tone =
                o.status === 'ok'
                  ? 'border-accent-recv/40 text-accent-recv'
                  : o.status === 'blocked'
                    ? 'border-amber-500/40 text-amber-300'
                    : o.status === 'error'
                      ? 'border-accent-err/40 text-accent-err'
                      : 'border-ink-700 text-ink-300';
              const icon =
                o.status === 'ok'
                  ? '✓'
                  : o.status === 'blocked'
                    ? '⛔'
                    : o.status === 'error'
                      ? '✗'
                      : '·';
              return (
                <span
                  key={i}
                  className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${tone}`}
                  title={o.exitCode !== undefined ? `exit ${o.exitCode}` : undefined}
                >
                  {icon} Turn {o.turnIndex}
                  {o.exitCode !== undefined && o.exitCode !== 0 && (
                    <span className="text-ink-500"> · {o.exitCode}</span>
                  )}
                </span>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
