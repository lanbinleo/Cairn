mod ai;
mod api;
mod db;
mod diagnostics;
mod paths;

use std::{
    fs,
    path::{Component, Path},
};

use base64::{engine::general_purpose, Engine as _};
use serde_json::{json, Value};
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State, WindowEvent,
};

#[tauri::command]
fn app_ready() -> &'static str {
    "ok"
}

#[tauri::command]
fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
fn load_state(
    app: AppHandle,
    db: State<'_, db::Db>,
    seed: db::AppState,
) -> Result<db::AppState, String> {
    let state = db::load_or_seed(&db, seed)?;
    match db::export_daily_backup_if_due(&app, &db) {
        Ok(Some(path)) => diagnostics::app_log(
            &app,
            format!("daily auto backup created: {}", path.display()),
        ),
        Ok(None) => diagnostics::app_log(&app, "daily auto backup already exists"),
        Err(err) => diagnostics::app_log(&app, format!("daily auto backup failed: {err}")),
    }
    Ok(state)
}

#[tauri::command]
fn save_record(
    db: State<'_, db::Db>,
    collection: String,
    id: String,
    data: Value,
) -> Result<(), String> {
    db::save_record(&db, &collection, &id, data)
}

#[tauri::command]
fn save_records(
    db: State<'_, db::Db>,
    collection: String,
    records: Vec<Value>,
) -> Result<(), String> {
    db::save_records(&db, &collection, records)
}

#[tauri::command]
fn delete_record(db: State<'_, db::Db>, collection: String, id: String) -> Result<(), String> {
    db::delete_record(&db, &collection, &id)
}

#[tauri::command]
fn replace_collection(
    db: State<'_, db::Db>,
    collection: String,
    records: Vec<Value>,
) -> Result<(), String> {
    db::replace_collection(&db, &collection, records)
}

#[tauri::command]
fn restore_state(db: State<'_, db::Db>, state: db::AppState) -> Result<db::AppState, String> {
    db::restore_state(&db, state)
}

