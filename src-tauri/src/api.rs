// 本地 REST API：仅供本机脚本（如 Tampermonkey 浮窗）写入 Case 数据。
// 只监听 127.0.0.1，Bearer token 鉴权，不提供任何下单或仓位修改能力。

use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering},
        RwLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::{db, diagnostics, paths};

const DEFAULT_PORT: u16 = 8787;
pub const DATA_CHANGED_EVENT: &str = "cairn://data-changed";

const CASE_PHASES: [&str; 5] = [
    "pre-entry",
    "entry",
    "intermediate",
    "closing",
    "reflection",
];
const TAG_COLORS: [&str; 7] = ["red", "orange", "yellow", "green", "cyan", "blue", "purple"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiConfig {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
    pub created_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiStatus {
    pub enabled: bool,
    pub port: u16,
    pub running: bool,
    pub bound_port: u16,
    pub token: String,
    pub created_at: u64,
}

pub struct ApiState {
    pub config: RwLock<ApiConfig>,
    pub running: AtomicBool,
    pub bound_port: AtomicU16,
}

pub(crate) struct ApiOutcome {
    pub status: u16,
    pub body: Value,
    pub data_changed: bool,
}

impl ApiOutcome {
    fn ok(body: Value) -> Self {
        Self {
            status: 200,
            body,
            data_changed: false,
        }
    }

    fn changed(body: Value) -> Self {
        Self {
            status: 200,
            body,
            data_changed: true,
        }
    }

    fn error(status: u16, message: &str) -> Self {
        Self {
            status,
            body: json!({ "error": message }),
            data_changed: false,
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

fn make_id(prefix: &str, now: u64) -> String {
    let count = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{now:x}-{count:x}")
}

fn generate_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|err| err.to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(paths::app_data_dir(app)?.join("api-config.json"))
}

fn write_config(path: &Path, config: &ApiConfig) -> Result<(), String> {
    let content = serde_json::to_string_pretty(config).map_err(|err| err.to_string())?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, content).map_err(|err| err.to_string())?;
    fs::rename(&tmp_path, path).map_err(|err| err.to_string())?;
    Ok(())
}

fn load_or_create_config(app: &AppHandle) -> Result<ApiConfig, String> {
    let path = config_path(app)?;
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(config) = serde_json::from_str::<ApiConfig>(&content) {
            if !config.token.is_empty() {
                return Ok(config);
            }
        }
    }
    let config = ApiConfig {
        enabled: true,
        port: DEFAULT_PORT,
        token: generate_token()?,
        created_at: now_ms(),
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    write_config(&path, &config)?;
    Ok(config)
}

pub fn init_state(app: &AppHandle) -> ApiState {
    let config = load_or_create_config(app).unwrap_or_else(|err| {
        diagnostics::app_log(app, format!("api config load failed: {err}"));
        ApiConfig {
            enabled: false,
            port: DEFAULT_PORT,
            token: String::new(),
            created_at: 0,
        }
    });
    ApiState {
        config: RwLock::new(config),
        running: AtomicBool::new(false),
        bound_port: AtomicU16::new(0),
    }
}

pub fn status(app: &AppHandle) -> Result<ApiStatus, String> {
    let state = app.state::<ApiState>();
    let config = state
        .config
        .read()
        .map_err(|err| err.to_string())?
        .clone();
    Ok(ApiStatus {
        enabled: config.enabled,
        port: config.port,
        running: state.running.load(Ordering::Relaxed),
        bound_port: state.bound_port.load(Ordering::Relaxed),
        token: config.token,
        created_at: config.created_at,
    })
}

pub fn regenerate_token(app: &AppHandle) -> Result<ApiStatus, String> {
    let token = generate_token()?;
    let path = config_path(app)?;
    let state = app.state::<ApiState>();
    let mut config = state.config.write().map_err(|err| err.to_string())?;
    config.token = token;
    write_config(&path, &config)?;
    drop(config);
    diagnostics::app_log(app, "api token regenerated");
    status(app)
}

pub fn set_config(app: &AppHandle, enabled: bool, port: u16) -> Result<ApiStatus, String> {
    if port == 0 {
        return Err("invalid api port".to_string());
    }
    let path = config_path(app)?;
    let state = app.state::<ApiState>();
    let mut config = state.config.write().map_err(|err| err.to_string())?;
    config.enabled = enabled;
    config.port = port;
    write_config(&path, &config)?;
    drop(config);
    diagnostics::app_log(
        app,
        format!("api config updated: enabled={enabled} port={port} (restart to apply)"),
    );
    status(app)
}

fn current_token(app: &AppHandle) -> String {
    let state = app.state::<ApiState>();
    state
        .config
        .read()
        .map(|config| config.token.clone())
        .unwrap_or_default()
}

pub fn start_server(app: AppHandle) {
    std::thread::spawn(move || {
        let (enabled, port) = {
            let state = app.state::<ApiState>();
            let config = match state.config.read() {
                Ok(config) => config,
                Err(err) => {
                    diagnostics::app_log(&app, format!("local api state lock failed: {err}"));
                    return;
                }
            };
            (config.enabled, config.port)
        };
        if !enabled {
            diagnostics::app_log(&app, "local api disabled by config");
            return;
        }
        let server = match tiny_http::Server::http(("127.0.0.1", port)) {
            Ok(server) => server,
            Err(err) => {
                diagnostics::app_log(
                    &app,
                    format!("local api failed to bind 127.0.0.1:{port}: {err}"),
                );
                return;
            }
        };
        {
            let state = app.state::<ApiState>();
            state.running.store(true, Ordering::Relaxed);
            state.bound_port.store(port, Ordering::Relaxed);
        }
        diagnostics::app_log(&app, format!("local api listening on 127.0.0.1:{port}"));

        loop {
            let mut request = match server.recv() {
                Ok(request) => request,
                Err(err) => {
                    diagnostics::app_log(&app, format!("local api receive failed: {err}"));
                    break;
                }
            };
            let method = request.method().as_str().to_string();
            let url = request.url().to_string();
            let auth = request
                .headers()
                .iter()
                .find(|header| header.field.equiv("Authorization"))
                .map(|header| header.value.as_str().to_string());
            let mut body = Vec::new();
            let _ = request.as_reader().read_to_end(&mut body);

            let token = current_token(&app);
            let db = app.state::<db::Db>();
            let outcome = match db.conn() {
                Ok(conn) => handle_request(
                    &conn,
                    &token,
                    &method,
                    &url,
                    auth.as_deref(),
                    &body,
                    now_ms(),
                ),
                Err(err) => ApiOutcome::error(500, &err),
            };

            if outcome.data_changed {
                let _ = app.emit(DATA_CHANGED_EVENT, &outcome.body);
            }

            let mut response = tiny_http::Response::from_string(outcome.body.to_string())
                .with_status_code(outcome.status);
            add_cors_headers(&mut response);
            let _ = request.respond(response);
        }
    });
}

fn add_cors_headers<R: Read>(response: &mut tiny_http::Response<R>) {
    for (name, value) in [
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS"),
        ("Access-Control-Allow-Headers", "Authorization, Content-Type"),
        ("Content-Type", "application/json; charset=utf-8"),
    ] {
        if let Ok(header) = tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            response.add_header(header);
        }
    }
}

fn bearer_token(auth: Option<&str>) -> Option<&str> {
    let value = auth?.trim();
    let (scheme, token) = value.split_once(' ')?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }
    Some(token.trim())
}

fn token_matches(expected: &str, provided: &str) -> bool {
    if expected.is_empty() || expected.len() != provided.len() {
        return false;
    }
    expected
        .bytes()
        .zip(provided.bytes())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

fn error_status(message: &str) -> u16 {
    if message.contains("immutable")
        || message.contains("UNIQUE constraint failed")
        || message.contains("already exists")
        || message.contains("already bound")
    {
        409
    } else if message.contains("not found") {
        404
    } else if message.contains("is missing")
        || message.contains("cannot be empty")
        || message.contains("invalid")
        || message.contains("must be")
    {
        400
    } else {
        500
    }
}

fn run(handler: impl FnOnce() -> Result<(Value, bool), String>) -> ApiOutcome {
    match handler() {
        Ok((body, changed)) => {
            if changed {
                ApiOutcome::changed(body)
            } else {
                ApiOutcome::ok(body)
            }
        }
        Err(message) => ApiOutcome::error(error_status(&message), &message),
    }
}

pub(crate) fn handle_request(
    conn: &Connection,
    token: &str,
    method: &str,
    raw_path: &str,
    auth: Option<&str>,
    body: &[u8],
    now: u64,
) -> ApiOutcome {
    let path = raw_path.split('?').next().unwrap_or("");
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();

    if method == "OPTIONS" {
        return ApiOutcome {
            status: 204,
            body: Value::Null,
            data_changed: false,
        };
    }

    if path == "/api/v1/health" && method == "GET" {
        return ApiOutcome::ok(json!({
            "ok": true,
            "service": "cairn-local-api",
            "version": env!("CARGO_PKG_VERSION"),
        }));
    }

    match bearer_token(auth).map(|value| token_matches(token, value)) {
        Some(true) => {}
        _ => return ApiOutcome::error(401, "missing or invalid bearer token"),
    }

    let parsed_body: Value = if body.is_empty() {
        Value::Object(serde_json::Map::new())
    } else {
        match serde_json::from_slice(body) {
            Ok(value) => value,
            Err(_) => return ApiOutcome::error(400, "invalid JSON body"),
        }
    };

    match (method, segments.as_slice()) {
        ("GET", ["api", "v1", "cases"]) => run(|| {
            Ok((json!({ "cases": db::read_simple_collection(conn, "cases")? }), false))
        }),
        ("POST", ["api", "v1", "cases"]) => run(|| create_case(conn, &parsed_body, now)),
        ("GET", ["api", "v1", "cases", case_id]) => run(|| {
            match db::read_record_by_id(conn, "cases", case_id)? {
                Some(case) => Ok((case, false)),
                None => Err(format!("case not found: {case_id}")),
            }
        }),
        ("GET", ["api", "v1", "cases", case_id, "cards"]) => run(|| {
            if db::read_record_by_id(conn, "cases", case_id)?.is_none() {
                return Err(format!("case not found: {case_id}"));
            }
            Ok((
                json!({ "cards": db::read_case_cards_for_case(conn, case_id)? }),
                false,
            ))
        }),
        ("POST", ["api", "v1", "cases", case_id, "cards"]) => {
            run(|| create_case_card(conn, case_id, &parsed_body, now))
        }
        ("POST", ["api", "v1", "bindings"]) => run(|| create_binding(conn, &parsed_body, now)),
        ("DELETE", ["api", "v1", "bindings", binding_id]) => {
            run(|| delete_binding(conn, binding_id))
        }
        ("GET", ["api", "v1", "case-tags"]) => run(|| {
            Ok((
                json!({ "caseTags": db::read_simple_collection(conn, "caseTagDefs")? }),
                false,
            ))
        }),
        ("POST", ["api", "v1", "case-tags"]) => run(|| create_case_tag(conn, &parsed_body, now)),
        ("GET", ["api", "v1", "accounts"]) => run(|| list_accounts(conn)),
        _ => ApiOutcome::error(404, "route not found"),
    }
}

fn require_str(body: &Value, key: &str) -> Result<String, String> {
    body.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("request body is missing valid {key}"))
}

/// 与前端 lib/cases.ts 的 extractExplicitBarRef 同规则：
/// "bar #38" / "BAR41" / "第 42 根 K 线"，取最早出现的引用。
fn extract_bar_ref(raw_text: &str) -> Option<i64> {
    let mut best: Option<(usize, i64)> = None;
    let lower = raw_text.to_lowercase();

    let is_word = |ch: u8| ch.is_ascii_alphanumeric() || ch == b'_';
    let mut search_from = 0;
    while let Some(rel) = lower[search_from..].find("bar") {
        let bar_pos = search_from + rel;
        search_from = bar_pos + 3;
        let prev_ok = bar_pos == 0 || !is_word(lower.as_bytes()[bar_pos - 1]);
        let bytes = lower.as_bytes();
        let mut j = bar_pos + 3;
        while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\t' || bytes[j] == b'#') {
            j += 1;
        }
        let digits_start = j;
        while j < bytes.len() && bytes[j].is_ascii_digit() {
            j += 1;
        }
        let next_ok = j >= bytes.len() || !is_word(bytes[j]);
        if prev_ok && j > digits_start && next_ok {
            if let Ok(value) = lower[digits_start..j].parse::<i64>() {
                if value > 0 && best.as_ref().is_none_or(|(pos, _)| bar_pos < *pos) {
                    best = Some((bar_pos, value));
                }
            }
        }
    }

    let needle = '第'.len_utf8();
    let mut search_from = 0;
    while let Some(rel) = raw_text[search_from..].find('第') {
        let pos = search_from + rel;
        search_from = pos + needle;
        let rest = &raw_text[pos + needle..];
        let trimmed = rest.trim_start();
        let digits: String = trimmed.chars().take_while(|ch| ch.is_ascii_digit()).collect();
        if digits.is_empty() {
            continue;
        }
        let after_digits = &trimmed[digits.len()..];
        let after_root = after_digits.trim_start();
        if !after_root.starts_with('根') {
            continue;
        }
        let unit = after_root['根'.len_utf8()..].trim_start();
        let unit_lower = unit.to_lowercase();
        let unit_ok = unit_lower.starts_with("k线")
            || unit_lower.starts_with("k 线")
            || unit_lower.starts_with("蜡烛")
            || unit_lower.starts_with("bar");
        if !unit_ok {
            continue;
        }
        if let Ok(value) = digits.parse::<i64>() {
            if value > 0 && best.as_ref().is_none_or(|(found, _)| pos < *found) {
                best = Some((pos, value));
            }
        }
    }

    best.map(|(_, value)| value)
}

