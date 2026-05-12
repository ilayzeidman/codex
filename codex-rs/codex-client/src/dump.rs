//! Optional debug dump of LLM HTTP traffic.
//!
//! When enabled via a `SessionDumper`, every request and response that flows through
//! a [`DumpingTransport`] is written to a per-session folder. Designed for learning
//! how the Codex harness drives the model, not for production telemetry.
//!
//! Sensitive headers (`authorization`, anything containing `cookie`, `x-api-key`) are
//! always redacted to `[REDACTED]` before being written to disk.

use std::fs;
use std::io::Write as _;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::OnceLock;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;
use std::task::Context;
use std::task::Poll;
use std::time::Duration;
use std::time::Instant;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

use async_trait::async_trait;
use bytes::Bytes;
use bytes::BytesMut;
use futures::Stream;
use http::HeaderMap;
use http::StatusCode;
use serde::Serialize;
use serde_json::Value;
use tracing::warn;

use crate::error::TransportError;
use crate::request::Request;
use crate::request::RequestBody;
use crate::request::Response;
use crate::transport::ByteStream;
use crate::transport::HttpTransport;
use crate::transport::ReqwestTransport;
use crate::transport::StreamResponse;

const REDACTED_HEADER_VALUE: &str = "[REDACTED]";
const REDACTED_HEADER_NAMES: &[&str] = &["authorization", "x-api-key"];

/// Caller-supplied configuration for an LLM-traffic dump session.
#[derive(Debug, Clone)]
pub struct DumpConfig {
    /// Root directory under which per-session folders are created.
    pub root_dir: PathBuf,
    /// Additional header names (case-insensitive) to redact on top of the defaults.
    pub extra_redacted_headers: Vec<String>,
}

impl DumpConfig {
    pub fn new(root_dir: PathBuf) -> Self {
        Self {
            root_dir,
            extra_redacted_headers: Vec::new(),
        }
    }
}

/// Static metadata written to `manifest.json` on first use of a session.
#[derive(Debug, Clone, Serialize)]
pub struct Manifest {
    pub codex_version: String,
    pub session_id: String,
    pub thread_id: String,
    pub session_source: String,
    pub started_at_unix_ms: u128,
    pub started_at_iso: String,
    pub model_provider_id: String,
    pub model: Option<String>,
    pub redacted_headers: Vec<String>,
}

/// Owns one session's dump folder and shares its sequence counter via `Arc`.
#[derive(Debug, Clone)]
pub struct SessionDumper {
    inner: Arc<SessionDumperInner>,
}

#[derive(Debug)]
struct SessionDumperInner {
    dir: PathBuf,
    next_seq: AtomicU64,
    extra_redacted_headers: Vec<String>,
    manifest: Option<Manifest>,
    setup: OnceLock<()>,
}

impl SessionDumper {
    /// Create a session dumper that writes under `<root>/<session_label>/`.
    pub fn for_session(cfg: &DumpConfig, session_label: &str, manifest: Manifest) -> Self {
        let dir = cfg.root_dir.join(session_label);
        Self::build(dir, &cfg.extra_redacted_headers, Some(manifest))
    }

    /// Create a session dumper for early-startup calls that don't yet have a session id.
    /// Writes under `<root>/_no-session/`.
    pub fn no_session(cfg: &DumpConfig) -> Self {
        let dir = cfg.root_dir.join("_no-session");
        Self::build(dir, &cfg.extra_redacted_headers, None)
    }

    fn build(dir: PathBuf, extra: &[String], manifest: Option<Manifest>) -> Self {
        Self {
            inner: Arc::new(SessionDumperInner {
                dir,
                next_seq: AtomicU64::new(1),
                extra_redacted_headers: extra.to_vec(),
                manifest,
                setup: OnceLock::new(),
            }),
        }
    }