#[tauri::command]
fn export_backup(app: AppHandle, db: State<'_, db::Db>) -> Result<String, String> {
    db::export_backup(&app, &db).map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn frontend_log(app: AppHandle, message: String) {
    diagnostics::app_log(&app, format!("frontend: {message}"));
}

#[tauri::command]
fn read_logs(app: AppHandle) -> Result<String, String> {
    diagnostics::read_log(&app)
}

#[tauri::command]
fn get_log_path(app: AppHandle) -> Result<String, String> {
    diagnostics::log_path(&app).map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_api_status(app: AppHandle) -> Result<api::ApiStatus, String> {
    api::status(&app)
}

const WIDGET_SCRIPT: &str = include_str!("../../scripts/cairn-case-widget.user.js");

/// 浮窗脚本内置分发：脚本内容编译进二进制，应用更新即脚本更新，
/// 用户从设置页复制即可，无需访问 GitHub。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WidgetScript {
    version: String,
    script: String,
}

fn widget_script_version(source: &str) -> String {
    source
        .lines()
        .find_map(|line| line.trim().strip_prefix("// @version"))
        .map(|rest| rest.trim().to_string())
        .filter(|version| !version.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

#[tauri::command]
fn get_widget_script() -> WidgetScript {
    WidgetScript {
        version: widget_script_version(WIDGET_SCRIPT),
        script: WIDGET_SCRIPT.to_string(),
    }
}

/// GitHub 上 main 分支的脚本内容（走 api.github.com Contents API：
/// 本机网络下它通常可达，raw CDN 域名经常超时）。
async fn fetch_widget_script_remote() -> Result<String, String> {
    let client = ai::http_client()
        .timeout(std::time::Duration::from_secs(8))
        .user_agent("cairn-widget-update-check")
        .build()
        .map_err(|err| err.to_string())?;
    let response = client
        .get("https://api.github.com/repos/lanbinleo/Cairn/contents/scripts/cairn-case-widget.user.js?ref=main")
        .send()
        .await
        .map_err(|err| format!("request failed: {err}"))?;
    if !response.status().is_success() {
        return Err(format!("github api returned {}", response.status()));
    }
    let payload: serde_json::Value = response.json().await.map_err(|err| err.to_string())?;
    let content = payload
        .get("content")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "github api response missing content".to_string())?;
    let decoded = general_purpose::STANDARD
        .decode(content.replace('\n', ""))
        .map_err(|err| err.to_string())?;
    String::from_utf8(decoded).map_err(|err| err.to_string())
}

/// 点分版本逐段数值比较：a > b。
fn version_gt(a: &str, b: &str) -> bool {
    let nums = |v: &str| -> Vec<u64> { v.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect() };
    let (mut va, mut vb) = (nums(a), nums(b));
    let len = va.len().max(vb.len());
    va.resize(len, 0);
    vb.resize(len, 0);
    va > vb
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WidgetScriptRemote {
    version: String,
    script: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WidgetScriptUpdate {
    builtin_version: String,
    /// None = 无法访问 GitHub（网络不通等），复制内置版即可。
    remote: Option<WidgetScriptRemote>,
    remote_newer: bool,
    /// remote 为 None 时的原因，供排障（前端仅 console.warn，不打扰 UI）。
    remote_error: Option<String>,
}

/// 浮窗脚本更新检查：内置版本 vs GitHub main 分支。网络失败不报错——
/// 返回 remote: None，前端降级展示「使用内置版」。
#[tauri::command]
async fn check_widget_script_update() -> WidgetScriptUpdate {
    let builtin_version = widget_script_version(WIDGET_SCRIPT);
    match fetch_widget_script_remote().await {
        Ok(script) => {
            let version = widget_script_version(&script);
            if version == "unknown" {
                return WidgetScriptUpdate {
                    builtin_version,
                    remote: None,
                    remote_newer: false,
                    remote_error: Some("remote script has no parseable @version".to_string()),
                };
            }
            let remote_newer = version_gt(&version, &builtin_version);
            WidgetScriptUpdate { builtin_version, remote: Some(WidgetScriptRemote { version, script }), remote_newer, remote_error: None }
        }
        Err(err) => WidgetScriptUpdate { builtin_version, remote: None, remote_newer: false, remote_error: Some(err) },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widget_script_version_parses_userscript_header() {
        let source = "// ==UserScript==\n// @name    Cairn\n// @version  0.2.4\n// ==/UserScript==\nbody;";
        assert_eq!(widget_script_version(source), "0.2.4");
        assert_eq!(widget_script_version("no header here"), "unknown");
        // 内置脚本必须带可解析的 @version，否则设置页无法显示版本
        assert_ne!(widget_script_version(WIDGET_SCRIPT), "unknown");
    }

    #[test]
    fn version_gt_compares_dot_segments_numerically() {
        assert!(version_gt("0.2.4", "0.2.3"));
        assert!(version_gt("0.10.0", "0.9.9"));
        assert!(version_gt("1.0", "0.99"));
        assert!(!version_gt("0.2.4", "0.2.4"));
        assert!(!version_gt("0.2.3", "0.2.4"));
        assert!(!version_gt("0.2", "0.2.0"));
    }

    #[test]
    fn batch_split_degrades_without_ai_and_is_idempotent() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        db::save_record_in_tx(
            &conn,
            "cases",
            "case-1",
            json!({ "id": "case-1", "accountId": "acct-1", "periodId": "period-1", "title": "T", "status": "active", "provenance": "forward", "tagIds": [], "createdAt": 1, "updatedAt": 1 }),
        )
        .unwrap();
        let db = db::Db::from_conn(conn);

        // 无 AppHandle（单测）→ AI 不可用 → 退化为完整单卡，绝不丢原文；barRef 机械提取
        let long_text = "现在是 BAR 120，这根 K 线收了长上影，我看到区间上沿又一次失败了。下一根直接砸下来，突破了昨天的低点。再下一根缩量回抽，没有跟随的空头。我决定继续等一个更干净的入场位置再说。";
        let (cards, changed) = futures::executor::block_on(run_batch_split(
            None, &db, "case-1", "pre-entry", long_text, None, "bs-test-1", 1000,
        ))
        .unwrap();
        assert!(changed);
        assert_eq!(cards.len(), 1, "degraded to single card");
        assert_eq!(cards[0]["rawText"], long_text, "original text never lost");
        assert_eq!(cards[0]["barRef"], 120);
        assert_eq!(cards[0]["id"], "bs-test-1-0");

        // 幂等重放：同 clientRequestId 返回已创建的卡，不再新增
        let (replayed, changed) = futures::executor::block_on(run_batch_split(
            None, &db, "case-1", "pre-entry", long_text, None, "bs-test-1", 2000,
        ))
        .unwrap();
        assert!(!changed);
        assert_eq!(replayed.len(), 1);

        let all = db::read_case_cards_for_case(&db.conn().unwrap(), "case-1").unwrap();
        assert_eq!(all.len(), 1);

        // 校验：非法 clientRequestId / 未知 Case / 非法 phase
        assert!(futures::executor::block_on(run_batch_split(
            None, &db, "case-1", "pre-entry", "内容", None, "非法 id!", 3000,
        ))
        .is_err());
        assert!(futures::executor::block_on(run_batch_split(
            None, &db, "case-404", "pre-entry", "内容", None, "bs-x", 3000,
        ))
        .is_err());
        assert!(futures::executor::block_on(run_batch_split(
            None, &db, "case-1", "invalid", "内容", None, "bs-y", 3000,
        ))
        .is_err());

        // 同 clientRequestId 换文本重放 → 拒绝（与 POST /cards 的 409 immutable 对齐）
        let conflict = futures::executor::block_on(run_batch_split(
            None, &db, "case-1", "pre-entry", "完全不同的另一段话，长得足够长的那种内容", None, "bs-test-1", 4000,
        ));
        assert!(conflict.is_err());
        assert!(conflict.unwrap_err().contains("already exists"));
    }

    fn suggestion(action: &str, price: Option<f64>, quote: &str) -> ai::ParsedSuggestion {
        ai::ParsedSuggestion {
            card_id: "card-1".to_string(),
            action: action.to_string(),
            order_type: "stop-loss".to_string(),
            price,
            anchor_text: None,
            signal: None,
            quote: quote.to_string(),
        }
    }

    #[test]
    fn suggestion_dedup_drops_prices_already_on_the_trade() {
        let trade = json!({
            "direction": "long",
            "initialStopLoss": 90364,
            "initialTakeProfit": 90729,
            "executions": [
                { "action": "entry", "time": 1, "price": 90873.76, "quantity": 2.9 },
                { "action": "stop", "time": 2, "price": 90820.36 }
            ],
            "events": [{ "type": "tp-moved", "time": 3, "price": 91000 }]
        });
        let kept = dedup_suggestions_against_trade(
            vec![
                suggestion("stop", Some(90820.36), "q1"),        // 与已落库 stop 同价 → 丢弃
                suggestion("stop", Some(90364.0), "q2"),          // 与 initialStopLoss 同 → 丢弃
                suggestion("target-moved", Some(91000.5), "q3"),  // 与 tp-moved 91000 差 0.5 < 容差 → 丢弃
                suggestion("target-moved", Some(90800.0), "q4"),  // 未覆盖 → 保留
                suggestion("stop", None, "q5"),                   // 无价格无法确认覆盖 → 保留
            ],
            &trade,
        );
        assert_eq!(kept.len(), 2);
        assert_eq!(kept[0].quote, "q4");
        assert_eq!(kept[1].quote, "q5");
    }

    #[test]
    fn suggestion_context_lists_cards_with_indices() {
        let trade = json!({
            "direction": "long",
            "status": "closed",
            "executions": [{ "action": "entry", "time": 1, "price": 90873.76, "quantity": 2.9 }],
            "events": []
        });
        let cards = vec![json!({
            "id": "card-1",
            "phase": "intermediate",
            "barRef": 152,
            "rawText": "我决定把止损移动到 90820.36"
        })];
        let context = suggestion_context(&rusqlite::Connection::open_in_memory().unwrap(), &trade, &cards);
        assert!(context.contains("交易背景：做多"));
        assert!(context.contains("首笔入场 90873.76"));
        assert!(context.contains("1. [过程] BAR152 我决定把止损移动到 90820.36"), "cardIndex/phase/bar/rawText");
    }

    #[test]
    fn tag_vocabulary_block_groups_by_color() {
        let defs = vec![
            json!({ "name": "左侧做单", "color": "red" }),
            json!({ "name": "突破", "color": "yellow" }),
            json!({ "name": "FOMO", "color": "blue" }),
        ];
        let block = tag_vocabulary_block(&defs);
        assert!(block.contains("- 红（定调整笔交易：定性错误，或最高评级（如 A级交易））：左侧做单"));
        assert!(block.contains("- 黄（市场结构）：突破"));
        assert!(block.contains("FOMO"));
        assert!(!block.contains("绿"), "空分组不出现");
        assert_eq!(tag_vocabulary_block(&[]), "");
    }

    #[test]
    fn card_resplit_never_touches_original_on_failure() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        db::save_record_in_tx(
            &conn,
            "cases",
            "case-1",
            json!({ "id": "case-1", "accountId": "acct-1", "periodId": "period-1", "title": "T", "status": "active", "provenance": "forward", "tagIds": [], "createdAt": 1, "updatedAt": 1 }),
        )
        .unwrap();
        db::save_record_in_tx(
            &conn,
            "caseCards",
            "card-short",
            json!({ "id": "card-short", "caseId": "case-1", "phase": "intermediate", "rawText": "太短了", "createdAt": 10 }),
        )
        .unwrap();
        let long_text = "190 号 K 线直接跌破了这个入场价，然后也是让我们成功的入场了。191 号 K 线开始向上反转，我觉得这更像是下跌趋势中的一个回调，还没有到要动仓位的时候。193 号 K 线继续向上涨，涨破了，并且收在了 EMA 20 的上方，我们看它会不会涨破前期重要高点。";
        db::save_record_in_tx(
            &conn,
            "caseCards",
            "card-long",
            json!({ "id": "card-long", "caseId": "case-1", "phase": "intermediate", "rawText": long_text, "createdAt": 20 }),
        )
        .unwrap();
        let db = db::Db::from_conn(conn);

        // 未知卡 → 报错
        assert!(futures::executor::block_on(run_card_resplit(None, &db, "card-404", 1000)).is_err());
        // 短卡 → 报错，不走 AI
        let err = futures::executor::block_on(run_card_resplit(None, &db, "card-short", 1000)).unwrap_err();
        assert!(err.contains("不需要重拆"));
        // 长卡但无 AI（单测无 AppHandle → 无默认 Provider）→ 报错且原卡不动（与批量拆卡的「退化单卡」相反）
        let err = futures::executor::block_on(run_card_resplit(None, &db, "card-long", 1000)).unwrap_err();
        assert!(err.contains("Provider"), "got: {err}");
        let all = db::read_case_cards_for_case(&db.conn().unwrap(), "case-1").unwrap();
        assert_eq!(all.len(), 2, "failure path must not touch any card");
        assert_eq!(all[1]["rawText"], long_text);
    }

    #[test]
    fn persist_resplit_replaces_original_and_prunes_suggestions() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        let original = json!({
            "id": "card-orig", "caseId": "case-1", "phase": "intermediate",
            "rawText": "一段足够长的原文，会由 AI 拆成多张卡。", "createdAt": 500,
            "barRef": 120, "entryDecision": "planned",
        });
        db::save_record_in_tx(
            &conn,
            "cases",
            "case-1",
            json!({
                "id": "case-1", "accountId": "acct-1", "periodId": "period-1", "title": "T",
                "status": "active", "provenance": "forward", "tagIds": [], "createdAt": 1, "updatedAt": 1,
                "aiExecutionSuggestions": { "suggestions": [
                    { "id": "s1", "cardId": "card-orig", "quote": "q", "status": "pending" },
                    { "id": "s2", "cardId": "card-other", "quote": "q", "status": "pending" },
                ]},
                "aiTagSuggestions": { "suggestions": [
                    { "id": "tag-突破", "name": "突破", "cardId": "card-orig", "quote": "q", "status": "pending" },
                ]},
            }),
        )
        .unwrap();
        db::save_record_in_tx(&conn, "caseCards", "card-orig", original.clone()).unwrap();

        let splits = vec![
            ai::ParsedCardSplit { bar_ref: None, text: "一段足够长的原文，".to_string() },
            ai::ParsedCardSplit { bar_ref: Some(121), text: "会由 AI 拆成多张卡。".to_string() },
        ];
        let created = persist_resplit(&conn, &original, splits, "rs-test-1", 500).unwrap();
        assert_eq!(created.len(), 2);
        assert_eq!(created[0]["id"], "rs-test-1-0");
        assert_eq!(created[0]["createdAt"], 500);
        assert_eq!(created[1]["createdAt"], 501, "createdAt 逐张 +1ms 保持原位置");
        assert_eq!(created[0]["entryDecision"], "planned", "entryDecision 仅首张继承");
        assert!(created[1].get("entryDecision").is_none());
        assert_eq!(created[0]["barRef"], 120, "首段无锚点时继承原卡 barRef");

        // 原卡软删：活跃列表只剩两张新卡
        let all = db::read_case_cards_for_case(&conn, "case-1").unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().all(|card| card["id"].as_str().unwrap().starts_with("rs-test-1")));

        // 指向原卡的建议被剔除，指向其他卡的保留
        let case_record = db::read_record_by_id(&conn, "cases", "case-1").unwrap().unwrap();
        let exec = case_record["aiExecutionSuggestions"]["suggestions"].as_array().unwrap();
        assert_eq!(exec.len(), 1);
        assert_eq!(exec[0]["cardId"], "card-other");
        let tags = case_record["aiTagSuggestions"]["suggestions"].as_array().unwrap();
        assert_eq!(tags.len(), 0);
    }
}

#[tauri::command]
fn regenerate_api_token(app: AppHandle) -> Result<api::ApiStatus, String> {
    api::regenerate_token(&app)
}

#[tauri::command]
fn set_api_config(app: AppHandle, enabled: bool, port: u16) -> Result<api::ApiStatus, String> {
    api::set_config(&app, enabled, port)
}

#[tauri::command]
fn list_ai_providers(app: AppHandle) -> Result<Vec<ai::AiProvider>, String> {
    ai::list(&app)
}

#[tauri::command]
fn save_ai_provider(app: AppHandle, provider: ai::AiProvider) -> Result<Vec<ai::AiProvider>, String> {
    let name = provider.name.clone();
    let providers = ai::save(&app, provider)?;
    ai::log_provider_event(&app, format!("provider saved: {name}"));
    Ok(providers)
}

#[tauri::command]
fn delete_ai_provider(app: AppHandle, id: String) -> Result<Vec<ai::AiProvider>, String> {
    ai::delete(&app, id)}

#[tauri::command]
async fn fetch_ai_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    ai::fetch_models(base_url, api_key).await
}