fn validate_id(id: &str) -> Result<(), String> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');
    if valid {
        Ok(())
    } else {
        Err("invalid id: use 1-64 characters of letters, digits, '-' or '_'".to_string())
    }
}

fn optional_id(body: &Value, prefix: &str, now: u64) -> Result<String, String> {
    match body.get("id").and_then(Value::as_str) {
        Some(id) => {
            validate_id(id)?;
            Ok(id.to_string())
        }
        None => Ok(make_id(prefix, now)),
    }
}

fn create_case(conn: &Connection, body: &Value, now: u64) -> Result<(Value, bool), String> {
    let title = require_str(body, "title")?;
    let account_id = require_str(body, "accountId")?;
    let period_id = require_str(body, "periodId")?;
    let status = body
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("active")
        .to_string();
    if !matches!(status.as_str(), "active" | "closed" | "archived") {
        return Err(format!("invalid case status: {status}"));
    }
    let provenance = body
        .get("provenance")
        .and_then(Value::as_str)
        .unwrap_or("forward")
        .to_string();
    if !matches!(provenance.as_str(), "forward" | "retrospective") {
        return Err(format!("invalid case provenance: {provenance}"));
    }
    let tag_ids: Vec<String> = body
        .get("tagIds")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    if db::read_record_by_id(conn, "accounts", &account_id)?.is_none() {
        return Err(format!("account not found: {account_id}"));
    }
    if db::read_record_by_id(conn, "periods", &period_id)?.is_none() {
        return Err(format!("period not found: {period_id}"));
    }
    for tag_id in &tag_ids {
        if db::read_record_by_id(conn, "caseTagDefs", tag_id)?.is_none() {
            return Err(format!("case tag not found: {tag_id}"));
        }
    }
    let id = optional_id(body, "case", now)?;
    if let Some(existing) = db::read_record_by_id(conn, "cases", &id)? {
        let same = [
            ("title", &title),
            ("accountId", &account_id),
            ("periodId", &period_id),
        ]
        .iter()
        .all(|(key, value)| {
            existing.get(*key).and_then(Value::as_str) == Some(value.as_str())
        });
        if same {
            return Ok((existing, false));
        }
        return Err(format!("case already exists with different content: {id}"));
    }
    let data = json!({
        "id": id,
        "accountId": account_id,
        "periodId": period_id,
        "title": title,
        "status": status,
        "provenance": provenance,
        "tagIds": tag_ids,
        "createdAt": now,
        "updatedAt": now,
    });
    db::save_record_in_tx(conn, "cases", &id, data.clone())?;
    Ok((data, true))
}