    fn next_prefix(&self) -> (u64, u128) {
        let seq = self.inner.next_seq.fetch_add(1, Ordering::Relaxed);
        let ts_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis());
        (seq, ts_ms)
    }

    /// Append one event to `ws-events.ndjson` for this session.
    ///
    /// `direction` is `"connect"`, `"sent"`, `"received"`, or `"closed"`.
    /// `payload` is the raw text frame; it is parsed as JSON when possible,
    /// otherwise stored as a string. Use this for WebSocket transports that
    /// don't go through the `HttpTransport` chokepoint.
    pub fn dump_ws_event(&self, direction: &str, payload: &str) {
        self.ensure_setup();
        let ts_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis());
        let line = serde_json::json!({
            "ts_ms": ts_ms,
            "direction": direction,
            "body": body_value_from_bytes(payload.as_bytes()),
        });
        let path = self.inner.dir.join("ws-events.ndjson");
        match serde_json::to_vec(&line) {
            Ok(mut buf) => {
                buf.push(b'\n');
                if let Err(err) = fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&path)
                    .and_then(|mut f| f.write_all(&buf))
                {
                    warn!(
                        path = %path.display(),
                        error = %err,
                        "failed to append WS event to dump",
                    );
                }
            }
            Err(err) => warn!(error = %err, "failed to serialize WS event for dump"),
        }
    }

    /// Lazily create the dump directory + manifest on first write.
    fn ensure_setup(&self) {
        self.inner.setup.get_or_init(|| {
            if let Err(err) = fs::create_dir_all(&self.inner.dir) {
                warn!(
                    dir = %self.inner.dir.display(),
                    error = %err,
                    "failed to create LLM dump directory",
                );
                return;
            }
            if let Some(manifest) = &self.inner.manifest {
                let path = self.inner.dir.join("manifest.json");
                write_json_pretty(&path, manifest);
            }
        });
    }
}

/// Decorates an inner `HttpTransport` to write each request/response pair to disk.
#[derive(Debug, Clone)]
pub struct DumpingTransport<T> {
    inner: T,
    dumper: SessionDumper,
}

impl<T> DumpingTransport<T> {
    pub fn new(inner: T, dumper: SessionDumper) -> Self {
        Self { inner, dumper }
    }
}

#[async_trait]
impl<T: HttpTransport> HttpTransport for DumpingTransport<T> {
    async fn execute(&self, req: Request) -> Result<Response, TransportError> {
        let (seq, ts_ms) = self.dumper.next_prefix();
        let prefix = format!("{seq:06}-{ts_ms}");
        write_request_dump(&self.dumper, &prefix, &req);
        let started = Instant::now();
        let res = self.inner.execute(req).await;
        write_unary_response_dump(&self.dumper, &prefix, started.elapsed(), &res);
        res
    }

    async fn stream(&self, req: Request) -> Result<StreamResponse, TransportError> {
        let (seq, ts_ms) = self.dumper.next_prefix();
        let prefix = format!("{seq:06}-{ts_ms}");
        write_request_dump(&self.dumper, &prefix, &req);
        let started = Instant::now();
        match self.inner.stream(req).await {
            Err(err) => {
                write_stream_open_error_dump(&self.dumper, &prefix, started.elapsed(), &err);
                Err(err)
            }
            Ok(StreamResponse {
                status,
                headers,
                bytes,
            }) => {
                let dumped_headers = headers.clone();
                let wrapped = DumpStream::new(
                    bytes,
                    self.dumper.clone(),
                    prefix,
                    started,
                    status,
                    dumped_headers,
                );
                Ok(StreamResponse {
                    status,
                    headers,
                    bytes: Box::pin(wrapped),
                })
            }
        }
    }
}

/// Enum dispatch so call sites have a stable concrete return type whether dumping is on or off.
/// Avoids `Box<dyn HttpTransport>` which would force generic-bound changes throughout `codex-api`.
#[derive(Debug, Clone)]
pub enum AnyTransport {
    Plain(ReqwestTransport),
    Dumping(DumpingTransport<ReqwestTransport>),
}

#[async_trait]
impl HttpTransport for AnyTransport {
    async fn execute(&self, req: Request) -> Result<Response, TransportError> {
        match self {
            Self::Plain(t) => t.execute(req).await,
            Self::Dumping(t) => t.execute(req).await,
        }
    }

    async fn stream(&self, req: Request) -> Result<StreamResponse, TransportError> {
        match self {
            Self::Plain(t) => t.stream(req).await,
            Self::Dumping(t) => t.stream(req).await,
        }
    }
}

struct DumpStream {
    inner: ByteStream,
    dumper: SessionDumper,
    prefix: String,
    started: Instant,
    status: StatusCode,
    headers: HeaderMap,
    aggregated: BytesMut,
    chunk_index: u64,
    flushed: bool,
    error: Option<String>,
}