fn execution_action_label(action: &str) -> &'static str {
    match action {
        "entry" => "开仓",
        "scale-in" => "加仓",
        "scale-out" => "减仓",
        "exit" => "平仓",
        "stop" | "stop-moved" => "移动止损",
        "stop-set" => "设置止损",
        "target-set" => "设置止盈",
        "target-moved" => "移动止盈",
        "order-edit" => "修改订单",
        _ => "订单动作",
    }
}

fn trade_event_label(event_type: &str) -> &'static str {
    match event_type {
        "sl-set" => "设置止损",
        "sl-moved" => "移动止损",
        "tp-set" => "设置止盈",
        "tp-moved" => "移动止盈",
        _ => "图表备注",
    }
}

fn format_utc_compact(epoch_ms: u64) -> String {
    chrono::DateTime::from_timestamp_millis(epoch_ms as i64)
        .map(|time| time.format("%m-%d %H:%M UTC").to_string())
        .unwrap_or_else(|| "-".to_string())
}

fn truncate_chars(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

fn symbol_label_for_trade(conn: &rusqlite::Connection, trade: &Value) -> Option<String> {
    trade
        .get("symbolId")
        .and_then(Value::as_str)
        .and_then(|symbol_id| db::read_record_by_id(conn, "symbols", symbol_id).ok().flatten())
        .map(|symbol| {
            format!(
                "{} {}",
                symbol.get("exchange").and_then(Value::as_str).unwrap_or_default(),
                symbol.get("code").and_then(Value::as_str).unwrap_or_default()
            )
            .trim()
            .to_string()
        })
        .filter(|label| !label.is_empty())
}

fn trade_action_lines(trade: &Value) -> Vec<(u64, String)> {
    let mut lines: Vec<(u64, String)> = Vec::new();
    if let Some(executions) = trade.get("executions").and_then(Value::as_array) {
        for execution in executions {
            let Some(time) = execution.get("time").and_then(Value::as_u64) else { continue };
            let Some(action) = execution.get("action").and_then(Value::as_str) else { continue };
            let mut line = execution_action_label(action).to_string();
            if let Some(price) = execution.get("price").and_then(Value::as_f64) {
                line.push_str(&format!(" {price}"));
            }
            if let Some(quantity) = execution.get("quantity").and_then(Value::as_f64) {
                line.push_str(&format!(" ×{quantity}"));
            }
            lines.push((time, line));
        }
    }
    if let Some(events) = trade.get("events").and_then(Value::as_array) {
        for event in events {
            let Some(time) = event.get("time").and_then(Value::as_u64) else { continue };
            let Some(event_type) = event.get("type").and_then(Value::as_str) else { continue };
            let mut line = trade_event_label(event_type).to_string();
            if let Some(price) = event.get("price").and_then(Value::as_f64) {
                line.push_str(&format!(" {price}"));
            }
            lines.push((time, line));
        }
    }
    lines.sort_by_key(|(time, _)| *time);
    lines
}

/// 卡片分析（prompt v3）的背景资料块：品种、绑定交易的成交动作、同 Case 前情卡片。
/// 任一来源读取失败都降级为跳过该段——背景资料是辅助，绝不阻塞分析本身。
fn card_context(conn: &rusqlite::Connection, card: &Value) -> String {
    let Some(case_id) = card.get("caseId").and_then(Value::as_str) else {
        return String::new();
    };
    let card_created = card.get("createdAt").and_then(Value::as_u64).unwrap_or(0);
    let mut lines: Vec<String> = Vec::new();

    if let Ok(binding) = db::read_simple_collection(conn, "caseBindings") {
        let binding = binding
            .into_iter()
            .find(|item| item.get("caseId").and_then(Value::as_str) == Some(case_id));
        if let Some(binding) = binding {
            if let Some(trade_id) = binding.get("tradeId").and_then(Value::as_str) {
                if let Ok(Some(trade)) = db::read_trade_with_children(conn, trade_id) {
                    let symbol_label = symbol_label_for_trade(conn, &trade);
                    let direction = match trade.get("direction").and_then(Value::as_str) {
                        Some("long") => "做多",
                        Some("short") => "做空",
                        _ => "交易",
                    };
                    let status = match trade.get("status").and_then(Value::as_str) {
                        Some("closed") => "已平仓",
                        _ => "持仓中",
                    };
                    let mut summary = format!("绑定交易：{direction}");
                    if let Some(symbol_label) = symbol_label {
                        summary.push_str(&format!("（{symbol_label}）"));
                    }
                    summary.push_str(&format!("，{status}"));
                    if let Some(stop) = trade.get("initialStopLoss").and_then(Value::as_f64) {
                        summary.push_str(&format!("，初始止损 {stop}"));
                    }
                    lines.push(summary);
                    for (time, line) in trade_action_lines(&trade).into_iter().take(24) {
                        lines.push(format!("{line}（{}）", format_utc_compact(time)));
                    }
                }
            }
        }
    }

    if let Ok(cards) = db::read_case_cards_for_case(conn, case_id) {
        let previous: Vec<&Value> = cards
            .iter()
            .filter(|item| {
                item.get("id") != card.get("id")
                    && item.get("createdAt").and_then(Value::as_u64).unwrap_or(0) < card_created
            })
            .collect();
        if !previous.is_empty() {
            lines.push("前情（同 Case 更早的卡片）：".to_string());
            for item in previous.iter().rev().take(6).rev() {
                let phase = item.get("phase").and_then(Value::as_str).unwrap_or("");
                let phase_name = match phase {
                    "pre-entry" => "观察",
                    "entry" => "入场",
                    "intermediate" => "过程",
                    "closing" => "离场",
                    "reflection" => "复盘",
                    other => other,
                };
                let digest = item
                    .get("aiAnalysis")
                    .and_then(|analysis| analysis.get("digest"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| {
                        item.get("rawText")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .split('\n')
                            .map(str::trim)
                            .find(|line| !line.is_empty())
                            .unwrap_or_default()
                            .to_string()
                    });
                if digest.is_empty() {
                    continue;
                }
                match item.get("barRef").and_then(Value::as_u64) {
                    Some(bar) => lines.push(format!("[{phase_name}] BAR{bar} {}", truncate_chars(&digest, 40))),
                    None => lines.push(format!("[{phase_name}] {}", truncate_chars(&digest, 40))),
                }
            }
        }
    }

    if lines.is_empty() {
        return String::new();
    }
    format!("背景资料（仅供理解，不是本卡内容）：\n{}", lines.join("\n"))
}

/// AI 秘书整理一张 Card 的完整链路：读卡 → 请求（失败自动重试一次）→ 解析 → 写回
/// 版本化派生数据 card.aiAnalysis；原文永不改写。手动按钮与 REST 自动整理共用。
/// instruction 是用户重试时的补充要求，例如"止损不是 41650，注意口语里的位置词"。
/// allow_overwrite_adjusted=false（自动分析）时，若用户已手动修正过派生数据则放弃写回。
pub(crate) async fn run_card_analysis(
    app: &AppHandle,
    db: &db::Db,
    card_id: &str,
    instruction: Option<String>,
    allow_overwrite_adjusted: bool,
) -> Result<Option<Value>, String> {
    let (card, provider, model, context) = {
        let conn = db.conn()?;
        let card = db::read_record_by_id(&conn, "caseCards", card_id)?
            .ok_or_else(|| format!("case card not found: {card_id}"))?;
        let (provider, model) = ai::default_provider(app)?
            .ok_or_else(|| "还没有默认 AI Provider，请在 设置 → AI 中配置".to_string())?;
        let context = card_context(&conn, &card);
        (card, provider, model, context)
    };
    let raw_text = card
        .get("rawText")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let phase = card
        .get("phase")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mut messages = ai::build_analysis_messages(&phase, &raw_text, &context);
    if let Some(extra) = instruction.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        messages.push(ai::ChatMessage::user(format!("补充整理要求：{extra}")));
    }
    ai::log_provider_event(app, format!("analyzing card {card_id} with {model}"));
    let content = ai::chat_completion_with_retry(&provider, &model, &messages).await?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    let analysis = ai::parse_analysis(&phase, &raw_text, &content, &model, &provider.id, now)?;

    // 写回前重读现记录，只覆盖 aiAnalysis（barRef 也只在现记录缺失时回填）：
    // 分析耗时秒级到 30 秒，期间用户的 rawText 错字修正 / barRef 修正 /
    // 手动调整过的派生数据不能被请求前的快照整卡回滚。
    let updated = {
        let conn = db.conn()?;
        let mut current = db::read_record_by_id(&conn, "caseCards", card_id)?
            .ok_or_else(|| format!("case card not found: {card_id}"))?;
        let user_adjusted = current
            .get("aiAnalysis")
            .and_then(|value| value.get("userAdjusted"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if user_adjusted && !allow_overwrite_adjusted {
            ai::log_provider_event(
                app,
                format!("card {card_id} auto analysis skipped: user-adjusted analysis present"),
            );
            return Ok(None);
        }
        if current.get("barRef").is_none() {
            if let Some(bar) = analysis
                .get("barRef")
                .and_then(|value| value.get("bar"))
                .and_then(Value::as_i64)
            {
                current["barRef"] = serde_json::json!(bar);
            }
        }
        current["aiAnalysis"] = analysis;
        db::save_record_in_tx(&conn, "caseCards", card_id, current.clone())?;
        current
    };
    ai::log_provider_event(app, format!("card {card_id} analyzed"));
    Ok(Some(updated))
}

#[tauri::command]
async fn analyze_case_card(
    app: AppHandle,
    db: tauri::State<'_, db::Db>,
    card_id: String,
    instruction: Option<String>,
) -> Result<Value, String> {
    run_card_analysis(&app, &db, &card_id, instruction, true)
        .await?
        .ok_or_else(|| "已手动修正过的分析未被覆盖；如需重新识别请从界面确认".to_string())
}

/// 管理动作分类：stop 家族 / target 家族 / 其他。建议与已落库动作按此比对。
fn management_class(action: &str) -> &'static str {
    match action {
        "stop" | "stop-set" | "stop-moved" | "sl-set" | "sl-moved" => "stop",
        "target-set" | "target-moved" | "tp-set" | "tp-moved" => "target",
        _ => "other",
    }
}

/// 建议上下文：交易背景 + 已落库动作 + 编号卡片清单（原话供 quote 逐字校验）。
fn suggestion_context(
    conn: &rusqlite::Connection,
    trade: &Value,
    cards: &[Value],
) -> String {
    let mut out = String::new();
    let direction = match trade.get("direction").and_then(Value::as_str) {
        Some("long") => "做多",
        Some("short") => "做空",
        _ => "交易",
    };
    let status = match trade.get("status").and_then(Value::as_str) {
        Some("closed") => "已平仓",
        _ => "持仓中",
    };
    out.push_str(&format!("交易背景：{direction}"));
    if let Some(label) = symbol_label_for_trade(conn, trade) {
        out.push_str(&format!(" {label}"));
    }
    out.push_str(&format!("（{status}）"));
    if let Some(entry) = trade
        .get("executions")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .filter(|e| e.get("action").and_then(Value::as_str) == Some("entry"))
                .filter_map(|e| e.get("price").and_then(Value::as_f64))
                .next()
        })
    {
        out.push_str(&format!("，首笔入场 {entry}"));
    }
    if let Some(stop) = trade.get("initialStopLoss").and_then(Value::as_f64) {
        out.push_str(&format!("，初始止损 {stop}"));
    }
    if let Some(target) = trade.get("initialTakeProfit").and_then(Value::as_f64) {
        out.push_str(&format!("，初始止盈 {target}"));
    }
    out.push_str("\n已落库动作（来自交易所导出与手动记录）：\n");
    let actions = trade_action_lines(trade);
    if actions.is_empty() {
        out.push_str("- 无\n");
    } else {
        for (time, line) in actions.into_iter().take(30) {
            out.push_str(&format!("- {line}（{}）\n", format_utc_compact(time)));
        }
    }
    out.push_str("卡片记录（每张开头是 cardIndex 编号，quote 必须逐字来自该卡原文）：\n");
    for (index, card) in cards.iter().enumerate() {
        let phase = card.get("phase").and_then(Value::as_str).unwrap_or("");
        let phase_name = match phase {
            "pre-entry" => "观察",
            "entry" => "入场",
            "intermediate" => "过程",
            "closing" => "离场",
            "reflection" => "复盘",
            other => other,
        };
        let bar = card
            .get("barRef")
            .and_then(Value::as_u64)
            .map(|bar| format!(" BAR{bar}"))
            .unwrap_or_default();
        let text = card
            .get("rawText")
            .and_then(Value::as_str)
            .unwrap_or_default();
        out.push_str(&format!("{}. [{}]{} {}\n", index + 1, phase_name, bar, truncate_chars(text, 500)));
    }
    out
}