fn create_case_card(
    conn: &Connection,
    case_id: &str,
    body: &Value,
    now: u64,
) -> Result<(Value, bool), String> {
    if db::read_record_by_id(conn, "cases", case_id)?.is_none() {
        return Err(format!("case not found: {case_id}"));
    }
    let phase = require_str(body, "phase")?;
    if !CASE_PHASES.contains(&phase.as_str()) {
        return Err(format!(
            "invalid phase: {phase}; must be one of {CASE_PHASES:?}"
        ));
    }
    let raw_text = require_str(body, "rawText")?;
    // barRef 可选：思想交给人，填表交给提取层。未提供时从原文机械提取（Stage 5 后由 AI 增强）。
    let bar_ref: Option<i64> = match body.get("barRef") {
        Some(value) => {
            let parsed = value
                .as_i64()
                .ok_or_else(|| "invalid barRef: must be an integer".to_string())?;
            if parsed < 1 {
                return Err("invalid barRef: must be a positive integer".to_string());
            }
            Some(parsed)
        }
        None => extract_bar_ref(&raw_text),
    };
    let entry_decision = body
        .get("entryDecision")
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(decision) = &entry_decision {
        if !matches!(
            decision.as_str(),
            "pending" | "executed" | "continue-observing"
        ) {
            return Err(format!("invalid entryDecision: {decision}"));
        }
    }
    let id = optional_id(body, "card", now)?;
    if let Some(existing) = db::read_record_by_id(conn, "caseCards", &id)? {
        let same = existing.get("rawText").and_then(Value::as_str) == Some(raw_text.as_str())
            && existing.get("caseId").and_then(Value::as_str) == Some(case_id);
        if same {
            return Ok((existing, false));
        }
        return Err("case card rawText is immutable".to_string());
    }
    let mut data = json!({
        "id": id,
        "caseId": case_id,
        "phase": phase,
        "rawText": raw_text,
        "createdAt": now,
    });
    if let Some(bar) = bar_ref {
        data["barRef"] = json!(bar);
    }
    if let Some(decision) = entry_decision {
        data["entryDecision"] = json!(decision);
    }
    db::save_record_in_tx(conn, "caseCards", &id, data.clone())?;
    Ok((data, true))
}