impl DumpStream {
    fn new(
        inner: ByteStream,
        dumper: SessionDumper,
        prefix: String,
        started: Instant,
        status: StatusCode,
        headers: HeaderMap,
    ) -> Self {
        Self {
            inner,
            dumper,
            prefix,
            started,
            status,
            headers,
            aggregated: BytesMut::new(),
            chunk_index: 0,
            flushed: false,
            error: None,
        }
    }

    fn append_chunk(&mut self, chunk: &Bytes) {
        self.dumper.ensure_setup();
        let line = serde_json::json!({
            "chunk": self.chunk_index,
            "elapsed_ms": self.started.elapsed().as_millis(),
            "bytes_len": chunk.len(),
            "body": body_value_from_bytes(chunk),
        });
        let path = self.dumper.inner.dir.join(format!("{}-stream.ndjson", self.prefix));
        match serde_json::to_vec(&line) {
            Ok(mut buf) => {
                buf.push(b'\n');
                if let Err(err) = fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&path)
                    .and_then(|mut f| f.write_all(&buf))
                {
                    warn!(
                        path = %path.display(),
                        error = %err,
                        "failed to append stream chunk to dump",
                    );
                }
            }
            Err(err) => warn!(error = %err, "failed to serialize stream chunk for dump"),
        }
        self.chunk_index += 1;
    }

    fn flush_response(&mut self) {
        if self.flushed {
            return;
        }
        self.flushed = true;
        self.dumper.ensure_setup();
        let dump = ResponseDump {
            status: self.status.as_u16(),
            headers: serialize_headers(&self.headers, &self.dumper.inner.extra_redacted_headers),
            elapsed_ms: self.started.elapsed().as_millis(),
            body: body_value_from_bytes(&self.aggregated),
            truncated_by_error: self.error.clone(),
            stream_chunks: Some(self.chunk_index),
        };
        let path = self
            .dumper
            .inner
            .dir
            .join(format!("{}-response.json", self.prefix));
        write_json_pretty(&path, &dump);
    }
}

impl Stream for DumpStream {
    type Item = Result<Bytes, TransportError>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let me = &mut *self;
        match me.inner.as_mut().poll_next(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(None) => {
                me.flush_response();
                Poll::Ready(None)
            }
            Poll::Ready(Some(Ok(chunk))) => {
                me.append_chunk(&chunk);
                me.aggregated.extend_from_slice(&chunk);
                Poll::Ready(Some(Ok(chunk)))
            }
            Poll::Ready(Some(Err(err))) => {
                me.error = Some(err.to_string());
                me.flush_response();
                Poll::Ready(Some(Err(err)))
            }
        }
    }
}

impl Drop for DumpStream {
    fn drop(&mut self) {
        self.flush_response();
    }
}

#[derive(Serialize)]
struct RequestDump<'a> {
    method: &'a str,
    url: &'a str,
    headers: Vec<HeaderDump>,
    body: Value,
}

#[derive(Serialize)]
struct ResponseDump {
    status: u16,
    headers: Vec<HeaderDump>,
    elapsed_ms: u128,
    body: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    truncated_by_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream_chunks: Option<u64>,
}

#[derive(Serialize)]
struct StreamOpenErrorDump<'a> {
    elapsed_ms: u128,
    error: &'a str,
}

#[derive(Debug, Serialize)]
struct HeaderDump {
    name: String,
    value: String,
}

fn write_request_dump(dumper: &SessionDumper, prefix: &str, req: &Request) {
    dumper.ensure_setup();
    let prepared_headers = req
        .prepare_body_for_send()
        .ok()
        .map(|p| p.headers)
        .unwrap_or_else(|| req.headers.clone());
    let body = match req.body.as_ref() {
        None => Value::Null,
        Some(RequestBody::Json(v)) => v.clone(),
        Some(RequestBody::Raw(bytes)) => body_value_from_bytes(bytes),
    };
    let dump = RequestDump {
        method: req.method.as_str(),
        url: req.url.as_str(),
        headers: serialize_headers(&prepared_headers, &dumper.inner.extra_redacted_headers),
        body,
    };
    let path = dumper.inner.dir.join(format!("{prefix}-request.json"));
    write_json_pretty(&path, &dump);
}

