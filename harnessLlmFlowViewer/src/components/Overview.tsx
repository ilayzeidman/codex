import { useMemo } from 'react';
import { Session } from '../types';
import { fmtBytes, fmtDurationMs } from '../lib/format';

interface Props {
  session: Session;
  onJumpToTurn: (index: number) => void;
}

export function Overview({ session, onJumpToTurn }: Props) {
  const turns = session.turns;
  // Anchor the timeline to the first turn's startTs — the manifest's
  // started_at can predate the first call by several seconds (auth, connect).
  const sessionStart = turns[0]?.startTs ?? session.manifest.started_at_unix_ms;
  const sessionEnd = useMemo(() => {
    let max = sessionStart;
    for (const t of turns) {
      const end = t.endTs ?? t.startTs + (t.durationMs ?? 0);
      if (end > max) max = end;
    }
    return max;
  }, [turns, sessionStart]);
  // Guard against degenerate dumps (1 turn / 0 duration / empty).
  const sessionDur = Math.max(1, sessionEnd - sessionStart);

  return (
    <div className="p-6 space-y-6 overflow-y-auto">
      <Section title="Session timeline">
        <p className="text-ink-400 text-sm mb-4">
          Each bar is one turn (a <code className="text-ink-200">response.create</code> →{' '}
          <code className="text-ink-200">response.completed</code> round-trip). Width is proportional to
          duration. Click to jump.
        </p>
        {turns.length === 0 ? (
          <p className="text-ink-400 italic text-sm">
            No turns segmented. The dump may not contain any{' '}
            <code className="text-ink-200">response.create</code> events yet.
          </p>
        ) : (
          <div className="space-y-1.5">
            {turns.map(t => {
              const offset = ((t.startTs - sessionStart) / sessionDur) * 100;
              const width = Math.max(0.5, ((t.durationMs ?? 0) / sessionDur) * 100);
              const toolCalls = t.outputs.filter(o => o.kind === 'function_call').length;
              return (
                <button
                  key={t.index}
                  onClick={() => onJumpToTurn(t.index)}
                  className="w-full group focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-text rounded"
                >
                  <div className="flex items-center gap-3 text-xs">
                    <span className="w-14 text-ink-400 text-right">Turn {t.index}</span>
                    <div className="flex-1 relative h-7 bg-ink-900 rounded border border-ink-700 overflow-hidden">
                      <div
                        className={
                          'absolute top-0 bottom-0 transition-colors ' +
                          (t.interrupted
                            ? 'bg-gradient-to-r from-accent-err/40 to-accent-err/15 border-r border-accent-err/60 group-hover:from-accent-err/60 group-hover:to-accent-err/25'
                            : 'bg-gradient-to-r from-accent-text/40 to-accent-text/15 border-r border-accent-text/60 group-hover:from-accent-text/60 group-hover:to-accent-text/25')
                        }
                        style={{ left: `${offset}%`, width: `${width}%` }}
                        title={`+${fmtDurationMs(t.startTs - sessionStart)} for ${fmtDurationMs(t.durationMs)}`}
                      />
                      <span className="absolute inset-0 flex items-center px-2 pointer-events-none font-mono text-ink-300">
                        {fmtDurationMs(t.durationMs)}
                        {t.interrupted && <span className="ml-3 text-accent-err">interrupted</span>}
                        {toolCalls > 0 && <span className="ml-3 text-accent-tool">🛠 {toolCalls}</span>}
                        {t.outputs.some(o => o.kind === 'message' && o.text.length > 0) && (
                          <span className="ml-3 text-accent-text">💬</span>
                        )}
                        {t.usage?.total_tokens !== undefined && (
                          <span className="ml-3 text-ink-500">{t.usage.total_tokens.toLocaleString()} tok</span>
                        )}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="What you're looking at">
        <div className="text-ink-300 text-sm space-y-2 max-w-3xl">
          <p>
            Codex makes one LLM call per turn. Each turn:
          </p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              <strong className="text-accent-sent">sent</strong> →{' '}
              <code className="text-ink-200">response.create</code> — the full payload (instructions,
              tool catalog, conversation input).
            </li>
            <li>
              <strong className="text-accent-recv">received</strong> →{' '}
              <code className="text-ink-200">response.created / in_progress</code>.
            </li>
            <li>
              <strong className="text-accent-recv">received</strong> →{' '}
              <code className="text-ink-200">output_item.added</code> for each message / function_call /
              reasoning item the model starts emitting.
            </li>
            <li>
              Streaming deltas: <code className="text-ink-200">output_text.delta</code> for messages,{' '}
              <code className="text-ink-200">function_call_arguments.delta</code> for tools.
            </li>
            <li>
              Per-item <code className="text-ink-200">.done</code>, then a final{' '}
              <code className="text-ink-200">response.completed</code> with token usage.
            </li>
          </ol>
          <p className="text-ink-400">
            If a turn contains function_call output items, codex executes the tools locally and feeds
            their outputs back as <code className="text-ink-200">function_call_output</code> input
            items on the <em>next</em> turn — that's why the next turn's input list grows.
          </p>
        </div>
      </Section>

      <Section title="Files in this dump">
        <ul className="font-mono text-xs space-y-1">
          {session.files.map(f => (
            <li key={f.name} className="flex justify-between gap-4 text-ink-300">
              <span className="truncate">{f.name}</span>
              <span className="text-ink-500 shrink-0">{fmtBytes(f.size)}</span>
            </li>
          ))}
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