fn create_binding(conn: &Connection, body: &Value, now: u64) -> Result<(Value, bool), String> {
    let case_id = require_str(body, "caseId")?;
    let trade_id = require_str(body, "tradeId")?;
    if db::read_record_by_id(conn, "cases", &case_id)?.is_none() {
        return Err(format!("case not found: {case_id}"));
    }
    if db::read_record_by_id(conn, "trades", &trade_id)?.is_none() {
        return Err(format!("trade not found: {trade_id}"));
    }
    let bindings = db::read_simple_collection(conn, "caseBindings")?;
    if let Some(existing) = bindings
        .iter()
        .find(|binding| binding.get("caseId").and_then(Value::as_str) == Some(case_id.as_str()))
    {
        let bound_trade = existing.get("tradeId").and_then(Value::as_str).unwrap_or("?");
        return Err(format!("case is already bound to trade {bound_trade}"));
    }
    if let Some(existing) = bindings
        .iter()
        .find(|binding| binding.get("tradeId").and_then(Value::as_str) == Some(trade_id.as_str()))
    {
        let bound_case = existing.get("caseId").and_then(Value::as_str).unwrap_or("?");
        return Err(format!("trade is already bound to case {bound_case}"));
    }
    let id = make_id("case-binding", now);
    let data = json!({
        "id": id,
        "caseId": case_id,
        "tradeId": trade_id,
        "source": "api",
        "boundAt": now,
    });
    db::save_record_in_tx(conn, "caseBindings", &id, data.clone())?;
    Ok((data, true))
}