fn write_unary_response_dump(
    dumper: &SessionDumper,
    prefix: &str,
    elapsed: Duration,
    result: &Result<Response, TransportError>,
) {
    dumper.ensure_setup();
    let path = dumper.inner.dir.join(format!("{prefix}-response.json"));
    match result {
        Ok(resp) => {
            let dump = ResponseDump {
                status: resp.status.as_u16(),
                headers: serialize_headers(&resp.headers, &dumper.inner.extra_redacted_headers),
                elapsed_ms: elapsed.as_millis(),
                body: body_value_from_bytes(&resp.body),
                truncated_by_error: None,
                stream_chunks: None,
            };
            write_json_pretty(&path, &dump);
        }
        Err(err) => {
            // Capture HTTP errors with full context; opaque errors get a minimal record.
            let dump = match err {
                TransportError::Http {
                    status,
                    url: _,
                    headers,
                    body,
                } => {
                    let headers = headers
                        .as_ref()
                        .map(|h| serialize_headers(h, &dumper.inner.extra_redacted_headers))
                        .unwrap_or_default();
                    let body = body
                        .as_ref()
                        .map(|b| body_value_from_bytes(b.as_bytes()))
                        .unwrap_or(Value::Null);
                    ResponseDump {
                        status: status.as_u16(),
                        headers,
                        elapsed_ms: elapsed.as_millis(),
                        body,
                        truncated_by_error: None,
                        stream_chunks: None,
                    }
                }
                other => ResponseDump {
                    status: 0,
                    headers: Vec::new(),
                    elapsed_ms: elapsed.as_millis(),
                    body: Value::Null,
                    truncated_by_error: Some(other.to_string()),
                    stream_chunks: None,
                },
            };
            write_json_pretty(&path, &dump);
        }
    }
}

fn write_stream_open_error_dump(
    dumper: &SessionDumper,
    prefix: &str,
    elapsed: Duration,
    err: &TransportError,
) {
    dumper.ensure_setup();
    // Reuse ResponseDump for HTTP errors so they look like unary failures.
    if let TransportError::Http {
        status,
        url: _,
        headers,
        body,
    } = err
    {
        let dump = ResponseDump {
            status: status.as_u16(),
            headers: headers
                .as_ref()
                .map(|h| serialize_headers(h, &dumper.inner.extra_redacted_headers))
                .unwrap_or_default(),
            elapsed_ms: elapsed.as_millis(),
            body: body
                .as_ref()
                .map(|b| body_value_from_bytes(b.as_bytes()))
                .unwrap_or(Value::Null),
            truncated_by_error: None,
            stream_chunks: None,
        };
        let path = dumper.inner.dir.join(format!("{prefix}-response.json"));
        write_json_pretty(&path, &dump);
        return;
    }
    let msg = err.to_string();
    let dump = StreamOpenErrorDump {
        elapsed_ms: elapsed.as_millis(),
        error: &msg,
    };
    let path = dumper.inner.dir.join(format!("{prefix}-response.json"));
    write_json_pretty(&path, &dump);
}

fn serialize_headers(headers: &HeaderMap, extra_redacted: &[String]) -> Vec<HeaderDump> {
    headers
        .iter()
        .map(|(name, value)| {
            let name_str = name.as_str();
            let redacted = should_redact_header(name_str, extra_redacted);
            let value_str = if redacted {
                REDACTED_HEADER_VALUE.to_string()
            } else {
                String::from_utf8_lossy(value.as_bytes()).into_owned()
            };
            HeaderDump {
                name: name_str.to_string(),
                value: value_str,
            }
        })
        .collect()
}

fn should_redact_header(name: &str, extra: &[String]) -> bool {
    let lower = name.to_ascii_lowercase();
    if REDACTED_HEADER_NAMES.iter().any(|n| *n == lower.as_str()) {
        return true;
    }
    if lower.contains("cookie") {
        return true;
    }
    extra.iter().any(|h| h.eq_ignore_ascii_case(name))
}

fn body_value_from_bytes(bytes: &[u8]) -> Value {
    if bytes.is_empty() {
        return Value::Null;
    }
    serde_json::from_slice(bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(bytes).into_owned()))
}

fn write_json_pretty<T: Serialize>(path: &PathBuf, value: &T) {
    match serde_json::to_vec_pretty(value) {
        Ok(mut bytes) => {
            bytes.push(b'\n');
            if let Err(err) = fs::write(path, &bytes) {
                warn!(
                    path = %path.display(),
                    error = %err,
                    "failed to write LLM dump file",
                );
            }
        }
        Err(err) => warn!(error = %err, "failed to serialize LLM dump"),
    }
}

