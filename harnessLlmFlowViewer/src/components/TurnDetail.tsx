import { useMemo, useState } from 'react';
import { Turn, OutputItem, WsEvent } from '../types';
import { fmtBytes, fmtClock, fmtDurationMs, fmtNumber, truncate } from '../lib/format';
import { Stat } from './Stat';
import { JsonView } from './JsonView';
import { Copyable } from './Copyable';

interface Props {
  turn: Turn;
  manifestStartedAtMs: number;
}

export function TurnDetail({ turn, manifestStartedAtMs }: Props) {
  const req = turn.request as any;
  const inputCount = Array.isArray(req?.input) ? req.input.length : 0;
  const toolCount = Array.isArray(req?.tools) ? req.tools.length : 0;
  const instrLen = typeof req?.instructions === 'string' ? req.instructions.length : 0;

  return (
    <div className="p-6 space-y-6 overflow-y-auto">
      <div>
        <h2 className="text-xl font-semibold">
          Turn {turn.index}
          <span className="ml-3 text-ink-400 text-sm font-normal">
            started at {fmtClock(turn.startTs)} · +
            {fmtDurationMs(turn.startTs - manifestStartedAtMs)} from session start
          </span>
        </h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Duration" value={fmtDurationMs(turn.durationMs)} />
        <Stat label="Time to first output" value={fmtDurationMs(turn.ttftMs)} accent="recv" />
        <Stat label="Text delta bytes" value={fmtBytes(turn.textDeltaBytes)} accent="text" />
        <Stat label="Total tokens" value={fmtNumber(turn.usage?.total_tokens)} />
      </div>

      <Section title="Outbound · response.create" icon="↑" accent="sent">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <Stat label="Input items" value={inputCount} />
          <Stat label="Tools exposed" value={toolCount} accent="tool" />
          <Stat label="Instructions" value={fmtBytes(instrLen)} hint={`${instrLen} chars`} />
          <Stat label="Stream" value={req?.stream ? 'true' : 'false'} />
        </div>
        <RequestSummary req={req} />
      </Section>

      <Section title={`Output (${turn.outputs.length})`} icon="↓" accent="recv">
        <ul className="space-y-3">
          {turn.outputs.map(o => (
            <OutputCard key={o.itemId} item={o} startTs={turn.startTs} />
          ))}
          {turn.outputs.length === 0 && (
            <li className="text-ink-400 italic">No output items recorded.</li>
          )}
        </ul>
      </Section>

      {turn.usage && (
        <Section title="Token usage" icon="🪙">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Input" value={fmtNumber(turn.usage.input_tokens)} />
            <Stat label="Cached" value={fmtNumber(turn.usage.input_cached_tokens)} />
            <Stat label="Output" value={fmtNumber(turn.usage.output_tokens)} />
            <Stat label="Reasoning" value={fmtNumber(turn.usage.reasoning_tokens)} />
            <Stat label="Total" value={fmtNumber(turn.usage.total_tokens)} />
          </div>
        </Section>
      )}

      {turn.rateLimits && (
        <Section title="Rate limits" icon="⏱">
          <JsonView data={turn.rateLimits} />
        </Section>
      )}

      <Section title={`Raw events in this turn (${turn.events.length})`} icon="🪵" defaultOpen={false}>
        <EventList events={turn.events} startTs={turn.startTs} />
      </Section>

      <Section title="Full response.create body" icon="📤" defaultOpen={false}>
        <JsonView data={turn.request} />
      </Section>

      {turn.completed && (
        <Section title="Full response.completed body" icon="🏁" defaultOpen={false}>
          <JsonView data={turn.completed} />
        </Section>
      )}
    </div>
  );
}