fn delete_binding(conn: &Connection, binding_id: &str) -> Result<(Value, bool), String> {
    let affected = conn
        .execute(
            "UPDATE case_trade_bindings SET deleted_at = unixepoch() * 1000 WHERE id = ?1 AND deleted_at IS NULL",
            params![binding_id],
        )
        .map_err(|err| err.to_string())?;
    if affected == 0 {
        return Err(format!("binding not found: {binding_id}"));
    }
    Ok((json!({ "deleted": true }), true))
}

fn create_case_tag(conn: &Connection, body: &Value, now: u64) -> Result<(Value, bool), String> {
    let name = require_str(body, "name")?;
    let color = require_str(body, "color")?;
    if !TAG_COLORS.contains(&color.as_str()) {
        return Err(format!("invalid color: {color}; must be one of {TAG_COLORS:?}"));
    }
    let existing = db::read_simple_collection(conn, "caseTagDefs")?;
    if existing.iter().any(|tag| {
        tag.get("name")
            .and_then(Value::as_str)
            .is_some_and(|value| value.to_lowercase() == name.to_lowercase())
    }) {
        return Err(format!("case tag name already exists: {name}"));
    }
    let id = optional_id(body, "case-tag", now)?;
    let data = json!({
        "id": id,
        "name": name,
        "color": color,
        "createdAt": now,
    });
    db::save_record_in_tx(conn, "caseTagDefs", &id, data.clone())?;
    Ok((data, true))
}