/// 机械去重：与已落库管理动作/初始止损止盈比对，同分类且价格基本相同（相对 0.02%）
/// 的建议视为已覆盖，丢弃。比对参照价取首笔入场价，无成交时取建议价本身。
fn dedup_suggestions_against_trade(
    suggestions: Vec<ai::ParsedSuggestion>,
    trade: &Value,
) -> Vec<ai::ParsedSuggestion> {
    let reference = trade
        .get("executions")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .filter(|e| e.get("action").and_then(Value::as_str) == Some("entry"))
                .filter_map(|e| e.get("price").and_then(Value::as_f64))
                .next()
        })
        .unwrap_or(0.0);

    let mut existing: Vec<(&str, f64)> = Vec::new();
    if let Some(executions) = trade.get("executions").and_then(Value::as_array) {
        for execution in executions {
            let action = execution.get("action").and_then(Value::as_str).unwrap_or("");
            let class = management_class(action);
            if class == "other" {
                continue;
            }
            if let Some(price) = execution.get("price").and_then(Value::as_f64) {
                existing.push((class, price));
            }
        }
    }
    if let Some(events) = trade.get("events").and_then(Value::as_array) {
        for event in events {
            let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
            let class = management_class(event_type);
            if class == "other" {
                continue;
            }
            if let Some(price) = event.get("price").and_then(Value::as_f64) {
                existing.push((class, price));
            }
        }
    }
    if let Some(stop) = trade.get("initialStopLoss").and_then(Value::as_f64) {
        existing.push(("stop", stop));
    }
    if let Some(target) = trade.get("initialTakeProfit").and_then(Value::as_f64) {
        existing.push(("target", target));
    }

    suggestions
        .into_iter()
        .filter(|suggestion| {
            let Some(price) = suggestion.price else { return true };
            let tolerance = (reference.abs().max(price) * 0.0002).max(1e-9);
            !existing
                .iter()
                .any(|(class, existing_price)| {
                    *class == management_class(&suggestion.action)
                        && (existing_price - price).abs() <= tolerance
                })
        })
        .collect()
}

fn suggestion_fingerprint(item: &ai::ParsedSuggestion) -> String {
    format!(
        "{}|{}|{}|{}",
        item.card_id,
        item.action,
        item.quote,
        item.price.map(|price| price.to_string()).unwrap_or_else(|| "-".to_string())
    )
}

/// 标签词表（供 AI 标签建议）：按颜色分组 + 每组语义说明。颜色语义是用户标签
/// 体系的约定（红=定调整笔交易……），分组数据来自 tagDefs；无标签时返回空串。
fn tag_vocabulary_block(tag_defs: &[Value]) -> String {
    const COLOR_GROUPS: [(&str, &str, &str); 7] = [
        ("red", "红", "定调整笔交易：定性错误，或最高评级（如 A级交易）"),
        ("orange", "橙", "顺势 / 周期位置"),
        ("yellow", "黄", "市场结构"),
        ("green", "绿", "仓位与执行"),
        ("cyan", "青", "复盘状态"),
        ("blue", "蓝", "情绪"),
        ("purple", "紫", "特殊标注"),
    ];
    let mut block = String::from("标签词表（tradeTags 只能从中选择，不许造新标签名，按颜色分组）：\n");
    let mut has_any = false;
    for (color, label, meaning) in COLOR_GROUPS {
        let names: Vec<&str> = tag_defs
            .iter()
            .filter(|def| def.get("color").and_then(Value::as_str) == Some(color))
            .filter_map(|def| def.get("name").and_then(Value::as_str))
            .collect();
        if names.is_empty() {
            continue;
        }
        has_any = true;
        block.push_str(&format!("- {label}（{meaning}）：{}\n", names.join("、")));
    }
    if has_any { block } else { String::new() }
}

