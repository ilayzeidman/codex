import { useMemo, useState } from 'react';
import { Session, Turn, isToolCall } from '../types';
import { fmtBytes, fmtDurationMs, fmtNumber, truncate } from '../lib/format';
import { SessionStory } from './SessionStory';

interface Props {
  session: Session;
  onJumpToTurn: (index: number) => void;
  onJumpToInsights?: () => void;
}

export function Overview({ session, onJumpToTurn, onJumpToInsights }: Props) {
  const [hoveredTurn, setHoveredTurn] = useState<number | null>(null);
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
      <SessionStory
        session={session}
        onJumpToTurn={onJumpToTurn}
        onJumpToInsights={onJumpToInsights}
      />

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
            {turns.map((t, i) => {
              const offset = ((t.startTs - sessionStart) / sessionDur) * 100;
              const width = Math.max(0.5, ((t.durationMs ?? 0) / sessionDur) * 100);
              const toolCalls = t.outputs.filter(isToolCall).length;
              const isHovered = hoveredTurn === t.index;
              // Anchor the card above the row when we're in the bottom half of the list,
              // so it doesn't push past the section's bottom edge.
              const placeAbove = turns.length > 4 && i >= turns.length - 3;
              return (
                <div
                  key={t.index}
                  className="relative"
                  onMouseEnter={() => setHoveredTurn(t.index)}
                  onMouseLeave={() => setHoveredTurn(cur => (cur === t.index ? null : cur))}
                >
                  <button
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
                  {isHovered && <TurnHoverCard turn={t} placeAbove={placeAbove} />}
                </div>
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

function TurnHoverCard({ turn, placeAbove }: { turn: Turn; placeAbove: boolean }) {
  const toolCalls = turn.outputs.filter(isToolCall);
  const messages = turn.outputs.filter(o => o.kind === 'message' && o.text.length > 0);
  const reasoningCount = turn.outputs.filter(o => o.kind === 'reasoning').length;
  // Pull the last user-supplied input from the request payload (the prompt for this turn).
  const req = turn.request as any;
  const inputs: any[] = Array.isArray(req?.input) ? req.input : [];
  const lastUserMessage = (() => {
    for (let i = inputs.length - 1; i >= 0; i--) {
      const it = inputs[i];
      if (it?.type === 'message' && it?.role === 'user' && Array.isArray(it.content)) {
        const text = it.content
          .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
          .filter(Boolean)
          .join('\n');
        if (text) return text;
      }
    }
    return '';
  })();

  return (
    <div
      className={
        'absolute z-30 left-16 right-2 pointer-events-none ' +
        (placeAbove ? 'bottom-full mb-1.5' : 'top-full mt-1.5')
      }
    >
      <div className="bg-ink-950 border border-ink-700 rounded-lg shadow-2xl p-3 text-xs space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-300">
          <span className="font-semibold text-ink-100">Turn {turn.index}</span>
          <span className="text-ink-500">·</span>
          <span>
            <span className="text-ink-500">duration</span> {fmtDurationMs(turn.durationMs)}
          </span>
          {turn.ttftMs !== undefined && (
            <span>
              <span className="text-ink-500">ttft</span> {fmtDurationMs(turn.ttftMs)}
            </span>
          )}
          {turn.ttfvbMs !== undefined && turn.ttfvbMs !== turn.ttftMs && (
            <span>
              <span className="text-ink-500">ttfvb</span> {fmtDurationMs(turn.ttfvbMs)}
            </span>
          )}
          {turn.usage?.total_tokens !== undefined && (
            <span>
              <span className="text-ink-500">tokens</span> {fmtNumber(turn.usage.total_tokens)}
              {turn.usage.input_cached_tokens !== undefined && (
                <span className="text-ink-500">
                  {' '}
                  (cached {fmtNumber(turn.usage.input_cached_tokens)})
                </span>
              )}
            </span>
          )}
          {reasoningCount > 0 && (
            <span>
              <span className="text-ink-500">reasoning</span> 🧠 {reasoningCount}
            </span>
          )}
          {turn.interrupted && <span className="text-accent-err">interrupted</span>}
        </div>

        {lastUserMessage && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">Prompt</div>
            <div className="whitespace-pre-wrap text-ink-300 bg-ink-900 border border-ink-800 rounded p-2 max-h-24 overflow-hidden">
              {truncate(lastUserMessage, 280)}
            </div>
          </div>
        )}

        {toolCalls.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">
              Tool calls ({toolCalls.length})
            </div>
            <ul className="space-y-1">
              {toolCalls.map(tc => {
                if (tc.kind === 'function_call') {
                  const argsPreview =
                    tc.argsParsed !== undefined
                      ? truncate(JSON.stringify(tc.argsParsed), 160)
                      : truncate(tc.argsJson ?? '', 160);
                  return (
                    <li key={tc.itemId} className="font-mono text-[11px] leading-snug">
                      <span className="text-accent-tool">{tc.name}</span>
                      <span className="text-ink-500">(</span>
                      <span className="text-ink-200 break-all">{argsPreview}</span>
                      <span className="text-ink-500">)</span>
                    </li>
                  );
                }
                // custom_tool_call: freeform input, not JSON. Show name + first line.
                const firstLine = tc.input.split('\n')[0] ?? '';
                return (
                  <li key={tc.itemId} className="font-mono text-[11px] leading-snug">
                    <span className="text-accent-tool">{tc.name}</span>
                    <span className="text-ink-500"> [custom · {tc.input.length.toLocaleString()}c] </span>
                    <span className="text-ink-300 break-all">{truncate(firstLine, 120)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {messages.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">
              Message{messages.length > 1 ? `s (${messages.length})` : ''}
            </div>
            <div className="space-y-1.5">
              {messages.map(m => {
                if (m.kind !== 'message') return null;
                return (
                  <div
                    key={m.itemId}
                    className="whitespace-pre-wrap text-ink-100 bg-ink-900 border border-ink-800 rounded p-2 max-h-28 overflow-hidden"
                  >
                    {truncate(m.text, 360)}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {toolCalls.length === 0 && messages.length === 0 && (
          <div className="italic text-ink-500">No tool calls or messages on this turn.</div>
        )}
      </div>
    </div>
  );
}