fn list_accounts(conn: &Connection) -> Result<(Value, bool), String> {
    let accounts = db::read_simple_collection(conn, "accounts")?;
    let periods = db::read_simple_collection(conn, "periods")?;
    let mut out = Vec::new();
    for mut account in accounts {
        if let Value::Object(map) = &mut account {
            let account_id = map
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let children: Vec<Value> = periods
                .iter()
                .filter(|period| {
                    period.get("accountId").and_then(Value::as_str) == Some(account_id.as_str())
                })
                .cloned()
                .collect();
            map.insert("periods".to_string(), Value::Array(children));
        }
        out.push(account);
    }
    Ok((json!({ "accounts": out }), false))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "test-token";

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        db::save_record_in_tx(
            &conn,
            "accounts",
            "acct-1",
            json!({ "id": "acct-1", "name": "Test Account", "kind": "live", "createdAt": 1 }),
        )
        .unwrap();
        db::save_record_in_tx(
            &conn,
            "periods",
            "period-1",
            json!({ "id": "period-1", "accountId": "acct-1", "name": "P1", "createdAt": 1 }),
        )
        .unwrap();
        db::save_record_in_tx(
            &conn,
            "trades",
            "trade-1",
            json!({ "id": "trade-1", "accountId": "acct-1", "periodId": "period-1", "seq": 1 }),
        )
        .unwrap();
        conn
    }

    fn auth() -> Option<String> {
        Some(format!("Bearer {TOKEN}"))
    }

    fn call(
        conn: &Connection,
        method: &str,
        path: &str,
        body: Value,
    ) -> ApiOutcome {
        handle_request(
            conn,
            TOKEN,
            method,
            path,
            auth().as_deref(),
            body.to_string().as_bytes(),
            1000,
        )
    }

    #[test]
    fn health_does_not_require_token() {
        let conn = setup_conn();
        let outcome = handle_request(&conn, TOKEN, "GET", "/api/v1/health", None, &[], 1);
        assert_eq!(outcome.status, 200);
        assert_eq!(outcome.body["service"], "cairn-local-api");
    }

    #[test]
    fn other_routes_require_bearer_token() {
        let conn = setup_conn();
        let no_auth = handle_request(&conn, TOKEN, "GET", "/api/v1/cases", None, &[], 1);
        assert_eq!(no_auth.status, 401);
        let bad_auth = handle_request(
            &conn,
            TOKEN,
            "GET",
            "/api/v1/cases",
            Some("Bearer wrong"),
            &[],
            1,
        );
        assert_eq!(bad_auth.status, 401);
        let ok = handle_request(&conn, TOKEN, "GET", "/api/v1/cases", auth().as_deref(), &[], 1);
        assert_eq!(ok.status, 200);
    }

    #[test]
    fn options_preflight_returns_no_content() {
        let conn = setup_conn();
        let outcome = handle_request(&conn, TOKEN, "OPTIONS", "/api/v1/cases", None, &[], 1);
        assert_eq!(outcome.status, 204);
    }

    #[test]
    fn unknown_route_is_404() {
        let conn = setup_conn();
        let outcome = call(&conn, "GET", "/api/v1/nope", json!({}));
        assert_eq!(outcome.status, 404);
    }

    #[test]
    fn create_case_is_idempotent_for_same_content() {
        let conn = setup_conn();
        let body = json!({
            "id": "case-ext-1",
            "title": "BTC 区间突破观察",
            "accountId": "acct-1",
            "periodId": "period-1",
        });
        let first = call(&conn, "POST", "/api/v1/cases", body.clone());
        assert_eq!(first.status, 200);
        assert!(first.data_changed);
        let second = call(&conn, "POST", "/api/v1/cases", body);
        assert_eq!(second.status, 200);
        assert!(!second.data_changed);
        let list = call(&conn, "GET", "/api/v1/cases", json!({}));
        assert_eq!(list.body["cases"].as_array().map(Vec::len), Some(1));
    }

    #[test]
    fn create_case_rejects_conflicting_id_and_unknown_refs() {
        let conn = setup_conn();
        let body = json!({
            "id": "case-ext-1",
            "title": "A",
            "accountId": "acct-1",
            "periodId": "period-1",
        });
        call(&conn, "POST", "/api/v1/cases", body);
        let conflicting = json!({
            "id": "case-ext-1",
            "title": "B",
            "accountId": "acct-1",
            "periodId": "period-1",
        });
        let outcome = call(&conn, "POST", "/api/v1/cases", conflicting);
        assert_eq!(outcome.status, 409);

        let unknown_account = json!({
            "title": "C",
            "accountId": "acct-404",
            "periodId": "period-1",
        });
        let outcome = call(&conn, "POST", "/api/v1/cases", unknown_account);
        assert_eq!(outcome.status, 404);
    }

    #[test]
    fn create_card_extracts_bar_ref_and_validates_phase() {
        let conn = setup_conn();
        call(
            &conn,
            "POST",
            "/api/v1/cases",
            json!({ "id": "case-1", "title": "T", "accountId": "acct-1", "periodId": "period-1" }),
        );

        // 未提供 barRef 时从原文机械提取
        let extracted = json!({ "phase": "entry", "rawText": "BAR38 出现二次入场做多信号" });
        let outcome = call(&conn, "POST", "/api/v1/cases/case-1/cards", extracted);
        assert_eq!(outcome.status, 200);
        assert_eq!(outcome.body["barRef"], 38);

        // 中文写法也能提取
        let chinese = json!({ "phase": "closing", "rawText": "第 42 根 K 线走弱，我离场了" });
        let outcome = call(&conn, "POST", "/api/v1/cases/case-1/cards", chinese);
        assert_eq!(outcome.status, 200);
        assert_eq!(outcome.body["barRef"], 42);

        // 没有 BAR 引用时允许缺失
        let no_bar = json!({ "phase": "intermediate", "rawText": "动能在减弱，考虑上移止损" });
        let outcome = call(&conn, "POST", "/api/v1/cases/case-1/cards", no_bar);
        assert_eq!(outcome.status, 200);
        assert!(outcome.body.get("barRef").is_none());

        // 显式提供时校验合法性
        let zero_bar = json!({ "phase": "entry", "rawText": "x", "barRef": 0 });
        let outcome = call(&conn, "POST", "/api/v1/cases/case-1/cards", zero_bar);
        assert_eq!(outcome.status, 400);

        let bad_phase = json!({ "phase": "daydream", "rawText": "x", "barRef": 3 });
        let outcome = call(&conn, "POST", "/api/v1/cases/case-1/cards", bad_phase);
        assert_eq!(outcome.status, 400);

        let missing_case = json!({ "phase": "entry", "rawText": "x" });
        let outcome = call(
            &conn,
            "POST",
            "/api/v1/cases/case-404/cards",
            missing_case,
        );
        assert_eq!(outcome.status, 404);
    }

    #[test]
    fn create_card_replay_is_idempotent_and_rewrite_is_409() {
        let conn = setup_conn();
        call(
            &conn,
            "POST",
            "/api/v1/cases",
            json!({ "id": "case-1", "title": "T", "accountId": "acct-1", "periodId": "period-1" }),
        );
        let body = json!({
            "id": "card-ext-1",
            "phase": "intermediate",
            "rawText": "BAR41 顶部结构，走弱则离场",
            "barRef": 41,
        });
        let first = call(&conn, "POST", "/api/v1/cases/case-1/cards", body.clone());
        assert_eq!(first.status, 200);
        assert!(first.data_changed);

        let replay = call(&conn, "POST", "/api/v1/cases/case-1/cards", body);
        assert_eq!(replay.status, 200);
        assert!(!replay.data_changed);

        let rewritten = json!({
            "id": "card-ext-1",
            "phase": "intermediate",
            "rawText": "事后改写",
            "barRef": 41,
        });
        let outcome = call(&conn, "POST", "/api/v1/cases/case-1/cards", rewritten);
        assert_eq!(outcome.status, 409);

        let cards = call(&conn, "GET", "/api/v1/cases/case-1/cards", json!({}));
        assert_eq!(cards.body["cards"].as_array().map(Vec::len), Some(1));
    }

    #[test]
    fn bindings_are_one_to_one_through_api() {
        let conn = setup_conn();
        call(
            &conn,
            "POST",
            "/api/v1/cases",
            json!({ "id": "case-1", "title": "T", "accountId": "acct-1", "periodId": "period-1" }),
        );
        call(
            &conn,
            "POST",
            "/api/v1/cases",
            json!({ "id": "case-2", "title": "T2", "accountId": "acct-1", "periodId": "period-1" }),
        );
        let first = call(
            &conn,
            "POST",
            "/api/v1/bindings",
            json!({ "caseId": "case-1", "tradeId": "trade-1" }),
        );
        assert_eq!(first.status, 200);

        let same_trade = call(
            &conn,
            "POST",
            "/api/v1/bindings",
            json!({ "caseId": "case-2", "tradeId": "trade-1" }),
        );
        assert_eq!(same_trade.status, 409);

        let binding_id = first.body["id"].as_str().unwrap().to_string();
        let deleted = call(&conn, "DELETE", &format!("/api/v1/bindings/{binding_id}"), json!({}));
        assert_eq!(deleted.status, 200);
        assert!(deleted.data_changed);

        let rebound = call(
            &conn,
            "POST",
            "/api/v1/bindings",
            json!({ "caseId": "case-2", "tradeId": "trade-1" }),
        );
        assert_eq!(rebound.status, 200);
    }

    #[test]
    fn case_tags_reject_duplicates_case_insensitively() {
        let conn = setup_conn();
        let first = call(
            &conn,
            "POST",
            "/api/v1/case-tags",
            json!({ "name": "Breakout", "color": "red" }),
        );
        assert_eq!(first.status, 200);
        let duplicate = call(
            &conn,
            "POST",
            "/api/v1/case-tags",
            json!({ "name": "breakout", "color": "blue" }),
        );
        assert_eq!(duplicate.status, 409);
        let bad_color = call(
            &conn,
            "POST",
            "/api/v1/case-tags",
            json!({ "name": "Other", "color": "pink" }),
        );
        assert_eq!(bad_color.status, 400);
    }

    #[test]
    fn accounts_include_nested_periods() {
        let conn = setup_conn();
        let outcome = call(&conn, "GET", "/api/v1/accounts", json!({}));
        assert_eq!(outcome.status, 200);
        let accounts = outcome.body["accounts"].as_array().unwrap().clone();
        assert_eq!(accounts.len(), 1);
        let periods = accounts[0]["periods"].as_array().unwrap().clone();
        assert_eq!(periods.len(), 1);
        assert_eq!(periods[0]["id"], "period-1");
    }
}
