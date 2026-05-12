import { useMemo, useState } from 'react';
import { Session, WsEvent } from '../types';
import { fmtClock } from '../lib/format';
import { JsonView } from './JsonView';

interface Props {
  session: Session;
}

const PAGE_SIZE = 500;

type DirFilter = 'all' | 'sent' | 'received' | 'connect';

export function RawEventLog({ session }: Props) {
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<DirFilter>('all');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [shownPages, setShownPages] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const dirAll = direction === 'all';
    const out: WsEvent[] = [];
    for (const ev of session.wsEvents) {
      if (!dirAll && ev.direction !== direction) continue;
      if (q) {
        const t = ev.body?.type;
        const tMatch = typeof t === 'string' && t.toLowerCase().includes(q);
        const delta = ev.body?.delta;
        const dMatch = typeof delta === 'string' && delta.toLowerCase().includes(q);
        const name = ev.body?.item?.name;
        const nMatch = typeof name === 'string' && name.toLowerCase().includes(q);
        if (!(tMatch || dMatch || nMatch)) continue;
      }
      out.push(ev);
    }
    return out;
  }, [session.wsEvents, query, direction]);

  // Reset pagination whenever filter changes.
  const visibleCount = Math.min(filtered.length, shownPages * PAGE_SIZE);
  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  return (
    <div className="p-6 space-y-4 overflow-y-auto">
      <div className="flex flex-wrap gap-3 items-center">
        <label className="flex-1 min-w-[16rem]">
          <span className="sr-only">Filter events</span>
          <input
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setShownPages(1);
            }}
            placeholder="Filter by event type, delta, or tool name…"
            className="w-full bg-ink-900 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-text"
          />
        </label>
        <label className="text-sm text-ink-300">
          <span className="sr-only">Direction</span>
          <select
            value={direction}
            onChange={e => {
              setDirection(e.target.value as DirFilter);
              setShownPages(1);
            }}
            className="bg-ink-900 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-text"
          >
            <option value="all">all directions</option>
            <option value="sent">sent</option>
            <option value="received">received</option>
            <option value="connect">connect</option>
          </select>
        </label>
        <div className="text-xs text-ink-400">
          {filtered.length.toLocaleString()} / {session.wsEvents.length.toLocaleString()} events
          {hasMore && (
            <span className="ml-2 text-ink-500">
              (showing first {visibleCount.toLocaleString()})
            </span>
          )}
        </div>
      </div>

      {session.wsEvents.length === 0 ? (
        <p className="text-ink-400 italic text-sm">
          No WebSocket events in this dump. (HTTP-only sessions have no ws-events.ndjson.)
        </p>
      ) : (
        <>
          <ul className="font-mono text-xs space-y-0.5">
            {visible.map((ev, i) => {
              const color =
                ev.direction === 'sent'
                  ? 'text-accent-sent'
                  : ev.direction === 'received'
                    ? 'text-accent-recv'
                    : 'text-ink-400';
              const key = `${ev.line}:${ev.ts_ms}:${i}`;
              return (
                <li key={key}>
                  <button
                    type="button"
                    className="w-full text-left hover:bg-ink-800 px-2 py-1 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-text"
                    onClick={() => setOpenKey(openKey === key ? null : key)}
                  >
                    <span className="text-ink-500 mr-2">L{String(ev.line).padStart(4, '0')}</span>
                    <span className="text-ink-500 mr-2">{fmtClock(ev.ts_ms)}</span>
                    <span className={`${color} mr-2`}>{ev.direction.padEnd(8)}</span>
                    <span className="text-ink-200">{ev.body?.type ?? '(no type)'}</span>
                    {typeof ev.body?.delta === 'string' && (
                      <span className="text-ink-400"> · {ev.body.delta.length}b delta</span>
                    )}
                    {typeof ev.body?.item?.name === 'string' && (
                      <span className="text-accent-tool"> · {ev.body.item.name}</span>
                    )}
                  </button>
                  {openKey === key && (
                    <div className="my-2 ml-6">
                      <JsonView data={ev.body} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShownPages(p => p + 1)}
                className="px-3 py-1.5 text-sm bg-ink-800 border border-ink-700 rounded-md hover:bg-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-text"
              >
                Show {Math.min(PAGE_SIZE, filtered.length - visibleCount).toLocaleString()} more
              </button>
              <button
                type="button"
                onClick={() =>
                  setShownPages(Math.ceil(filtered.length / PAGE_SIZE))
                }
                className="text-xs text-ink-400 hover:text-ink-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-text rounded px-1"
              >
                show all {filtered.length.toLocaleString()}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
