import { useMemo } from 'react';
import { Session, isToolCall } from '../types';
import { fmtDurationMs, fmtNumber } from '../lib/format';
import { Stat } from './Stat';

interface Props {
  session: Session;
}

export function Insights({ session }: Props) {
  const turns = session.turns;

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