/// 持仓管理补录建议完整链路：读 Case/卡片/绑定 Trade → 组装上下文 → 一次 AI 调用 →
/// 机械校验（quote 逐字、白名单、去重）→ 与上一轮的 accepted/dismissed 状态按指纹合并 →
/// 写回 case.aiExecutionSuggestions（版本化派生数据）。建议永远只是候选，落地由用户确认。
/// 0.3.4 起同一次调用还产出交易标签建议（case.aiTagSuggestions）：词表来自 tagDefs，
/// 校验规则同款（词表命中 + quote 逐字），应用到 Trade 上的动作由用户逐条确认。
pub(crate) async fn run_execution_suggestions(
    app: &AppHandle,
    db: &db::Db,
    case_id: &str,
) -> Result<Value, String> {
    let (trade, cards, provider, model, context, tag_defs) = {
        let conn = db.conn()?;
        db::read_record_by_id(&conn, "cases", case_id)?
            .ok_or_else(|| format!("case not found: {case_id}"))?;
        let cards = db::read_case_cards_for_case(&conn, case_id)?;
        let binding = db::read_simple_collection(&conn, "caseBindings")?
            .into_iter()
            .find(|item| item.get("caseId").and_then(Value::as_str) == Some(case_id))
            .ok_or_else(|| "该 Case 尚未绑定 Trade，无法检查持仓动作".to_string())?;
        let trade_id = binding
            .get("tradeId")
            .and_then(Value::as_str)
            .ok_or_else(|| "binding is missing tradeId".to_string())?
            .to_string();
        let trade = db::read_trade_with_children(&conn, &trade_id)?
            .ok_or_else(|| format!("trade not found: {trade_id}"))?;
        let (provider, model) = ai::default_provider(app)?
            .ok_or_else(|| "还没有默认 AI Provider，请在 设置 → AI 中配置".to_string())?;
        let mut context = suggestion_context(&conn, &trade, &cards);
        let tag_defs = db::read_simple_collection(&conn, "tagDefs")?;
        context.push_str(&tag_vocabulary_block(&tag_defs));
        (trade, cards, provider, model, context, tag_defs)
    };

    let messages = ai::build_suggestion_messages(&context);
    // analyzedAt 取发起时刻：AI 期间新增/编辑的卡片才不会被误判为「总结前」
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    ai::log_provider_event(app, format!("checking execution suggestions for case {case_id} with {model}"));
    let content = ai::chat_completion_with_retry(&provider, &model, &messages).await?;
    let card_pairs: Vec<(String, String)> = cards
        .iter()
        .map(|card| {
            (
                card.get("id").and_then(Value::as_str).unwrap_or_default().to_string(),
                card.get("rawText").and_then(Value::as_str).unwrap_or_default().to_string(),
            )
        })
        .collect();
    let parsed = ai::parse_execution_suggestions(&content, &card_pairs)?;
    let deduped = dedup_suggestions_against_trade(parsed, &trade);

    // 标签建议：词表校验 + 证据逐字校验在 parse_trade_tags 内完成，这里再剔除
    // Trade 已带的标签（重复建议没有意义）
    let vocabulary: Vec<String> = tag_defs
        .iter()
        .filter_map(|def| def.get("name").and_then(Value::as_str).map(str::to_string))
        .collect();
    let existing_tags: Vec<String> = trade
        .get("tags")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();
    let parsed_tags: Vec<ai::ParsedTradeTag> = ai::parse_trade_tags(&content, &card_pairs, &vocabulary)
        .into_iter()
        .filter(|tag| {
            !existing_tags
                .iter()
                .any(|existing| existing.trim().eq_ignore_ascii_case(tag.name.trim()))
        })
        .collect();

    // 写回前重读 Case：只替换 aiExecutionSuggestions 字段，不回滚并发修改（标题等）
    let conn = db.conn()?;
    let mut current = db::read_record_by_id(&conn, "cases", case_id)?
        .ok_or_else(|| format!("case not found: {case_id}"))?;
    let previous: Vec<Value> = current
        .get("aiExecutionSuggestions")
        .and_then(|value| value.get("suggestions"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let previous_by_fingerprint: std::collections::HashMap<String, Value> = previous
        .into_iter()
        .filter_map(|item| {
            let fingerprint = format!(
                "{}|{}|{}|{}",
                item.get("cardId").and_then(Value::as_str).unwrap_or_default(),
                item.get("action").and_then(Value::as_str).unwrap_or_default(),
                item.get("quote").and_then(Value::as_str).unwrap_or_default(),
                item.get("price").and_then(Value::as_f64).map(|price| price.to_string()).unwrap_or_else(|| "-".to_string())
            );
            Some((fingerprint, item))
        })
        .collect();

    let mut suggestions: Vec<Value> = Vec::new();
    for (index, item) in deduped.into_iter().enumerate() {
        let fingerprint = suggestion_fingerprint(&item);
        let status = previous_by_fingerprint
            .get(&fingerprint)
            .and_then(|old| old.get("status")).cloned();
        let accepted_execution_id = previous_by_fingerprint
            .get(&fingerprint)
            .and_then(|old| old.get("acceptedExecutionId")).cloned();
        let dismissed_at = previous_by_fingerprint
            .get(&fingerprint)
            .and_then(|old| old.get("dismissedAt")).cloned();
        let bar_ref = cards
            .iter()
            .find(|card| card.get("id").and_then(Value::as_str) == Some(item.card_id.as_str()))
            .and_then(|card| card.get("barRef").cloned());
        let mut suggestion = json!({
            "id": format!("{}-{}", item.card_id, index),
            "action": item.action,
            "orderType": item.order_type,
            "price": item.price,
            "anchorText": item.anchor_text,
            "signal": item.signal,
            "cardId": item.card_id,
            "quote": item.quote,
            "status": status.unwrap_or(json!("pending")),
        });
        if let Some(bar) = bar_ref {
            suggestion["barRef"] = bar;
        }
        if let Some(execution_id) = accepted_execution_id {
            suggestion["acceptedExecutionId"] = execution_id;
        }
        if let Some(dismissed) = dismissed_at {
            suggestion["dismissedAt"] = dismissed;
        }
        suggestions.push(suggestion);
    }

    let blob = json!({
        "schemaVersion": ai::SUGGESTION_PROMPT_VERSION,
        "promptVersion": ai::SUGGESTION_PROMPT_VERSION,
        "model": model,
        "providerId": provider.id,
        "analyzedAt": now,
        "suggestions": suggestions,
    });
    current["aiExecutionSuggestions"] = blob;

    // 标签建议与动作建议同一轮产出、同一 analyzedAt；指纹 = 标签名，重跑延续已处理状态
    let previous_tags: Vec<Value> = current
        .get("aiTagSuggestions")
        .and_then(|value| value.get("suggestions"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let previous_tag_by_name: std::collections::HashMap<String, Value> = previous_tags
        .into_iter()
        .filter_map(|item| {
            let name = item.get("name").and_then(Value::as_str)?.trim().to_lowercase();
            Some((name, item))
        })
        .collect();
    let mut tag_suggestions: Vec<Value> = Vec::new();
    for tag in parsed_tags {
        let old = previous_tag_by_name.get(&tag.name.trim().to_lowercase());
        let mut suggestion = json!({
            "id": format!("tag-{}", tag.name),
            "name": tag.name,
            "quote": tag.quote,
            "cardId": tag.card_id,
            "status": old
                .and_then(|item| item.get("status"))
                .cloned()
                .unwrap_or_else(|| json!("pending")),
        });
        if let Some(signal) = tag.signal {
            suggestion["signal"] = json!(signal);
        }
        if let Some(at) = old.and_then(|item| item.get("acceptedAt")).cloned() {
            suggestion["acceptedAt"] = at;
        }
        if let Some(at) = old.and_then(|item| item.get("dismissedAt")).cloned() {
            suggestion["dismissedAt"] = at;
        }
        tag_suggestions.push(suggestion);
    }
    current["aiTagSuggestions"] = json!({
        "schemaVersion": ai::SUGGESTION_PROMPT_VERSION,
        "promptVersion": ai::SUGGESTION_PROMPT_VERSION,
        "model": model,
        "providerId": provider.id,
        "analyzedAt": now,
        "suggestions": tag_suggestions,
    });
    db::save_record_in_tx(&conn, "cases", case_id, current.clone())?;
    ai::log_provider_event(app, format!("case {case_id} execution suggestions updated"));
    Ok(current)
}

#[tauri::command]
async fn suggest_case_executions(
    app: AppHandle,
    db: tauri::State<'_, db::Db>,
    case_id: String,
) -> Result<Value, String> {
    let result = run_execution_suggestions(&app, &db, &case_id).await;
    if let Err(err) = &result {
        // 手动检查失败必须留痕：前端只显示一句话，原因靠日志页排查
        ai::log_provider_event(&app, format!("execution suggestions for case {case_id} failed: {err}"));
    }
    result
}

/// 整单总结的流式输出状态机：
/// - 正文增量 80ms 合批经 cairn://ai-stream 推送（每个 delta 一次 IPC 会洪泛 webview）；
/// - 思考文本不外发（太长且噪音大），只报进度：思考时长 / 已输出字数（tokens 有则报 tokens）。
struct SummaryStreamBatcher {
    app: AppHandle,
    task_id: Option<String>,
    buffer: std::sync::Mutex<String>,
    last_flush_ms: std::sync::Mutex<u64>,
    started_at: std::sync::Mutex<Option<std::time::Instant>>,
    first_content_at: std::sync::Mutex<Option<std::time::Instant>>,
    output_chars: std::sync::atomic::AtomicUsize,
    last_progress_ms: std::sync::Mutex<u64>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

impl SummaryStreamBatcher {
    fn new(app: AppHandle, task_id: Option<String>) -> Self {
        Self {
            app,
            task_id,
            buffer: std::sync::Mutex::new(String::new()),
            last_flush_ms: std::sync::Mutex::new(0),
            started_at: std::sync::Mutex::new(None),
            first_content_at: std::sync::Mutex::new(None),
            output_chars: std::sync::atomic::AtomicUsize::new(0),
            last_progress_ms: std::sync::Mutex::new(0),
        }
    }

    fn emit(&self, payload: Value) {
        let Some(task_id) = self.task_id.as_deref() else { return };
        let _ = self.app.emit(crate::api::AI_STREAM_EVENT, json!({ "taskId": task_id, "progress": payload }));
    }

    fn thinking_ms(&self) -> u64 {
        // 思考时长 = 首个正文增量 − 首个思考增量（还没开始写正文就一直计到当前）
        let started = *self.started_at.lock().unwrap();
        let Some(started) = started else { return 0 };
        let anchor = self
            .first_content_at
            .lock()
            .unwrap()
            .unwrap_or_else(std::time::Instant::now);
        anchor.duration_since(started).as_millis() as u64
    }

    /// 思考阶段进度（500ms 节流，避免长思考刷屏 IPC）。
    fn note_reasoning(&self) {
        let mut started = self.started_at.lock().unwrap();
        if started.is_none() {
            *started = Some(std::time::Instant::now());
        }
        drop(started);
        let now = now_ms();
        let mut last = self.last_progress_ms.lock().unwrap();
        if now.saturating_sub(*last) < 500 {
            return;
        }
        *last = now;
        drop(last);
        self.emit(json!({
            "phase": "thinking",
            "thinkingMs": self.thinking_ms(),
            "outputChars": self.output_chars.load(std::sync::atomic::Ordering::Relaxed),
        }));
    }

    /// 正文增量：合批冲刷 + 输出量进度。
    fn note_content(&self, text: &str) {
        {
            let mut started = self.started_at.lock().unwrap();
            if started.is_none() {
                *started = Some(std::time::Instant::now());
            }
        }
        let first_just_set = {
            let mut first = self.first_content_at.lock().unwrap();
            let was_none = first.is_none();
            if was_none {
                *first = Some(std::time::Instant::now());
            }
            was_none
        };

        self.output_chars.fetch_add(text.chars().count(), std::sync::atomic::Ordering::Relaxed);
        self.buffer.lock().unwrap().push_str(text);
        // 首个正文增量：思考刚结束，立即报一次带思考时长的进度
        if first_just_set {
            *self.last_progress_ms.lock().unwrap() = 0;
        }
        let now = now_ms();
        if now.saturating_sub(*self.last_flush_ms.lock().unwrap()) >= 80
            || self.buffer.lock().unwrap().chars().count() >= 200
        {
            self.flush_delta(now);
        }
        if now.saturating_sub(*self.last_progress_ms.lock().unwrap()) >= 500 {
            *self.last_progress_ms.lock().unwrap() = now;
            self.emit(json!({
                "phase": "writing",
                "thinkingMs": self.thinking_ms(),
                "outputChars": self.output_chars.load(std::sync::atomic::Ordering::Relaxed),
            }));
        }
    }

    fn flush_delta(&self, now: u64) {
        let payload = std::mem::take(&mut *self.buffer.lock().unwrap());
        *self.last_flush_ms.lock().unwrap() = now;
        if payload.is_empty() {
            return;
        }
        if let Some(task_id) = self.task_id.as_deref() {
            let _ = self.app.emit(crate::api::AI_STREAM_EVENT, json!({ "taskId": task_id, "delta": payload }));
        }
    }

    /// 结束：冲掉正文尾巴 + 最终进度（带 token 与思考量统计）。
    fn finish(&self, outcome: &ai::StreamOutcome) {
        self.flush_delta(now_ms());
        let mut progress = json!({
            "phase": "writing",
            "thinkingMs": self.thinking_ms(),
            "outputChars": self.output_chars.load(std::sync::atomic::Ordering::Relaxed),
            "reasoningChars": outcome.reasoning_chars,
        });
        if let Some(tokens) = outcome.completion_tokens {
            progress["outputTokens"] = json!(tokens);
        }
        self.emit(progress);
    }
}

/// 整单总结的 AI 管道：上下文由前端组装（metrics/计划对比在 TS 侧计算），
/// Rust 只负责调用与解析校验；模型/时间等版本字段由前端落库时补齐。
/// task_id 存在时走流式：思考进度与正文增量经 cairn://ai-stream 事件推给前端。
#[tauri::command]
async fn ai_summarize_case(
    app: AppHandle,
    context: String,
    instruction: Option<String>,
    task_id: Option<String>,
) -> Result<Value, String> {
    let (provider, model) = ai::default_provider(&app)?
        .ok_or_else(|| "还没有默认 AI Provider，请在 设置 → AI 中配置".to_string())?;
    let mut messages = ai::build_summary_messages(&context);
    if let Some(extra) = instruction.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        messages.push(ai::ChatMessage::user(format!("补充总结要求：{extra}")));
    }
    ai::log_provider_event(&app, format!("summarizing case with {model}"));
    let batcher = std::sync::Arc::new(SummaryStreamBatcher::new(app.clone(), task_id));
    let weak = std::sync::Arc::downgrade(&batcher);
    let on_chunk = move |chunk: &ai::StreamChunk| {
        // WeakRef：命令返回后（理论上回调不会再触发）批处理器允许被释放
        let Some(batcher) = weak.upgrade() else { return };
        match chunk.kind {
            ai::StreamChunkKind::Reasoning => batcher.note_reasoning(),
            ai::StreamChunkKind::Content => batcher.note_content(&chunk.text),
        }
    };

    let summary = match async {
        let outcome = ai::chat_completion_stream_with_retry(&provider, &model, &messages, &on_chunk).await?;
        let mut summary = ai::parse_summary(&outcome.content)?;
        summary["model"] = json!(model);
        summary["providerId"] = json!(provider.id);
        Ok::<(Value, ai::StreamOutcome), String>((summary, outcome))
    }
    .await
    {
        Ok((summary, outcome)) => {
            batcher.finish(&outcome);
            summary
        }
        Err(err) => {
            // 手动总结失败必须留痕：前端只显示一句话，原因靠日志页排查
            ai::log_provider_event(&app, format!("case summary failed: {err}"));
            return Err(err);
        }
    };
    Ok(summary)
}

#[tauri::command]
fn get_ai_settings(app: AppHandle) -> Result<ai::AiSettings, String> {
    Ok(ai::settings(&app))
}

/// 默认 Provider 的并发上限：「全部识别」批量 worker 数与后台自动识别闸门共用（默认 10）。
#[tauri::command]
fn default_ai_concurrency(app: AppHandle) -> Result<usize, String> {
    Ok(ai::default_provider(&app)?
        .map(|(provider, _)| ai::concurrency_of(&provider))
        .unwrap_or(10))
}

#[tauri::command]
fn save_ai_settings(app: AppHandle, settings: ai::AiSettings) -> Result<ai::AiSettings, String> {
    ai::save_settings(&app, settings)
}

/// 出站代理设置（0.3.2）：作用于 Rust 侧全部出站请求（AI + GitHub 检查）。
#[tauri::command]
fn get_network_settings(app: AppHandle) -> Result<ai::NetworkSettings, String> {
    let mut settings = ai::network_settings(&app);
    settings.effective_proxy_url = ai::effective_proxy_url();
    Ok(settings)
}

#[tauri::command]
fn save_network_settings(app: AppHandle, settings: ai::NetworkSettings) -> Result<ai::NetworkSettings, String> {
    ai::save_network_settings(&app, settings)
}

#[tauri::command]
fn set_default_ai_provider(app: AppHandle, id: String) -> Result<Vec<ai::AiProvider>, String> {
    ai::set_default(&app, id)
}

/// AI 秘书代拟 Case 标题：读 Case 的全部 Card 原文，返回一个短标题草稿（不落库，由前端确认写入）。
#[tauri::command]
async fn draft_case_title(
    app: AppHandle,
    db: tauri::State<'_, db::Db>,
    case_id: String,
) -> Result<String, String> {
    let (provider, model, cards) = {
        let conn = db.conn()?;
        if db::read_record_by_id(&conn, "cases", &case_id)?.is_none() {
            return Err(format!("case not found: {case_id}"));
        }
        let cards: Vec<(String, String)> = db::read_case_cards_for_case(&conn, &case_id)?
            .iter()
            .filter_map(|card| {
                let phase = card.get("phase")?.as_str()?.to_string();
                let text = card.get("rawText")?.as_str()?.to_string();
                Some((phase, text))
            })
            .collect();
        let (provider, model) = ai::default_provider(&app)?
            .ok_or_else(|| "还没有默认 AI Provider，请在 设置 → AI 中配置".to_string())?;
        (provider, model, cards)
    };
    if cards.is_empty() {
        return Err("这个 Case 还没有 Card，无法拟题".to_string());
    }
    let messages = ai::build_title_messages(&cards);
    ai::log_provider_event(&app, format!("drafting title for case {case_id}"));
    let content = ai::chat_completion_with_retry(&provider, &model, &messages).await?;
    let title = ai::parse_title(&content)?;
    ai::log_provider_event(&app, format!("case {case_id} title drafted"));
    Ok(title)
}

/// 关联推荐：AI 只排序+解释，候选池由前端机械预筛（同账户/未绑定/时间距离），
/// 绑定动作永远由用户确认。
#[tauri::command]
async fn ai_suggest_bindings(app: AppHandle, context: String, candidate_count: usize) -> Result<Value, String> {
    let (provider, model) = ai::default_provider(&app)?
        .ok_or_else(|| "还没有默认 AI Provider，请在 设置 → AI 中配置".to_string())?;
    let messages = ai::build_binding_messages(&context);
    ai::log_provider_event(&app, format!("suggesting bindings with {model}"));
    let content = ai::chat_completion_with_retry(&provider, &model, &messages).await?;
    let matches = ai::parse_binding_matches(&content, candidate_count)?;
    Ok(json!({ "schemaVersion": ai::BINDING_PROMPT_VERSION, "matches": matches }))
}

/// 批量语音拆卡（0.3.0）：一大段口语原文按 K 线锚点 AI 拆成多张卡，直接落库（流畅优先，
/// 不做预览——拆错了用删卡/改字收拾）。机械校验失败或 AI 不可用时整体退化为一张完整卡，
/// 绝不丢原文。幂等：clientRequestId 首段存在时视为重放，原样返回已创建的卡。
/// 锁纪律：校验/落库各持一次短 DB 锁，AI 调用期间不持锁——这把锁与所有 GUI Tauri
/// 命令共享，跨 AI 持有会卡死主窗口（90s 超时 + 重试最长 ~3 分钟）。
pub(crate) async fn run_batch_split(
    app: Option<&AppHandle>,
    db: &db::Db,
    case_id: &str,
    phase: &str,
    raw_text: &str,
    entry_decision: Option<String>,
    client_request_id: &str,
    now: u64,
) -> Result<(Vec<Value>, bool), String> {
    // 阶段 1（短锁）：校验 + 幂等重放探测
    {
        let conn = db.conn()?;
        if db::read_record_by_id(&conn, "cases", case_id)?.is_none() {
            return Err(format!("case not found: {case_id}"));
        }
        const PHASES: [&str; 5] = ["pre-entry", "entry", "intermediate", "closing", "reflection"];
        if !PHASES.contains(&phase) {
            return Err(format!("invalid phase: {phase}; must be one of {PHASES:?}"));
        }
        if raw_text.trim().is_empty() {
            return Err("request body is missing valid rawText".to_string());
        }
        if !client_request_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
            || client_request_id.len() > 48
        {
            return Err("invalid clientRequestId: use 1-48 characters of letters, digits, '-' or '_'".to_string());
        }
        if let Some(replayed) = collect_batch_replay(&conn, client_request_id)? {
            // 同 id 不同原文 → 与 POST /cards 的 409 immutable 语义对齐
            let first_text = replayed[0]
                .get("rawText")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !raw_text.contains(first_text) {
                return Err(format!(
                    "clientRequestId {client_request_id} already exists with different rawText"
                ));
            }
            return Ok((replayed, false));
        }
    }

    // 阶段 2（无锁）：AI 拆分。短文本不可能是多卡；无 AppHandle（单测）、无默认
    // Provider 或 AI/解析失败 → 退化为完整单卡。
    let single = || vec![ai::ParsedCardSplit {
        bar_ref: api::extract_bar_ref(raw_text),
        text: raw_text.trim().to_string(),
    }];
    let splits: Vec<ai::ParsedCardSplit> = if raw_text.chars().count() < 60 {
        single()
    } else {
        match app.and_then(|app| ai::default_provider(app).ok().flatten()) {
            Some((provider, model)) => {
                let messages = ai::build_split_messages(phase, raw_text);
                match ai::chat_completion_with_retry(&provider, &model, &messages).await {
                    Ok(content) => ai::parse_card_splits(&content, raw_text).unwrap_or_else(|_| single()),
                    Err(err) => {
                        if let Some(app) = app {
                            ai::log_provider_event(app, format!("batch split degraded to single card: {err}"));
                        }
                        single()
                    }
                }
            }
            None => single(),
        }
    };

    // 阶段 3（短锁）：落库。重验首段存在性——并发同 rid（重试撞上慢请求）直接读回。
    let conn = db.conn()?;
    if let Some(replayed) = collect_batch_replay(&conn, client_request_id)? {
        return Ok((replayed, false));
    }
    let mut created: Vec<Value> = Vec::new();
    for (index, split) in splits.into_iter().enumerate() {
        let id = format!("{client_request_id}-{index}");
        // createdAt 逐张 +1ms：前端按 createdAt 排序，避免 10 张以上时 id 字典序错乱
        let mut data = json!({
            "id": id,
            "caseId": case_id,
            "phase": phase,
            "rawText": split.text,
            "createdAt": now + index as u64,
        });
        if let Some(bar) = split.bar_ref {
            data["barRef"] = json!(bar);
        }
        if index == 0 {
            if let Some(decision) = entry_decision.as_deref() {
                data["entryDecision"] = json!(decision);
            }
        }
        db::save_record_in_tx(&conn, "caseCards", &id, data.clone())?;
        created.push(data);
    }
    if let Some(app) = app {
        ai::log_provider_event(app, format!("batch split for case {case_id}: {} cards", created.len()));
    }
    Ok((created, true))
}

/// 幂等重放收集：{rid}-0 存在 → 依序收集 {rid}-{i} 直到断档。
fn collect_batch_replay(
    conn: &rusqlite::Connection,
    client_request_id: &str,
) -> Result<Option<Vec<Value>>, String> {
    let first_id = format!("{client_request_id}-0");
    let Some(first) = db::read_record_by_id(conn, "caseCards", &first_id)? else {
        return Ok(None);
    };
    let mut replayed = vec![first];
    for index in 1.. {
        match db::read_record_by_id(conn, "caseCards", &format!("{client_request_id}-{index}"))? {
            Some(card) => replayed.push(card),
            None => break,
        }
    }
    Ok(Some(replayed))
}

/// AI 重拆已有卡片（0.3.4）：复盘时发现一张卡里挤了多个独立观察，用拆卡 AI 重新
/// 拆分并替换原卡。与批量拆卡共用 prompt 与机械校验，但降级策略相反——AI 不可用、
/// 校验不过或只拆出一段时原卡原样不动（返回错误）：重拆是破坏性替换，不允许
/// 「退化成单卡」白白丢掉原卡的 aiAnalysis / rawTextHistory。
/// 锁纪律与 run_batch_split 相同（短锁×3，AI 期间不持锁）。
pub(crate) async fn run_card_resplit(
    app: Option<&AppHandle>,
    db: &db::Db,
    card_id: &str,
    now: u64,
) -> Result<(String, Vec<Value>), String> {
    // 阶段 1（短锁）：读原卡并校验
    let original = {
        let conn = db.conn()?;
        db::read_record_by_id(&conn, "caseCards", card_id)?
            .ok_or_else(|| format!("case card not found: {card_id}"))?
    };
    let case_id = original
        .get("caseId")
        .and_then(Value::as_str)
        .ok_or_else(|| "card is missing caseId".to_string())?
        .to_string();
    let phase = original
        .get("phase")
        .and_then(Value::as_str)
        .unwrap_or("intermediate")
        .to_string();
    let raw_text = original
        .get("rawText")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if raw_text.chars().count() < 60 {
        return Err("这张卡不足 60 字，不需要重拆".to_string());
    }
    let created_at = original.get("createdAt").and_then(Value::as_u64).unwrap_or(now);

    // 阶段 2（无锁）：AI 拆分。任何失败都不动原卡。
    let (provider, model) = app
        .and_then(|app| ai::default_provider(app).ok().flatten())
        .ok_or_else(|| "还没有默认 AI Provider，请在 设置 → AI 中配置".to_string())?;
    if let Some(app) = app {
        ai::log_provider_event(app, format!("resplitting card {card_id} with {model}"));
    }
    let messages = ai::build_split_messages(&phase, &raw_text);
    let content = ai::chat_completion_with_retry(&provider, &model, &messages)
        .await
        .map_err(|err| format!("这张卡拆不开：{err}"))?;
    let splits = ai::parse_card_splits(&content, &raw_text)
        .map_err(|_| "这张卡拆不开：AI 拆分未通过逐字/覆盖率校验，原卡未改动".to_string())?;
    if splits.len() <= 1 {
        return Err("AI 认为这张卡是一段完整记录，拆不出多张".to_string());
    }

    // 阶段 3（短锁）：重读原卡确认未被并发改动，然后替换
    let conn = db.conn()?;
    let current = db::read_record_by_id(&conn, "caseCards", card_id)?
        .ok_or_else(|| "这张卡已被删除，已取消重拆".to_string())?;
    let current_text = current
        .get("rawText")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    if current_text != raw_text {
        return Err("这张卡刚被编辑过，已取消重拆；请重新发起".to_string());
    }
    let rid = format!("rs-{}", ai::next_task_id());
    let created = persist_resplit(&conn, &current, splits, &rid, created_at)?;
    if let Some(app) = app {
        ai::log_provider_event(app, format!("card {card_id} resplit into {} cards", created.len()));
    }
    Ok((case_id, created))
}

/// 替换落库：软删原卡（附件随删，同删除语义）→ 建新卡（createdAt 逐张 +1ms 保持原
/// 位置，entryDecision 仅首张继承）→ 剔除 Case 上指向原卡的动作/标签建议（证据卡
/// 没了，与前端删卡同一规则）。
fn persist_resplit(
    conn: &rusqlite::Connection,
    original: &Value,
    mut splits: Vec<ai::ParsedCardSplit>,
    rid: &str,
    created_at: u64,
) -> Result<Vec<Value>, String> {
    let card_id = original.get("id").and_then(Value::as_str).unwrap_or_default();
    let case_id = original.get("caseId").and_then(Value::as_str).unwrap_or_default();
    let phase = original.get("phase").and_then(Value::as_str).unwrap_or("intermediate");
    let entry_decision = original.get("entryDecision").and_then(Value::as_str);
    db::soft_delete_case_card(conn, card_id)?;

    // 首段无锚点时继承原卡 barRef：拆分不改变「这段话开始于哪根 K 线」
    if splits[0].bar_ref.is_none() {
        if let Some(bar) = original.get("barRef").and_then(Value::as_u64) {
            splits[0].bar_ref = Some(bar as i64);
        }
    }

    let mut created: Vec<Value> = Vec::new();
    for (index, split) in splits.iter().enumerate() {
        let id = format!("{rid}-{index}");
        let mut data = json!({
            "id": id,
            "caseId": case_id,
            "phase": phase,
            "rawText": split.text,
            "createdAt": created_at + index as u64,
        });
        if let Some(bar) = split.bar_ref {
            data["barRef"] = json!(bar);
        }
        if index == 0 {
            if let Some(decision) = entry_decision {
                data["entryDecision"] = json!(decision);
            }
        }
        db::save_record_in_tx(conn, "caseCards", &id, data.clone())?;
        created.push(data);
    }

    if let Some(mut case_record) = db::read_record_by_id(conn, "cases", case_id)? {
        let mut changed = false;
        for key in ["aiExecutionSuggestions", "aiTagSuggestions"] {
            let Some(suggestions) = case_record
                .get(key)
                .and_then(|value| value.get("suggestions"))
                .and_then(Value::as_array)
                .cloned()
            else {
                continue;
            };
            let filtered: Vec<Value> = suggestions
                .into_iter()
                .filter(|item| item.get("cardId").and_then(Value::as_str) != Some(card_id))
                .collect();
            if let Some(blob) = case_record.get_mut(key) {
                blob["suggestions"] = json!(filtered);
                changed = true;
            }
        }
        if changed {
            db::save_record_in_tx(conn, "cases", case_id, case_record)?;
        }
    }
    Ok(created)
}

/// AI 重拆已有卡片（GUI）：成功后逐张 spawn 自动分析。任务注册在前端（GUI 任务模式），
/// 结果卡由前端吸收合并，后续 data-changed 事件兜底。
#[tauri::command]
async fn resplit_case_card(
    app: AppHandle,
    db: tauri::State<'_, db::Db>,
    card_id: String,
) -> Result<Value, String> {
    let now = now_ms();
    let (case_id, cards) = run_card_resplit(Some(&app), &db, &card_id, now).await?;
    for card in &cards {
        if let Some(id) = card.get("id").and_then(Value::as_str) {
            ai::spawn_auto_analysis(&app, id.to_string());
        }
    }
    Ok(json!({ "caseId": case_id, "cards": cards }))
}

/// REST 批量拆卡入口（由 api server 循环分发；不进 handle_request 路由表——
/// 它需要 AppHandle 走 AI，而 handle_request 保持无 GUI 依赖、测试二进制可链接）。
/// 阻塞调用 AI（90s 超时上限；本地 API 单线程，拆分期间其他请求排队——浮窗是
/// 唯一客户端且本来就在等这次提交）。成功后逐张 spawn 自动分析。
pub(crate) fn batch_split_endpoint(
    app: &AppHandle,
    db: &db::Db,
    url: &str,
    auth: Option<&str>,
    token: &str,
    body: &[u8],
    now: u64,
) -> api::ApiOutcome {
    if !api::authorized(token, auth) {
        return api::ApiOutcome { status: 401, body: json!("missing or invalid bearer token"), data_changed: false };
    }
    let parsed: Value = match serde_json::from_slice(body) {
        Ok(value) => value,
        Err(_) => return api::ApiOutcome { status: 400, body: json!("invalid JSON body"), data_changed: false },
    };
    let path = url.split('?').next().unwrap_or("").trim_matches('/');
    // api/v1/cases/{caseId}/cards/batch-split
    let case_id = path.split('/').nth(3).unwrap_or_default().to_string();
    let split_task_id = ai::next_task_id();
    ai::emit_task_event(app, &split_task_id, "split", "start", "批量拆卡", Some("case"), Some(&case_id), None);
    let run = || -> Result<(Vec<Value>, bool), String> {
        let phase = parsed.get("phase").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
            .ok_or_else(|| "request body is missing valid phase".to_string())?.to_string();
        let raw_text = parsed.get("rawText").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
            .ok_or_else(|| "request body is missing valid rawText".to_string())?.to_string();
        let client_request_id = parsed.get("clientRequestId").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
            .ok_or_else(|| "request body is missing valid clientRequestId".to_string())?.to_string();
        let entry_decision = parsed.get("entryDecision").and_then(Value::as_str).map(str::to_string);
        tauri::async_runtime::block_on(run_batch_split(
            Some(app),
            db,
            &case_id,
            &phase,
            &raw_text,
            entry_decision,
            &client_request_id,
            now,
        ))
    };
    match run() {
        Ok((cards, changed)) => {
            ai::emit_task_event(app, &split_task_id, "split", "succeeded", "批量拆卡", Some("case"), Some(&case_id), None);
            if changed {
                for card in &cards {
                    if let Some(id) = card.get("id").and_then(Value::as_str) {
                        ai::spawn_auto_analysis(app, id.to_string());
                    }
                }
            }
            api::ApiOutcome { status: 200, body: json!({ "cards": cards, "version": ai::SPLIT_PROMPT_VERSION }), data_changed: changed }
        }
        Err(message) => {
            ai::emit_task_event(app, &split_task_id, "split", "failed", "批量拆卡", Some("case"), Some(&case_id), Some(&message));
            let status = api::error_status(&message);
            api::ApiOutcome { status, body: json!({ "error": message }), data_changed: false }
        }
    }
}

#[derive(Serialize)]
struct SavedAttachmentFile {
    file_name: String,
    relative_path: String,
    mime_type: String,
}

#[tauri::command]
fn save_attachment_file(
    app: AppHandle,
    owner_type: String,
    owner_id: String,
    kind: String,
    attachment_id: String,
    file_name: String,
    content_data_url: String,
) -> Result<SavedAttachmentFile, String> {
    let (mime_type, content_base64) = split_data_url(&content_data_url)?;
    let bytes = general_purpose::STANDARD
        .decode(content_base64)
        .map_err(|err| err.to_string())?;
    let ext = file_extension(&file_name)
        .or_else(|| extension_for_mime(&mime_type).map(str::to_string))
        .unwrap_or_else(|| "bin".to_string());
    let safe_name = format!("{}.{}", sanitize_file_part(&attachment_id), sanitize_file_part(&ext));
    let relative_path = format!(
        "attachments/{}/{}/{}/{}",
        sanitize_file_part(&owner_type),
        sanitize_file_part(&owner_id),
        sanitize_file_part(&kind),
        safe_name
    );
    let full_path = paths::app_data_dir(&app)?.join(&relative_path);
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(&full_path, bytes).map_err(|err| err.to_string())?;

    Ok(SavedAttachmentFile {
        file_name: if file_name.trim().is_empty() {
            safe_name
        } else {
            file_name
        },
        relative_path: relative_path.replace('\\', "/"),
        mime_type,
    })
}

#[tauri::command]
fn read_attachment_file(app: AppHandle, relative_path: String) -> Result<String, String> {
    ensure_safe_relative_path(&relative_path)?;
    let base = paths::app_data_dir(&app)?;
    let path = base.join(&relative_path);
    let canonical_base = base.canonicalize().map_err(|err| err.to_string())?;
    let canonical_path = path.canonicalize().map_err(|err| err.to_string())?;
    if !canonical_path.starts_with(canonical_base) {
        return Err("attachment path escapes app data dir".to_string());
    }
    let bytes = fs::read(&canonical_path).map_err(|err| err.to_string())?;
    let mime = mime_for_path(&canonical_path);
    Ok(format!(
        "data:{mime};base64,{}",
        general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
fn save_chart_source_file(
    app: AppHandle,
    file_name: String,
    content_base64: String,
    symbol_label: String,
    timeframe: String,
    start_utc: String,
    end_utc: String,
) -> Result<String, String> {
    let bytes = general_purpose::STANDARD
        .decode(content_base64)
        .map_err(|err| err.to_string())?;
    let dir = paths::app_data_dir(&app)?.join("attachments").join("chart-data");
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;

    let ext = file_name
        .rsplit_once('.')
        .map(|(_, ext)| sanitize_file_part(ext))
        .filter(|ext| !ext.is_empty())
        .unwrap_or_else(|| "csv".to_string());
    let stem = format!(
        "{}-{}-{}-{}-{}.{}",
        sanitize_file_part(&symbol_label),
        sanitize_file_part(&timeframe),
        sanitize_file_part(&start_utc),
        sanitize_file_part(&end_utc),
        chrono::Local::now().timestamp_millis(),
        ext
    );
    let path = dir.join(stem);
    fs::write(&path, bytes).map_err(|err| err.to_string())?;
    path.strip_prefix(paths::app_data_dir(&app)?)
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .map_err(|err| err.to_string())
}

pub fn run() {
    diagnostics::install_panic_hook();
    diagnostics::write_temp("Cairn process starting");

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            diagnostics::app_log(app.handle(), "setup started");
            let db = db::init(app.handle()).map_err(|err| {
                diagnostics::app_log(app.handle(), format!("db init failed: {err}"));
                err
            })?;
            diagnostics::app_log(app.handle(), "db init ok");
            app.manage(db);
            setup_tray(app).map_err(|err| {
                diagnostics::app_log(app.handle(), format!("tray setup failed: {err}"));
                err
            })?;
            diagnostics::app_log(app.handle(), "tray setup ok");
            app.manage(api::init_state(app.handle()));
            api::start_server(app.handle().clone());
            ai::refresh_proxy(app.handle());
            diagnostics::app_log(app.handle(), "local api server thread spawned");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    diagnostics::app_log(window.app_handle(), "main window close requested; hiding to tray");
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_ready,
            get_app_version,
            load_state,
            save_record,
            save_records,
            delete_record,
            replace_collection,
            restore_state,
            export_backup,
            frontend_log,
            read_logs,
            get_log_path,
            get_api_status,
            get_widget_script,
            check_widget_script_update,
            regenerate_api_token,
            set_api_config,
            list_ai_providers,
            save_ai_provider,
            delete_ai_provider,
            set_default_ai_provider,
            fetch_ai_models,
            analyze_case_card,
            resplit_case_card,
            suggest_case_executions,
            ai_summarize_case,
            ai_suggest_bindings,
            draft_case_title,
            get_ai_settings,
            save_ai_settings,
            get_network_settings,
            save_network_settings,
            default_ai_concurrency,
            save_attachment_file,
            read_attachment_file,
            save_chart_source_file
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Cairn");
}

fn sanitize_file_part(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn split_data_url(value: &str) -> Result<(String, &str), String> {
    let (meta, data) = value
        .split_once(',')
        .ok_or_else(|| "invalid data url".to_string())?;
    if !meta.starts_with("data:") || !meta.ends_with(";base64") {
        return Err("attachment content must be a base64 data url".to_string());
    }
    let mime = meta
        .trim_start_matches("data:")
        .trim_end_matches(";base64")
        .trim();
    if !mime.starts_with("image/") {
        return Err("only image attachments are supported".to_string());
    }
    Ok((mime.to_string(), data))
}

fn file_extension(file_name: &str) -> Option<String> {
    file_name
        .rsplit_once('.')
        .map(|(_, ext)| sanitize_file_part(ext))
        .filter(|ext| !ext.is_empty())
}

fn extension_for_mime(mime: &str) -> Option<&'static str> {
    match mime {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/svg+xml" => Some("svg"),
        _ => None,
    }
}

fn mime_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn ensure_safe_relative_path(value: &str) -> Result<(), String> {
    let path = Path::new(value);
    if path.is_absolute() {
        return Err("attachment path must be relative".to_string());
    }
    for component in path.components() {
        if matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_)) {
            return Err("attachment path contains unsafe components".to_string());
        }
    }
    Ok(())
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开 Cairn", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("Cairn")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    } else {
        diagnostics::app_log(app.handle(), "default window icon missing for tray");
    }

    tray.build(app)?;

    Ok(())
}