/// Build the ISO-8601 string used in the manifest. Public so callers building the
/// manifest can use the same format without depending on chrono.
pub fn iso_timestamp_now_unix_ms() -> (u128, String) {
    let now = SystemTime::now();
    let unix_ms = now
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    let secs = (unix_ms / 1_000) as i64;
    let nanos = ((unix_ms % 1_000) as u32) * 1_000_000;
    let iso = format_unix_seconds_iso(secs, nanos);
    (unix_ms, iso)
}

// Minimal date formatter so this module has no chrono/time dep.
// Produces YYYY-MM-DDTHH:MM:SS.mmmZ.
fn format_unix_seconds_iso(secs: i64, nanos: u32) -> String {
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400);
    let hours = (secs_of_day / 3_600) as u32;
    let minutes = ((secs_of_day % 3_600) / 60) as u32;
    let seconds = (secs_of_day % 60) as u32;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}.{:03}Z",
        nanos / 1_000_000
    )
}

// Howard Hinnant's "days from civil" inverse; converts days since 1970-01-01 to
// (year, month, day). Public-domain algorithm.
fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097) as u32;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::TransportError;
    use crate::request::Request;
    use bytes::Bytes;
    use futures::StreamExt;
    use futures::stream;
    use http::HeaderMap;
    use http::HeaderName;
    use http::HeaderValue;
    use http::Method;
    use http::StatusCode;
    use pretty_assertions::assert_eq;
    use serde_json::json;
    use tempfile::tempdir;

    struct FakeTransport {
        unary: std::sync::Mutex<Option<Response>>,
        stream_chunks: std::sync::Mutex<Option<Vec<Result<Bytes, TransportError>>>>,
        stream_open_error: std::sync::Mutex<Option<TransportError>>,
    }

    impl FakeTransport {
        fn with_unary(resp: Response) -> Self {
            Self {
                unary: std::sync::Mutex::new(Some(resp)),
                stream_chunks: std::sync::Mutex::new(None),
                stream_open_error: std::sync::Mutex::new(None),
            }
        }

        fn with_stream(chunks: Vec<Result<Bytes, TransportError>>) -> Self {
            Self {
                unary: std::sync::Mutex::new(None),
                stream_chunks: std::sync::Mutex::new(Some(chunks)),
                stream_open_error: std::sync::Mutex::new(None),
            }
        }
    }

    #[async_trait]
    impl HttpTransport for FakeTransport {
        async fn execute(&self, _req: Request) -> Result<Response, TransportError> {
            self.unary
                .lock()
                .unwrap()
                .take()
                .ok_or(TransportError::RetryLimit)
        }

        async fn stream(&self, _req: Request) -> Result<StreamResponse, TransportError> {
            if let Some(err) = self.stream_open_error.lock().unwrap().take() {
                return Err(err);
            }
            let chunks = self
                .stream_chunks
                .lock()
                .unwrap()
                .take()
                .unwrap_or_default();
            let bytes: ByteStream = Box::pin(stream::iter(chunks));
            Ok(StreamResponse {
                status: StatusCode::OK,
                headers: {
                    let mut h = HeaderMap::new();
                    h.insert(
                        HeaderName::from_static("content-type"),
                        HeaderValue::from_static("text/event-stream"),
                    );
                    h
                },
                bytes,
            })
        }
    }

    fn manifest() -> Manifest {
        Manifest {
            codex_version: "0.test".to_string(),
            session_id: "11111111-1111-4111-8111-111111111111".to_string(),
            thread_id: "22222222-2222-4222-8222-222222222222".to_string(),
            session_source: "Exec".to_string(),
            started_at_unix_ms: 0,
            started_at_iso: "2026-01-01T00:00:00.000Z".to_string(),
            model_provider_id: "openai".to_string(),
            model: Some("gpt-test".to_string()),
            redacted_headers: vec!["authorization".into(), "cookie*".into(), "x-api-key".into()],
        }
    }

    fn dump_config(root: &std::path::Path) -> DumpConfig {
        DumpConfig::new(root.to_path_buf())
    }

    #[tokio::test]
    async fn unary_request_dump_redacts_sensitive_headers_and_writes_json_body() {
        let tmp = tempdir().unwrap();
        let dumper = SessionDumper::for_session(&dump_config(tmp.path()), "tid", manifest());
        let resp = Response {
            status: StatusCode::OK,
            headers: {
                let mut h = HeaderMap::new();
                h.insert(
                    HeaderName::from_static("content-type"),
                    HeaderValue::from_static("application/json"),
                );
                h.insert(
                    HeaderName::from_static("set-cookie"),
                    HeaderValue::from_static("session=abc"),
                );
                h
            },
            body: Bytes::from_static(br#"{"ok":true}"#),
        };
        let inner = FakeTransport::with_unary(resp);
        let transport = DumpingTransport::new(inner, dumper);
        let mut req = Request::new(Method::POST, "https://example.com/v1/responses".to_string())
            .with_json(&json!({"model": "gpt-test"}));
        req.headers
            .insert("authorization", HeaderValue::from_static("Bearer SECRET"));
        req.headers
            .insert("x-api-key", HeaderValue::from_static("APIKEYSECRET"));
        req.headers
            .insert("x-codex-window-id", HeaderValue::from_static("tid:0"));

        let result = transport.execute(req).await;
        assert!(result.is_ok());

        let session_dir = tmp.path().join("tid");
        let request_path = find_file(&session_dir, "-request.json");
        let response_path = find_file(&session_dir, "-response.json");

        let request_dump: Value =
            serde_json::from_slice(&fs::read(&request_path).unwrap()).unwrap();
        assert_eq!(request_dump["method"], "POST");
        assert_eq!(request_dump["url"], "https://example.com/v1/responses");
        assert_eq!(request_dump["body"], json!({"model": "gpt-test"}));
        let headers = request_dump["headers"].as_array().unwrap();
        let auth = headers
            .iter()
            .find(|h| h["name"].as_str().unwrap().eq_ignore_ascii_case("authorization"))
            .unwrap();
        assert_eq!(auth["value"], "[REDACTED]");
        let apikey = headers
            .iter()
            .find(|h| h["name"].as_str().unwrap().eq_ignore_ascii_case("x-api-key"))
            .unwrap();
        assert_eq!(apikey["value"], "[REDACTED]");
        let window = headers
            .iter()
            .find(|h| h["name"].as_str().unwrap() == "x-codex-window-id")
            .unwrap();
        assert_eq!(window["value"], "tid:0");

        let response_dump: Value =
            serde_json::from_slice(&fs::read(&response_path).unwrap()).unwrap();
        assert_eq!(response_dump["status"], 200);
        assert_eq!(response_dump["body"], json!({"ok": true}));
        let response_headers = response_dump["headers"].as_array().unwrap();
        let cookie = response_headers
            .iter()
            .find(|h| h["name"].as_str().unwrap() == "set-cookie")
            .unwrap();
        assert_eq!(cookie["value"], "[REDACTED]");

        let manifest_path = session_dir.join("manifest.json");
        assert!(manifest_path.exists());
        let m: Value = serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        assert_eq!(m["thread_id"], "22222222-2222-4222-8222-222222222222");
    }

    #[tokio::test]
    async fn streaming_writes_ndjson_per_chunk_and_aggregated_response() {
        let tmp = tempdir().unwrap();
        let dumper = SessionDumper::for_session(&dump_config(tmp.path()), "tid", manifest());
        let chunks = vec![
            Ok(Bytes::from_static(b"data: hello\n\n")),
            Ok(Bytes::from_static(b"data: world\n\n")),
            Ok(Bytes::from_static(b"data: [DONE]\n\n")),
        ];
        let inner = FakeTransport::with_stream(chunks);
        let transport = DumpingTransport::new(inner, dumper);
        let req = Request::new(Method::POST, "https://example.com/v1/responses".to_string());

        let mut sr = transport.stream(req).await.unwrap();
        let mut bodies = Vec::new();
        while let Some(item) = sr.bytes.next().await {
            bodies.push(item.unwrap());
        }
        drop(sr);

        let session_dir = tmp.path().join("tid");
        let ndjson_path = find_file(&session_dir, "-stream.ndjson");
        let response_path = find_file(&session_dir, "-response.json");

        let ndjson = std::fs::read_to_string(&ndjson_path).unwrap();
        let lines: Vec<&str> = ndjson.lines().collect();
        assert_eq!(lines.len(), 3);
        let first: Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["chunk"], 0);
        assert_eq!(first["body"], json!("data: hello\n\n"));

        let response_dump: Value =
            serde_json::from_slice(&fs::read(&response_path).unwrap()).unwrap();
        assert_eq!(response_dump["status"], 200);
        assert_eq!(response_dump["stream_chunks"], 3);
        assert_eq!(
            response_dump["body"],
            json!("data: hello\n\ndata: world\n\ndata: [DONE]\n\n")
        );
    }

    #[tokio::test]
    async fn streaming_error_mid_stream_flushes_partial_response_with_error_note() {
        let tmp = tempdir().unwrap();
        let dumper = SessionDumper::for_session(&dump_config(tmp.path()), "tid", manifest());
        let chunks = vec![
            Ok(Bytes::from_static(b"data: first\n\n")),
            Err(TransportError::Network("stream broke".to_string())),
        ];
        let inner = FakeTransport::with_stream(chunks);
        let transport = DumpingTransport::new(inner, dumper);
        let req = Request::new(Method::POST, "https://example.com/v1/responses".to_string());
        let mut sr = transport.stream(req).await.unwrap();
        let first = sr.bytes.next().await.unwrap();
        assert!(first.is_ok());
        let second = sr.bytes.next().await.unwrap();
        assert!(second.is_err());
        drop(sr);

        let session_dir = tmp.path().join("tid");
        let response_path = find_file(&session_dir, "-response.json");
        let response_dump: Value =
            serde_json::from_slice(&fs::read(&response_path).unwrap()).unwrap();
        assert_eq!(response_dump["body"], json!("data: first\n\n"));
        assert!(response_dump["truncated_by_error"].as_str().unwrap().contains("stream broke"));
    }

    #[tokio::test]
    async fn sequence_numbers_monotonic_across_concurrent_calls() {
        let tmp = tempdir().unwrap();
        let dumper = SessionDumper::for_session(&dump_config(tmp.path()), "tid", manifest());
        let a = FakeTransport::with_stream(vec![Ok(Bytes::from_static(b"a"))]);
        let ta = DumpingTransport::new(a, dumper.clone());
        let req_a = Request::new(Method::POST, "https://example.com/a".to_string());
        let req_b = Request::new(Method::POST, "https://example.com/b".to_string());
        let b = FakeTransport::with_stream(vec![Ok(Bytes::from_static(b"b"))]);
        let tb = DumpingTransport::new(b, dumper.clone());

        let (mut sa, mut sb) =
            tokio::join!(async { ta.stream(req_a).await.unwrap() }, async {
                tb.stream(req_b).await.unwrap()
            });
        while let Some(c) = sa.bytes.next().await {
            c.unwrap();
        }
        while let Some(c) = sb.bytes.next().await {
            c.unwrap();
        }
        drop(sa);
        drop(sb);

        let session_dir = tmp.path().join("tid");
        let mut request_files: Vec<_> = std::fs::read_dir(&session_dir)
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
            .filter(|n| n.ends_with("-request.json"))
            .collect();
        request_files.sort();
        assert_eq!(request_files.len(), 2);
        assert!(request_files[0].starts_with("000001-"));
        assert!(request_files[1].starts_with("000002-"));
    }

    #[tokio::test]
    async fn extra_redacted_headers_are_honored() {
        let tmp = tempdir().unwrap();
        let mut cfg = dump_config(tmp.path());
        cfg.extra_redacted_headers.push("x-codex-installation-id".into());
        let dumper = SessionDumper::for_session(&cfg, "tid", manifest());
        let resp = Response {
            status: StatusCode::OK,
            headers: HeaderMap::new(),
            body: Bytes::new(),
        };
        let inner = FakeTransport::with_unary(resp);
        let transport = DumpingTransport::new(inner, dumper);
        let mut req = Request::new(Method::POST, "https://example.com/v1/responses".to_string());
        req.headers
            .insert("x-codex-installation-id", HeaderValue::from_static("PII-VALUE"));
        let _ = transport.execute(req).await;

        let session_dir = tmp.path().join("tid");
        let request_path = find_file(&session_dir, "-request.json");
        let request_dump: Value =
            serde_json::from_slice(&fs::read(&request_path).unwrap()).unwrap();
        let headers = request_dump["headers"].as_array().unwrap();
        let pii = headers
            .iter()
            .find(|h| h["name"].as_str().unwrap() == "x-codex-installation-id")
            .unwrap();
        assert_eq!(pii["value"], "[REDACTED]");
    }

    fn find_file(dir: &std::path::Path, suffix: &str) -> PathBuf {
        let entries: Vec<_> = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(suffix))
            .collect();
        assert_eq!(entries.len(), 1, "expected one *{suffix} in {dir:?}");
        entries.into_iter().next().unwrap().path()
    }
}
