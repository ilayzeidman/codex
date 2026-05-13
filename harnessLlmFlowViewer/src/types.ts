export type Direction = 'sent' | 'received' | 'connect';

export interface WsEvent {
  ts_ms: number;
  direction: Direction;
  body: any;
  /** Original NDJSON line index (1-based). */
  line: number;
}

export interface Manifest {
  codex_version: string;
  session_id: string;
  thread_id: string;
  session_source: string;
  started_at_unix_ms: number;
  started_at_iso: string;
  model_provider_id: string;
  model: string;
  redacted_headers: string[];
  /** Optional fields some manifests may carry; tolerated. */
  [key: string]: any;
}

export interface HttpHeader {
  name: string;
  value: string;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers: HttpHeader[];
  body: any;
}

export interface HttpStreamChunk {
  chunk: number;
  elapsed_ms: number;
  bytes_len: number;
  body: any;
}

export interface HttpResponse {
  status: number;
  headers: HttpHeader[];
  body: any;
  elapsed_ms: number;
  truncated_by_error?: string;
}

export interface HttpCall {
  seq: string;
  ts_ms: number;
  request: HttpRequest;
  stream: HttpStreamChunk[];
  response?: HttpResponse;
  /** Convenience: the response.created request id if we can pull it from body. */
  url: string;
}

export interface ReconstructedMessage {
  kind: 'message';
  itemId: string;
  text: string;
  addedTs: number;
  doneTs?: number;
}

export interface ReconstructedFunctionCall {
  kind: 'function_call';
  itemId: string;
  callId?: string;
  name: string;
  argsJson: string;
  argsParsed?: any;
  output?: string;
  outputJson?: any;
  addedTs: number;
  doneTs?: number;
}

export interface ReconstructedReasoning {
  kind: 'reasoning';
  itemId: string;
  addedTs: number;
  doneTs?: number;
  raw?: any;
}

/** A `custom_tool_call` is a freeform-string tool invocation (e.g. apply_patch).
 *  Streams via `response.custom_tool_call_input.delta` and is finalized by
 *  `response.custom_tool_call_input.done`. `input` is reassembled here. */
export interface ReconstructedCustomToolCall {
  kind: 'custom_tool_call';
  itemId: string;
  callId?: string;
  name: string;
  input: string;
  addedTs: number;
  doneTs?: number;
}

export type OutputItem =
  | ReconstructedMessage
  | ReconstructedFunctionCall
  | ReconstructedReasoning
  | ReconstructedCustomToolCall;

/** True for any model-emitted tool call (standard JSON-args OR custom freeform).
 *  Use this everywhere the UI counts/badges/lists "tool calls" so custom tools
 *  like apply_patch don't get silently excluded. */
export type ToolCallItem = ReconstructedFunctionCall | ReconstructedCustomToolCall;
export function isToolCall(o: OutputItem): o is ToolCallItem {
  return o.kind === 'function_call' || o.kind === 'custom_tool_call';
}

export interface Turn {
  index: number;
  startTs: number;
  endTs?: number;
  durationMs?: number;
  /** Time from `sent` response.create → first `output_item.added` or first delta.
   *  Misleading on reasoning-heavy turns: a reasoning item's `output_item.added`
   *  fires early even though the wire stays silent for seconds while reasoning
   *  tokens are generated server-side. Pair with `ttfvbMs` for the honest read. */
  ttftMs?: number;
  /** Time from `sent` response.create → first **visible** byte on the wire
   *  (first `output_text.delta` or `function_call_arguments.delta`). Skips
   *  the reasoning placeholder, so on reasoning models this captures real
   *  user-perceived "time until I see something". */
  ttfvbMs?: number;
  /** True when the turn was never followed by a response.completed in the dump. */
  interrupted?: boolean;
  /** Full `response.create` body. */
  request: any;
  /** All events belonging to this turn (including the sent). */
  events: WsEvent[];
  outputs: OutputItem[];
  /** Total streamed text-delta bytes. */
  textDeltaBytes: number;
  /** Final `response.completed` payload (response object). */
  completed?: any;
  rateLimits?: any;
  /** Token usage pulled from completed.response.usage when present. */
  usage?: TokenUsage;
}

export interface TokenUsage {
  input_tokens?: number;
  input_cached_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  total_tokens?: number;
}

export interface Session {
  manifest: Manifest;
  turns: Turn[];
  httpCalls: HttpCall[];
  wsEvents: WsEvent[];
  /** Raw text of ws-events.ndjson for download links (kept small refs only). */
  hasWsEvents: boolean;
  /** Files in the folder (debug / "what was found"). */
  files: Array<{ name: string; size: number }>;
  /** Total duration across all turns (ms). */
  totalDurationMs: number;
}
