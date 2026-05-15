import { useMemo } from 'react';
import { Session } from '../types';
import { computeSessionInsights } from '../lib/sessionInsights';
import { fmtDurationMs, fmtNumber, truncate } from '../lib/format';

interface Props {
  session: Session;
  onJumpToInsights?: () => void;
  onJumpToRequest?: (requestIndex: number) => void;
  /** Compact mode hides the headline and trims body — used inline above the
   *  Conversation flow so it doesn't dominate the viewport. */
  compact?: boolean;
}

/** A one-glance "what happened" panel that puts the user's prompt, the model's
 *  final summary, and the inefficiency markers (failures, repeats, idle time)
 *  side by side. The Conversation/Overview pages used to bury this in request 2
 *  and request 41 respectively. */
export function SessionStory({ session, onJumpToInsights, onJumpToRequest, compact }: Props) {
  const i = useMemo(() => computeSessionInsights(session), [session]);

  // What fraction of requests produced a visible assistant message vs were
  // pure tool-call/reasoning requests? Low ratio = chatty preamble missing OR
  // model talking to itself a lot.
  const messageRequestCount = useMemo(() => {
    const seen = new Set<number>();
    for (const r of session.requests) {
      if (r.outputs.some(o => o.kind === 'message' && o.text.length > 0)) seen.add(r.index);
    }
    return seen.size;
  }, [session]);

  const idlePct = i.wallClockMs > 0 ? Math.round((i.outOfApiMs / i.wallClockMs) * 100) : 0;
  const reasoningPct = i.activeApiMs > 0 ? Math.round((i.totalReasoningMs / i.activeApiMs) * 100) : 0;
  const tokenGrowth =
    i.inputTokensFirstRequest !== undefined && i.inputTokensLastRequest !== undefined
      ? i.inputTokensLastRequest - i.inputTokensFirstRequest
      : undefined;

  return (
    <section
      className={
        'bg-ink-900/80 border border-ink-700 rounded-lg overflow-hidden ' +
        (compact ? 'mb-4' : '')
      }
    >
      {!compact && (
        <header className="px-4 py-2.5 border-b border-ink-700 flex items-center gap-3">
          <h3 className="text-sm font-semibold text-ink-100">Session story</h3>
          <span className="text-[11px] text-ink-500">
            {session.requests.length} request{session.requests.length === 1 ? '' : 's'} ·{' '}
            {fmtDurationMs(i.wallClockMs)} wall clock
          </span>
        </header>
      )}
      <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          {i.userPrompt ? (
            <PromptBlock
              icon="👤"
              label="User prompt"
              request={i.userPromptRequest}
              text={i.userPrompt}
              accent="text"
              onJump={onJumpToRequest}
            />
          ) : (
            <div className="text-xs italic text-ink-500">No user prompt detected.</div>
          )}
          {i.finalAssistantMessage && (
            <PromptBlock
              icon="🤖"
              label="Final assistant message"
              request={i.finalAssistantRequest}
              text={i.finalAssistantMessage}
              accent="recv"
              onJump={onJumpToRequest}
            />
          )}
        </div>

        <div className="space-y-2">
          <Callout
            label="Wall clock"
            value={fmtDurationMs(i.wallClockMs)}
            sub={`API ${fmtDurationMs(i.activeApiMs)} · idle ${fmtDurationMs(i.outOfApiMs)} (${idlePct}%)`}
            tone="neutral"
          />
          <Callout
            label="Failures"
            value={`${i.totalFailures}`}
            sub={
              i.failureClusters.length > 0
                ? topClusterSummary(i.failureClusters)
                : 'no tool errors detected'
            }
            tone={i.totalFailures > 0 ? 'err' : 'good'}
          />
          <Callout
            label="Repeat commands"
            value={`${i.repeats.length}`}
            sub={
              i.wastedCallCount > 0
                ? `${i.wastedCallCount} redundant re-runs across ${i.repeats.length} pattern${i.repeats.length === 1 ? '' : 's'}`
                : 'no repeated command pattern'
            }
            tone={i.wastedCallCount > 0 ? 'warn' : 'good'}
          />
          <Callout
            label="Reasoning vs streaming"
            value={`${reasoningPct}% reasoning`}
            sub={`${fmtDurationMs(i.totalReasoningMs)} silent · ${fmtDurationMs(i.totalStreamingMs)} streaming`}
            tone="neutral"
          />
          {tokenGrowth !== undefined && (
            <Callout
              label="Input-token growth"
              value={`+${fmtNumber(tokenGrowth)}`}
              sub={`request 1 ${fmtNumber(i.inputTokensFirstRequest)} → request ${session.requests.length} ${fmtNumber(i.inputTokensLastRequest)}`}
              tone={tokenGrowth > 20000 ? 'warn' : 'neutral'}
            />
          )}
          <Callout
            label="Requests with model message"
            value={`${messageRequestCount} / ${session.requests.length}`}
            sub="rest were reasoning + tool-call only"
            tone="neutral"
          />
          {onJumpToInsights && (
            <button
              onClick={onJumpToInsights}
              className="w-full mt-1 text-xs px-2 py-1.5 rounded border border-ink-700 hover:bg-ink-800 text-ink-300"
            >
              See full breakdown →
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function PromptBlock({
  icon,
  label,
  request,
  text,
  accent,
  onJump,
}: {
  icon: string;
  label: string;
  request?: number;
  text: string;
  accent: 'text' | 'recv';
  onJump?: (requestIndex: number) => void;
}) {
  const accentCls = accent === 'text' ? 'text-accent-text' : 'text-accent-recv';
  const trimmed = truncate(text.trim(), 720);
  return (
    <div className="bg-ink-950 border border-ink-800 rounded-md p-3">
      <div className="flex items-center gap-2 mb-1.5 text-[11px] uppercase tracking-wide">
        <span aria-hidden>{icon}</span>
        <span className={accentCls}>{label}</span>
        {request !== undefined && (
          <button
            onClick={onJump ? () => onJump(request) : undefined}
            className={
              'ml-auto font-mono ' +
              (onJump
                ? 'text-ink-400 hover:text-ink-200 underline-offset-2 hover:underline cursor-pointer'
                : 'text-ink-500')
            }
            disabled={!onJump}
            title={onJump ? `Jump to request ${request}` : undefined}
          >
            Request {request}
          </button>
        )}
      </div>
      <div className="whitespace-pre-wrap text-sm text-ink-100 max-h-44 overflow-auto leading-snug">
        {trimmed}
      </div>
    </div>
  );
}

function Callout({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'good' | 'warn' | 'err' | 'neutral';
}) {
  const cls =
    tone === 'good'
      ? 'border-accent-recv/30 bg-accent-recv/5 text-accent-recv'
      : tone === 'warn'
        ? 'border-amber-500/40 bg-amber-500/5 text-amber-300'
        : tone === 'err'
          ? 'border-accent-err/40 bg-accent-err/5 text-accent-err'
          : 'border-ink-700 bg-ink-950 text-ink-100';
  return (
    <div className={`border rounded-md px-2.5 py-1.5 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-sm font-semibold leading-tight">{value}</div>
      <div className="text-[11px] opacity-70 mt-0.5">{sub}</div>
    </div>
  );
}

function topClusterSummary(clusters: { label: string; count: number }[]): string {
  const top = clusters.slice(0, 3);
  return top.map(c => `${c.label} ×${c.count}`).join(' · ');
}