function RequestSummary({ req }: { req: any }) {
  if (!req) return null;
  const tools: any[] = Array.isArray(req.tools) ? req.tools : [];
  const inputs: any[] = Array.isArray(req.input) ? req.input : [];
  return (
    <div className="space-y-3">
      {inputs.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-400 mb-2">
            Input items ({inputs.length})
          </div>
          <ul className="space-y-2">
            {inputs.map((it, i) => (
              <li
                key={i}
                className="bg-ink-900 border border-ink-700 rounded-md p-3 text-sm flex items-start gap-3"
              >
                <span className="text-[10px] mt-0.5 uppercase font-mono px-1.5 py-0.5 rounded bg-ink-700 text-ink-200">
                  {it.type ?? 'item'}
                </span>
                <InputItemPreview item={it} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {tools.length > 0 && (
        <details className="bg-ink-900 border border-ink-700 rounded-md p-3 text-sm">
          <summary className="cursor-pointer text-ink-300">
            Tools exposed ({tools.length}) — click to expand names
          </summary>
          <ul className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-1.5 text-ink-200">
            {tools.map((t, i) => (
              <li key={i} className="font-mono text-xs">
                {t.name ?? t.function?.name ?? '<unnamed>'}
              </li>
            ))}
          </ul>
        </details>
      )}
      {typeof req.instructions === 'string' && req.instructions.length > 0 && (
        <details className="bg-ink-900 border border-ink-700 rounded-md p-3 text-sm">
          <summary className="cursor-pointer text-ink-300">
            System instructions — {req.instructions.length.toLocaleString()} chars
          </summary>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-ink-300 max-h-96 overflow-auto">
            {req.instructions}
          </pre>
        </details>
      )}
    </div>
  );
}

function InputItemPreview({ item }: { item: any }) {
  if (!item) return null;
  if (item.type === 'message' && Array.isArray(item.content)) {
    const text = item.content
      .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
      .filter(Boolean)
      .join('\n');
    return (
      <div className="whitespace-pre-wrap text-ink-200">
        <span className="text-ink-400 text-xs uppercase mr-2">{item.role ?? 'msg'}</span>
        {truncate(text, 800)}
      </div>
    );
  }
  if (item.type === 'function_call') {
    return (
      <div className="font-mono text-xs">
        <span className="text-accent-tool">{item.name}</span>
        <span className="text-ink-400 mx-1">(</span>
        <span className="text-ink-200">{truncate(item.arguments ?? '', 200)}</span>
        <span className="text-ink-400">)</span>
      </div>
    );
  }
  if (item.type === 'function_call_output') {
    return (
      <div className="font-mono text-xs">
        <span className="text-ink-400">call_id={item.call_id} →</span>{' '}
        <span className="text-ink-200">{truncate(String(item.output ?? ''), 400)}</span>
      </div>
    );
  }
  return <div className="font-mono text-xs">{truncate(JSON.stringify(item), 400)}</div>;
}

function OutputCard({ item, startTs }: { item: OutputItem; startTs: number }) {
  const offset = item.addedTs - startTs;
  if (item.kind === 'message') {
    return (
      <li className="bg-ink-900 border border-ink-700 rounded-md p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 text-[10px] uppercase rounded bg-accent-text/20 text-accent-text border border-accent-text/40">
              💬 message
            </span>
            <span className="text-xs text-ink-500 font-mono">{item.itemId}</span>
          </div>
          <span className="text-xs text-ink-500">+{fmtDurationMs(offset)} → +{fmtDurationMs((item.doneTs ?? item.addedTs) - startTs)}</span>
        </div>
        <pre className="whitespace-pre-wrap text-sm text-ink-100">{item.text}</pre>
      </li>
    );
  }
  if (item.kind === 'function_call') {
    return (
      <li className="bg-ink-900 border border-ink-700 rounded-md p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 text-[10px] uppercase rounded bg-accent-tool/20 text-accent-tool border border-accent-tool/40">
              🛠 function_call
            </span>
            <span className="text-sm font-medium text-accent-tool font-mono">{item.name}</span>
            {item.callId && (
              <Copyable
                value={item.callId}
                className="text-xs text-ink-500 font-mono"
                title="call_id (click to copy)"
              />
            )}
          </div>
          <span className="text-xs text-ink-500">
            +{fmtDurationMs(offset)} → +{fmtDurationMs((item.doneTs ?? item.addedTs) - startTs)}
          </span>
        </div>
        <FunctionArgsPretty argsJson={item.argsJson} argsParsed={item.argsParsed} />
        {item.output && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-ink-400">function output</summary>
            <pre className="mt-1 whitespace-pre-wrap text-xs text-ink-200 bg-ink-950 p-2 rounded border border-ink-800 max-h-64 overflow-auto">
              {item.output}
            </pre>
          </details>
        )}
      </li>
    );
  }
  // reasoning
  return (
    <li className="bg-ink-900 border border-ink-700 rounded-md p-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 text-[10px] uppercase rounded bg-ink-700 text-ink-300 border border-ink-600">
            🧠 reasoning
          </span>
          <span className="text-xs text-ink-500 font-mono">{item.itemId}</span>
        </div>
        <span className="text-xs text-ink-500">
          +{fmtDurationMs(offset)} → +{fmtDurationMs((item.doneTs ?? item.addedTs) - startTs)}
        </span>
      </div>
      <div className="text-xs text-ink-500">Encrypted reasoning blob (content not stored in plaintext).</div>
    </li>
  );
}

function FunctionArgsPretty({ argsJson, argsParsed }: { argsJson: string; argsParsed?: any }) {
  const pretty = useMemo(() => {
    if (argsParsed !== undefined) return JSON.stringify(argsParsed, null, 2);
    return argsJson;
  }, [argsJson, argsParsed]);
  return (
    <pre className="font-mono text-xs whitespace-pre-wrap break-words bg-ink-950 border border-ink-800 rounded p-2 max-h-64 overflow-auto text-ink-200">
      {pretty}
    </pre>
  );
}

function Section({
  title,
  icon,
  accent,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon?: string;
  accent?: 'sent' | 'recv';
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const accentClass = accent === 'sent' ? 'text-accent-sent' : accent === 'recv' ? 'text-accent-recv' : 'text-ink-100';
  return (
    <section className="bg-ink-850 border border-ink-700 rounded-lg overflow-hidden bg-ink-900/50">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-2.5 flex items-center justify-between border-b border-ink-700 hover:bg-ink-800"
      >
        <h3 className={`text-sm font-semibold ${accentClass}`}>
          {icon && <span className="mr-2">{icon}</span>}
          {title}
        </h3>
        <span className="text-ink-500 text-xs">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="p-4">{children}</div>}
    </section>
  );
}

function EventList({ events, startTs }: { events: WsEvent[]; startTs: number }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <ul className="font-mono text-xs space-y-1 max-h-96 overflow-y-auto">
      {events.map((ev, i) => {
        const offset = ev.ts_ms - startTs;
        const t = ev.body?.type ?? '';
        const color =
          ev.direction === 'sent'
            ? 'text-accent-sent'
            : ev.direction === 'received'
              ? 'text-accent-recv'
              : 'text-ink-400';
        // ev.line is 0 for HTTP-synthesized events, so combine with index.
        const key = `${ev.line}:${i}`;
        return (
          <li key={key}>
            <button
              onClick={() => setExpanded(expanded === key ? null : key)}
              className="w-full text-left hover:bg-ink-800 px-2 py-1 rounded"
            >
              <span className="text-ink-500">+{String(offset).padStart(6)}ms</span>{' '}
              <span className={color}>{ev.direction.padEnd(8)}</span>{' '}
              <span className="text-ink-200">{t}</span>
              {typeof ev.body?.delta === 'string' && (
                <span className="text-ink-400"> · {ev.body.delta.length}b</span>
              )}
            </button>
            {expanded === key && (
              <div className="mt-1 mb-2 ml-4">
                <JsonView data={ev} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
