import {
  HttpCall,
  HttpStreamChunk,
  Manifest,
  OutputItem,
  ReconstructedCustomToolCall,
  ReconstructedFunctionCall,
  ReconstructedMessage,
  ReconstructedReasoning,
  Request,
  Session,
  TokenUsage,
  WsEvent,
} from './types';
import { safeJsonParse } from './lib/format';

interface RawFile {
  /** name relative to the dump folder (manifest.json, ws-events.ndjson, 000001-...-request.json) */
  name: string;
  text: string;
  size: number;
}

/**
 * Parse a dump folder. Input is the set of files inside one session folder
 * (the folder named after thread_id). Tolerates missing files.
 */
export async function parseDump(rawFiles: RawFile[]): Promise<Session> {
  const byName = new Map<string, RawFile>();
  for (const f of rawFiles) byName.set(f.name, f);

  // Manifest
  const manifestFile = byName.get('manifest.json');
  if (!manifestFile) {
    // Detect common mistakes for a helpful error.
    const nestedManifests = rawFiles
      .map(f => f.name)
      .filter(n => /(^|\/)manifest\.json$/.test(n))
      .map(n => n.replace(/\/manifest\.json$/, ''));
    if (nestedManifests.length > 0) {
      throw new Error(
        `Looks like you dropped a parent folder containing ${nestedManifests.length} session folder(s). ` +
          `Drop one of these instead: ${nestedManifests.slice(0, 4).join(', ')}` +
          (nestedManifests.length > 4 ? `, … (+${nestedManifests.length - 4} more)` : ''),
      );
    }
    if (rawFiles.length === 1 && /\.ndjson$/.test(rawFiles[0].name)) {
      throw new Error(
        `Got a single ${rawFiles[0].name} file but no manifest.json. ` +
          `Drop the session folder (containing both manifest.json and ws-events.ndjson) instead of just the NDJSON.`,
      );
    }
    throw new Error(
      `Folder is missing manifest.json. ` +
        `Drop the per-session folder (named after the thread UUID).`,
    );
  }
  let manifest: Manifest;
  try {
    manifest = JSON.parse(manifestFile.text);
  } catch (e) {
    throw new Error(`manifest.json is not valid JSON: ${(e as Error).message}`);
  }
  // Tolerate manifests missing optional fields without crashing UI consumers.
  if (typeof manifest.started_at_unix_ms !== 'number') {
    manifest.started_at_unix_ms = 0;
  }
  if (!Array.isArray(manifest.redacted_headers)) {
    manifest.redacted_headers = [];
  }
  if (typeof manifest.model_provider_id !== 'string') {
    manifest.model_provider_id = '';
  }
  if (typeof manifest.session_source !== 'string') {
    manifest.session_source = '';
  }
  if (typeof manifest.model !== 'string') manifest.model = '';
  if (typeof manifest.codex_version !== 'string') manifest.codex_version = '';
  if (typeof manifest.thread_id !== 'string') manifest.thread_id = '';

  // WS events
  const wsFile = byName.get('ws-events.ndjson');
  const wsEvents: WsEvent[] = [];
  if (wsFile) {
    const lines = wsFile.text.split(/\r?\n/);
    let lineNo = 0;
    for (const raw of lines) {
      lineNo += 1;
      if (!raw.trim()) continue;
      const obj = safeJsonParse(raw);
      if (!obj) continue;
      wsEvents.push({
        ts_ms: Number(obj.ts_ms) || 0,
        direction: obj.direction,
        body: obj.body,
        line: lineNo,
      });
    }
  }

  // HTTP triplets
  const httpCalls = parseHttpTriplets(rawFiles);

  // Request segmentation: synthesize WS-like events from HTTP triplets so the
  // same segmenter produces one Request entry per HTTP roundtrip, then merge with WS.
  const httpEvents: WsEvent[] = httpCalls.flatMap(call => synthesizeEventsFromHttpCall(call));
  const allEvents = [...wsEvents, ...httpEvents].sort((a, b) => a.ts_ms - b.ts_ms);
  const requests = segmentRequests(allEvents);

  const totalDurationMs = requests.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);

  return {
    manifest,
    requests,
    httpCalls,
    wsEvents,
    hasWsEvents: !!wsFile,
    files: rawFiles
      .map(f => ({ name: f.name, size: f.size }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    totalDurationMs,
  };
}

function parseHttpTriplets(files: RawFile[]): HttpCall[] {
  // group by seq prefix "NNNNNN-<unix-ms>-"
  const groups = new Map<string, { ts_ms: number; request?: RawFile; response?: RawFile; stream?: RawFile }>();
  for (const f of files) {
    const m = /^(\d{6})-(\d+)-(request|response|stream)\.(json|ndjson)$/.exec(f.name);
    if (!m) continue;
    const seq = m[1];
    const ts = Number(m[2]);
    const kind = m[3];
    const key = `${seq}-${ts}`;
    if (!groups.has(key)) groups.set(key, { ts_ms: ts });
    const g = groups.get(key)!;
    if (kind === 'request') g.request = f;
    else if (kind === 'response') g.response = f;
    else if (kind === 'stream') g.stream = f;
  }

  const out: HttpCall[] = [];
  for (const [key, g] of groups.entries()) {
    if (!g.request) continue;
    const seq = key.split('-')[0];
    let req: any;
    try {
      req = JSON.parse(g.request.text);
    } catch {
      continue;
    }
    let resp: any | undefined;
    if (g.response) {
      try {
        resp = JSON.parse(g.response.text);
      } catch {
        resp = undefined;
      }
    }
    const stream: HttpStreamChunk[] = [];
    if (g.stream) {
      for (const line of g.stream.text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const o = safeJsonParse(line);
        if (o) stream.push(o);
      }
    }
    out.push({
      seq,
      ts_ms: g.ts_ms,
      request: {
        method: req.method ?? 'GET',
        url: req.url ?? '',
        headers: req.headers ?? [],
        body: req.body,
      },
      url: req.url ?? '',
      response: resp,
      stream,
    });
  }
  out.sort((a, b) => a.ts_ms - b.ts_ms);
  return out;
}

/**
 * Map a request/stream/response triplet onto the same event shape the WS
 * segmenter consumes, so HTTP-only dumps light up the per-request views.
 * - request body becomes a synthetic `sent` `response.create`.
 * - each stream chunk's `body` is treated as a `received` model event.
 * - the unary response, if present, becomes a `received` `response.completed`.
 */
function synthesizeEventsFromHttpCall(call: HttpCall): WsEvent[] {
  const out: WsEvent[] = [];
  out.push({
    ts_ms: call.ts_ms,
    direction: 'sent',
    body: { type: 'response.create', ...(call.request.body && typeof call.request.body === 'object' ? call.request.body : {}) },
    line: 0,
  });
  for (const chunk of call.stream) {
    if (!chunk || !chunk.body || typeof chunk.body !== 'object') continue;
    out.push({
      ts_ms: call.ts_ms + (chunk.elapsed_ms ?? 0),
      direction: 'received',
      body: chunk.body,
      line: 0,
    });
  }
  if (call.response && call.response.body && typeof call.response.body === 'object') {
    // If the unary response is the final `response.completed`, surface it.
    out.push({
      ts_ms: call.ts_ms + (call.response.elapsed_ms ?? 0),
      direction: 'received',
      body: call.response.body,
      line: 0,
    });
  }
  return out;
}

function segmentRequests(events: WsEvent[]): Request[] {
  const requests: Request[] = [];
  let current: Request | null = null;

  const finishRequest = (interrupted: boolean) => {
    if (!current) return;
    current.outputs.sort((a, b) => a.addedTs - b.addedTs);
    if (current.completed?.usage) {
      current.usage = pickUsage(current.completed.usage);
    }
    if (current.endTs === undefined) {
      // Interrupted (no response.completed): synthesize from last seen event.
      const last = current.events[current.events.length - 1];
      if (last && last.ts_ms !== current.startTs) current.endTs = last.ts_ms;
    }
    if (current.endTs !== undefined) {
      current.durationMs = current.endTs - current.startTs;
    }
    if (interrupted) current.interrupted = true;
    requests.push(current);
    current = null;
  };

  // helper maps per-request item builders
  let itemsById = new Map<string, OutputItem>();

  for (const ev of events) {
    const t = ev.body?.type as string | undefined;
    // Start a new request on each outbound `response.create`.
    if (ev.direction === 'sent' && t === 'response.create') {
      // close previous if still open (interrupted: no response.completed seen)
      if (current) finishRequest(true);
      current = {
        index: requests.length + 1,
        startTs: ev.ts_ms,
        requestBody: ev.body,
        events: [ev],
        outputs: [],
        textDeltaBytes: 0,
      };
      itemsById = new Map();
      continue;
    }

    // Connect-frame: include as its own "request 0" only if it stands alone
    if (ev.direction === 'connect') {
      // record into nothing — viewer shows connect events separately
      continue;
    }

    if (!current) {
      // received frames before any request started: ignore for segmentation
      continue;
    }
    current.events.push(ev);

    switch (t) {
      case 'response.created':
      case 'response.in_progress':
        // metadata, captured via events
        break;

      case 'response.output_item.added': {
        const item = ev.body.item;
        if (current.ttftMs === undefined) {
          current.ttftMs = ev.ts_ms - current.startTs;
        }
        if (!item || !item.id) break;
        if (item.type === 'message') {
          const m: ReconstructedMessage = {
            kind: 'message',
            itemId: item.id,
            text: '',
            addedTs: ev.ts_ms,
          };
          itemsById.set(item.id, m);
          current.outputs.push(m);
        } else if (item.type === 'function_call') {
          const fc: ReconstructedFunctionCall = {
            kind: 'function_call',
            itemId: item.id,
            callId: item.call_id,
            name: item.name ?? '<unknown>',
            argsJson: item.arguments ?? '',
            addedTs: ev.ts_ms,
          };
          itemsById.set(item.id, fc);
          current.outputs.push(fc);
        } else if (item.type === 'reasoning') {
          const r: ReconstructedReasoning = {
            kind: 'reasoning',
            itemId: item.id,
            addedTs: ev.ts_ms,
            raw: item,
          };
          itemsById.set(item.id, r);
          current.outputs.push(r);
        } else if (item.type === 'custom_tool_call') {
          const ctc: ReconstructedCustomToolCall = {
            kind: 'custom_tool_call',
            itemId: item.id,
            callId: item.call_id,
            name: item.name ?? '<unknown>',
            input: typeof item.input === 'string' ? item.input : '',
            addedTs: ev.ts_ms,
          };
          itemsById.set(item.id, ctc);
          current.outputs.push(ctc);
        }
        break;
      }

      case 'response.output_text.delta': {
        const id = ev.body.item_id;
        const item = id ? itemsById.get(id) : undefined;
        const delta: string = ev.body.delta ?? '';
        if (item && item.kind === 'message') {
          item.text += delta;
        }
        current.textDeltaBytes += new TextEncoder().encode(delta).length;
        if (current.ttftMs === undefined) {
          current.ttftMs = ev.ts_ms - current.startTs;
        }
        if (current.ttfvbMs === undefined) {
          current.ttfvbMs = ev.ts_ms - current.startTs;
        }
        break;
      }

      case 'response.output_text.done': {
        const id = ev.body.item_id;
        const item = id ? itemsById.get(id) : undefined;
        if (item && item.kind === 'message' && typeof ev.body.text === 'string') {
          // Prefer authoritative final text.
          item.text = ev.body.text;
        }
        break;
      }

      case 'response.function_call_arguments.delta': {
        const id = ev.body.item_id;
        const item = id ? itemsById.get(id) : undefined;
        const delta: string = ev.body.delta ?? '';
        if (item && item.kind === 'function_call') {
          item.argsJson += delta;
        }
        if (current.ttftMs === undefined) {
          current.ttftMs = ev.ts_ms - current.startTs;
        }
        if (current.ttfvbMs === undefined) {
          current.ttfvbMs = ev.ts_ms - current.startTs;
        }
        break;
      }

      case 'response.function_call_arguments.done': {
        const id = ev.body.item_id;
        const item = id ? itemsById.get(id) : undefined;
        if (item && item.kind === 'function_call') {
          if (typeof ev.body.arguments === 'string') {
            item.argsJson = ev.body.arguments;
          }
          item.argsParsed = safeJsonParse(item.argsJson);
        }
        break;
      }

      case 'response.custom_tool_call_input.delta': {
        const id = ev.body.item_id;
        const item = id ? itemsById.get(id) : undefined;
        const delta: string = ev.body.delta ?? '';
        if (item && item.kind === 'custom_tool_call') {
          item.input += delta;
        }
        // Custom tool input is visible bytes on the wire (e.g. apply_patch
        // streams the patch text byte-by-byte). Count toward delta bytes and
        // TTFT/TTFVB just like text and function-call args.
        current.textDeltaBytes += new TextEncoder().encode(delta).length;
        if (current.ttftMs === undefined) {
          current.ttftMs = ev.ts_ms - current.startTs;
        }
        if (current.ttfvbMs === undefined) {
          current.ttfvbMs = ev.ts_ms - current.startTs;
        }
        break;
      }

      case 'response.custom_tool_call_input.done': {
        const id = ev.body.item_id;
        const item = id ? itemsById.get(id) : undefined;
        if (item && item.kind === 'custom_tool_call' && typeof ev.body.input === 'string') {
          // Prefer the authoritative final input (in case deltas were lossy).
          item.input = ev.body.input;
        }
        break;
      }

      case 'response.output_item.done': {
        const item = ev.body.item;
        const id = item?.id;
        const existing = id ? itemsById.get(id) : undefined;
        if (existing) existing.doneTs = ev.ts_ms;
        // Function calls might carry an `output` here on some providers
        if (existing && existing.kind === 'function_call' && item) {
          if (typeof item.output === 'string') existing.output = item.output;
          else if (item.output !== undefined) {
            existing.outputJson = item.output;
            existing.output = JSON.stringify(item.output);
          }
        }
        break;
      }

      case 'response.completed': {
        current.endTs = ev.ts_ms;
        current.completed = ev.body.response ?? ev.body;
        finishRequest(false);
        break;
      }

      case 'codex.rate_limits':
        current.rateLimits = ev.body;
        break;

      default:
        // unknown event types — kept in events for raw viewer
        break;
    }
  }

  if (current) finishRequest(true);
  return requests;
}

function pickUsage(u: any): TokenUsage {
  return {
    input_tokens: u?.input_tokens,
    input_cached_tokens: u?.input_tokens_details?.cached_tokens,
    output_tokens: u?.output_tokens,
    reasoning_tokens: u?.output_tokens_details?.reasoning_tokens,
    total_tokens: u?.total_tokens,
  };
}
