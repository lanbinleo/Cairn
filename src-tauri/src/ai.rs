// AI Provider 配置：OpenAI compatible 端点的多 provider 管理。
// 凭证属于配置而非业务数据，存 app_data_dir/ai-providers.json，不进入备份。
// chat_completion 为薄 reqwest 层：请求/响应完全可记录，便于派生结果的溯源。

use std::{fs, path::PathBuf, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::{diagnostics, paths};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProvider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    #[serde(default)]
    pub is_default: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn providers_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(paths::app_data_dir(app)?.join("ai-providers.json"))
}

#[derive(Serialize, Deserialize, Default)]
struct ProviderFile {
    #[serde(default)]
    providers: Vec<AiProvider>,
}

fn read_file(app: &AppHandle) -> Result<ProviderFile, String> {
    let path = providers_path(app)?;
    if !path.exists() {
        return Ok(ProviderFile::default());
    }
    let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    serde_json::from_str(&content).map_err(|err| err.to_string())
}

fn write_file(app: &AppHandle, file: &ProviderFile) -> Result<(), String> {
    let path = providers_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let content = serde_json::to_string_pretty(&file).map_err(|err| err.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|err| err.to_string())?;
    fs::rename(&tmp, &path).map_err(|err| err.to_string())?;
    Ok(())
}

fn normalize(mut provider: AiProvider) -> Result<AiProvider, String> {
    provider.name = provider.name.trim().to_string();
    provider.base_url = provider.base_url.trim().trim_end_matches('/').to_string();
    provider.api_key = provider.api_key.trim().to_string();
    if provider.name.is_empty() {
        return Err("provider name is missing".to_string());
    }
    if !provider.base_url.starts_with("http://") && !provider.base_url.starts_with("https://") {
        return Err("provider base url must start with http:// or https://".to_string());
    }
    Ok(provider)
}

pub fn list(app: &AppHandle) -> Result<Vec<AiProvider>, String> {
    Ok(read_file(app)?.providers)
}

pub fn save(app: &AppHandle, mut provider: AiProvider) -> Result<Vec<AiProvider>, String> {
    provider = normalize(provider)?;
    let mut file = read_file(app)?;
    let now = now_ms();
    match file.providers.iter().position(|item| item.id == provider.id) {
        Some(index) => {
            provider.created_at = file.providers[index].created_at;
            provider.updated_at = now;
            file.providers[index] = provider;
        }
        None => {
            if provider.id.trim().is_empty() {
                provider.id = format!("ai-{:x}-{:x}", now, file.providers.len() + 1);
            }
            provider.created_at = now;
            provider.updated_at = now;
            file.providers.push(provider);
        }
    }
    if file.providers.iter().filter(|item| item.is_default).count() != 1 {
        let has_default = file.providers.iter().any(|item| item.is_default);
        if let Some(first) = file.providers.first_mut() {
            first.is_default = !has_default;
        }
    }
    write_file(app, &file)?;
    Ok(file.providers)
}

pub fn delete(app: &AppHandle, id: String) -> Result<Vec<AiProvider>, String> {
    let mut file = read_file(app)?;
    let had_default = file.providers.iter().any(|item| item.id == id && item.is_default);
    file.providers.retain(|item| item.id != id);
    if had_default {
        if let Some(first) = file.providers.first_mut() {
            first.is_default = true;
        }
    }
    write_file(app, &file)?;
    Ok(file.providers)
}

/// GET {base_url}/models，OpenAI compatible 列表格式。
/// 拉到模型列表即代表连通且 key 有效，可兼作连接测试。
pub async fn fetch_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let base = base_url.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return Err("provider base url is missing".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|err| err.to_string())?;
    let mut request = client.get(format!("{base}/models"));
    if !api_key.trim().is_empty() {
        request = request.bearer_auth(api_key.trim());
    }
    let response = request
        .send()
        .await
        .map_err(|err| format!("request failed: {err}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("read response failed: {err}"))?;
    if !status.is_success() {
        let snippet: String = body.chars().take(300).collect();
        return Err(format!("provider returned {status}: {snippet}"));
    }
    let parsed: Value = serde_json::from_str(&body).map_err(|err| format!("invalid response: {err}"))?;
    let mut models: Vec<String> = parsed
        .get("data")
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(serde_json::Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if models.is_empty() {
        return Err("provider returned no models".to_string());
    }
    models.sort();
    Ok(models)
}

pub fn log_provider_event(app: &AppHandle, message: String) {
    diagnostics::app_log(app, format!("ai: {message}"));
}

// ==================== Chat Completion ====================

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

impl ChatMessage {
    fn system(content: impl Into<String>) -> Self {
        Self { role: "system".into(), content: content.into() }
    }
    pub fn user(content: impl Into<String>) -> Self {
        Self { role: "user".into(), content: content.into() }
    }
}

/// POST {base_url}/chat/completions，返回 choices[0].message.content。
/// 不使用 response_format 参数以兼容更多 provider（含 Ollama / 各家兼容端点），
/// JSON 输出靠 prompt 约束 + 解析端防御。
pub async fn chat_completion(
    provider: &AiProvider,
    model: &str,
    messages: &[ChatMessage],
) -> Result<String, String> {
    let url = format!("{}/chat/completions", provider.base_url);
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Content-Type", "application/json".parse().unwrap());
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|err| err.to_string())?;
    let mut request = client.post(&url).json(&json!({
        "model": model,
        "messages": messages,
        "temperature": 0,
        "stream": false,
    }));
    if !provider.api_key.is_empty() {
        request = request.bearer_auth(&provider.api_key);
    }
    let response = request
        .send()
        .await
        .map_err(|err| format!("request failed: {err}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("read response failed: {err}"))?;
    if !status.is_success() {
        let snippet: String = body.chars().take(300).collect();
        return Err(format!("provider returned {status}: {snippet}"));
    }
    let parsed: Value = serde_json::from_str(&body)
        .map_err(|err| format!("invalid response: {err}"))?;
    let content = parsed
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .ok_or_else(|| "response has no message content".to_string())?
        .to_string();
    if content.trim().is_empty() {
        return Err("provider returned empty content".to_string());
    }
    Ok(content)
}

pub fn default_provider(app: &AppHandle) -> Result<Option<(AiProvider, String)>, String> {
    let providers = list(app)?;
    let provider = providers
        .iter()
        .find(|item| item.is_default)
        .or_else(|| providers.first())
        .cloned();
    match provider {
        None => Ok(None),
        Some(provider) => {
            let model = provider
                .default_model
                .clone()
                .ok_or_else(|| format!("provider {} 未设置默认模型", provider.name))?;
            Ok(Some((provider, model)))
        }
    }
}

// ==================== 请求重试 ====================

/// 网络类失败（发送失败/超时/5xx/空回复）自动重试一次，最多一次；
/// 配置与解析类错误（4xx、响应结构异常）直接返回，不浪费一次调用。
pub async fn chat_completion_with_retry(
    provider: &AiProvider,
    model: &str,
    messages: &[ChatMessage],
) -> Result<String, String> {
    match chat_completion(provider, model, messages).await {
        Ok(content) => Ok(content),
        Err(first) if is_retryable_error(&first) => {
            chat_completion(provider, model, messages).await
                .map_err(|second| format!("{first}；重试一次后仍失败：{second}"))
        }
        Err(first) => Err(first),
    }
}

fn is_retryable_error(message: &str) -> bool {
    message.starts_with("request failed")
        || message.starts_with("read response failed")
        || message.starts_with("provider returned 5")
        || message.starts_with("provider returned empty content")
}

// ==================== AI 通用设置 ====================

/// 自动整理等行为开关，存 app_data_dir/ai-settings.json，不进入备份。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    /// 新 Card（浮窗/REST）提交后自动后台识别；失败重试一次后静默记日志
    #[serde(default = "default_true")]
    pub auto_analyze: bool,
    /// 绑定建立后自动跑持仓管理补录建议、导入后自动跑关联推荐（0.3.0）
    #[serde(default = "default_true")]
    pub auto_suggest: bool,
    /// Trade 关闭时自动生成整单总结（0.3.0）
    #[serde(default = "default_true")]
    pub auto_summary: bool,
}

fn default_true() -> bool {
    true
}

impl Default for AiSettings {
    fn default() -> Self {
        Self { auto_analyze: true, auto_suggest: true, auto_summary: true }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(paths::app_data_dir(app)?.join("ai-settings.json"))
}

pub fn settings(app: &AppHandle) -> AiSettings {
    let Ok(path) = settings_path(app) else {
        return AiSettings::default();
    };
    let Ok(content) = fs::read_to_string(&path) else {
        return AiSettings::default();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

pub fn save_settings(app: &AppHandle, value: AiSettings) -> Result<AiSettings, String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let content = serde_json::to_string_pretty(&value).map_err(|err| err.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|err| err.to_string())?;
    fs::rename(&tmp, &path).map_err(|err| err.to_string())?;
    Ok(value)
}

/// 浮窗/REST 新建 Card 后的后台自动整理入口：开关关闭时跳过；
/// 完成后 emit data-changed 让前端刷新，失败只记日志不打扰录制。
/// 用户已手动修正过派生数据（userAdjusted）时放弃写回，避免覆盖。
pub fn spawn_auto_analysis(app: &AppHandle, card_id: String) {
    if !settings(app).auto_analyze {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let db = app.state::<crate::db::Db>();
        let result =
            tauri::async_runtime::block_on(crate::run_card_analysis(&app, &db, &card_id, None, false));
        match result {
            Ok(Some(card)) => {
                let _ = app.emit(crate::api::DATA_CHANGED_EVENT, &card);
            }
            Ok(None) => {}
            Err(err) => {
                diagnostics::app_log(&app, format!("auto analysis failed for card {card_id}: {err}"));
            }
        }
    });
}

/// 绑定建立后的后台建议检查入口：开关关闭时跳过；完成后 emit data-changed，
/// 失败只记日志。前端 UI 建立绑定走 Tauri 命令自行触发，这里只服务 REST 路径。
pub fn spawn_auto_suggestions(app: &AppHandle, case_id: String) {
    if !settings(app).auto_suggest {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let db = app.state::<crate::db::Db>();
        let result =
            tauri::async_runtime::block_on(crate::run_execution_suggestions(&app, &db, &case_id));
        match result {
            Ok(case) => {
                let _ = app.emit(crate::api::DATA_CHANGED_EVENT, &case);
            }
            Err(err) => {
                diagnostics::app_log(&app, format!("auto suggestions failed for case {case_id}: {err}"));
            }
        }
    });
}

// ==================== CaseCard 结构化提取 ====================

pub const PROMPT_VERSION: &str = "0.3.0-prompt-3";
pub const ANALYSIS_SCHEMA_VERSION: &str = "0.3.0-schema-3";

pub const LABEL_TYPES: [&str; 11] = [
    "market-context",
    "setup-condition",
    "observed-pattern",
    "inference",
    "entry-plan",
    "invalidation",
    "risk-plan",
    "position-management",
    "action",
    "emotion",
    "reflection",
];

pub const MEMO_FIELDS: [&str; 7] = [
    "direction",
    "entryPrice",
    "stopLoss",
    "target",
    "confidence",
    "invalidation",
    "rejectedAlternatives",
];

const PHASE_LABELS: [(&str, &str); 5] = [
    ("pre-entry", "观察"),
    ("entry", "入场"),
    ("intermediate", "过程"),
    ("closing", "离场"),
    ("reflection", "复盘"),
];

fn phase_label(phase: &str) -> String {
    PHASE_LABELS
        .iter()
        .find(|(key, _)| *key == phase)
        .map(|(_, label)| label.to_string())
        .unwrap_or_else(|| phase.to_string())
}

/// context 为空字符串表示无背景资料。背景资料由 lib.rs 组装（品种/绑定交易/前情卡片），
/// 只用于辅助理解；quote 与 digest 的信息边界在系统提示中硬性约束。
pub fn build_analysis_messages(phase: &str, raw_text: &str, context: &str) -> Vec<ChatMessage> {
    let system = "你是一份交易日志的整理秘书。交易者在盘中用口语随手记录了一张卡片，你把它整理成结构化 JSON 供后续复盘使用。你绝不改写、总结或润色原文。

硬性规则：
- 只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字。
- 所有 quote 字段必须逐字复制本卡原文片段（一字不差，可以截短但不许改字）。原文中没有的信息一律填 null，不许推断补写。
- 用户消息可能附带「背景资料」（品种、绑定交易的成交记录、同 Case 前几张卡），它们只用于辅助理解，不是本卡内容：quote 一律来自本卡原文；digest 里不得出现只有背景资料才有的信息。
- 标签 type 只能从给定清单中选择。

输出字段：
- digest：不超过 30 个字的一句话，概括这张卡在讲什么（观察/动作/计划/情绪/复盘），供列表快速浏览。保留最有信息量的一个点，忽略语气词和语音识别噪音。
- barRef：本卡陈述时刻的 K 线序号，{\"bar\": <正整数>, \"quote\": <原文>}。如 BAR41、bar #38、第 42 根 K 线、开头裸数字（「89，价格…」）。开头通常就是陈述时刻；对更早 K 线的回顾性引用不算锚点。没有则 null。
- labels：按原文出现顺序为关键片段打标签，数组每项 {\"type\": \"...\", \"quote\": \"<原文片段>\"}。type 清单：
  market-context=市场背景；setup-condition=形态成立条件；observed-pattern=观察到的结构或价格行为；inference=推断与预期；entry-plan=入场计划；invalidation=失效条件；risk-plan=止损目标与风险计划；position-management=持仓管理（加减仓、移动止损、离场计划）；action=已发生的动作；emotion=情绪；reflection=复盘与自我评价
- memo：仅当阶段为「入场」时输出，其余阶段必须为 null。八字段每项为 {\"value\": ..., \"quote\": <原文>} 或 null：
  - direction：做多为 \"long\"，做空为 \"short\"
  - entryPrice：计划入场价或入场触发方式。原文给出明确价格时 value 用纯数字字符串（如 \"90360\"）；否则保留口语描述（如 \"突破 90830 追入\"）。K 线序号、盈亏倍数、仓位百分比不是价格，不要写成数字。
  - stopLoss：止损价或止损位置，价格写法规则同 entryPrice
  - target：目标位或预期路径，价格写法规则同 entryPrice
  - confidence：信心百分比 0-100 的数字（口语\"七成\"=70；原文没有明确数字则 null）
  - invalidation：什么情况说明这笔判断错了（字符串）
  - rejectedAlternatives：考虑过但放弃的其他方案（字符串）
  - emotion：可选，情绪词（字符串）

输出示例（阶段为入场时）：
{\"digest\":\"第三次测试区间上沿失败，决定做空\",\"barRef\":{\"bar\":38,\"quote\":\"BAR38\"},\"labels\":[{\"type\":\"observed-pattern\",\"quote\":\"第三次测试区间上沿失败收回\"},{\"type\":\"risk-plan\",\"quote\":\"止损放在区间上沿上方\"}],\"memo\":{\"direction\":{\"value\":\"short\",\"quote\":\"我做空\"},\"entryPrice\":{\"value\":\"41600\",\"quote\":\"41600 下方追入\"},\"stopLoss\":{\"value\":\"41750\",\"quote\":\"止损放在区间上沿上方\"},\"target\":null,\"confidence\":{\"value\":70,\"quote\":\"胜率我给七成\"},\"invalidation\":null,\"rejectedAlternatives\":null,\"emotion\":null}}";
    let mut user = String::new();
    if !context.trim().is_empty() {
        user.push_str(context.trim_end());
        user.push_str("\n\n");
    }
    user.push_str(&format!(
        "阶段：{}（{}）\n原文：\n{}",
        phase_label(phase),
        phase,
        raw_text
    ));
    vec![ChatMessage::system(system), ChatMessage::user(user)]
}

/// 从模型输出中剥掉 markdown 代码块，截取最外层 JSON 对象。
fn extract_json_object(content: &str) -> &str {
    let trimmed = content.trim();
    let unfenced = if let Some(start) = trimmed.find("```") {
        let after = &trimmed[start..];
        let body_start = after
            .find('\n')
            .map(|idx| idx + 1)
            .unwrap_or(after.len());
        let body_end = after.rfind("```").unwrap_or(after.len());
        after[body_start..body_end.max(body_start)].trim()
    } else {
        trimmed
    };
    match (unfenced.find('{'), unfenced.rfind('}')) {
        (Some(start), Some(end)) if end > start => &unfenced[start..=end],
        _ => unfenced,
    }
}

/// quote 是原文的逐字子串时才保留；否则丢弃 quote 但保留 value。
fn quote_if_verbatim(field: &mut Value, raw_text: &str) {
    if let Some(quote) = field.get("quote").and_then(Value::as_str) {
        if !raw_text.contains(quote) {
            if let Value::Object(map) = field {
                map.remove("quote");
            }
        }
    }
}

fn normalize_memo_value(key: &str, field: &mut Value) -> bool {
    let value = match field.get("value") {
        Some(Value::String(text)) => Some(text.clone()),
        Some(Value::Number(number)) => Some(number.to_string()),
        _ => None,
    };
    let Some(value) = value else { return false };
    match key {
        "direction" => {
            let normalized = if value.contains('空') || value.to_lowercase().contains("short") {
                "short"
            } else if value.contains('多') || value.to_lowercase().contains("long") {
                "long"
            } else {
                return false;
            };
            field["value"] = json!(normalized);
            true
        }
        "confidence" => {
            let parsed = value.trim().trim_end_matches('%');
            let Ok(number) = parsed.parse::<f64>() else { return false };
            if !(0.0..=100.0).contains(&number) {
                return false;
            }
            field["value"] = json!(number.round() as i64);
            true
        }
        _ => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return false;
            }
            field["value"] = json!(trimmed);
            true
        }
    }
}

/// 校验并规范化模型输出。不可信的部分（未知标签、非逐字 quote、非法数值）被丢弃，
/// missingFields 在此机械推导而非信任模型自评。
pub fn parse_analysis(
    phase: &str,
    raw_text: &str,
    content: &str,
    model: &str,
    provider_id: &str,
    now: u64,
) -> Result<Value, String> {
    let json_text = extract_json_object(content);
    let parsed: Value =
        serde_json::from_str(json_text).map_err(|err| format!("model output is not JSON: {err}"))?;

    // digest 是提炼句而非原文引用，不做逐字校验；只做非空与长度防御。
    let digest = parsed
        .get("digest")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| text.chars().take(40).collect::<String>());

    let bar_ref = match parsed.get("barRef") {
        Some(Value::Object(map)) => {
            let bar = map.get("bar").and_then(Value::as_i64).filter(|bar| *bar >= 1);
            match bar {
                Some(bar) => {
                    let quote = map
                        .get("quote")
                        .and_then(Value::as_str)
                        .filter(|quote| raw_text.contains(*quote));
                    let mut value = json!({ "bar": bar });
                    if let Some(quote) = quote {
                        value["quote"] = json!(quote);
                    }
                    Some(value)
                }
                None => None,
            }
        }
        _ => None,
    };

    let mut labels: Vec<Value> = Vec::new();
    if let Some(items) = parsed.get("labels").and_then(Value::as_array) {
        for item in items {
            let Some(item_type) = item.get("type").and_then(Value::as_str) else {
                continue;
            };
            if !LABEL_TYPES.contains(&item_type) {
                continue;
            }
            let Some(quote) = item.get("quote").and_then(Value::as_str) else {
                continue;
            };
            if !raw_text.contains(quote) || quote.trim().is_empty() {
                continue;
            }
            let entry = json!({ "type": item_type, "quote": quote });
            if !labels.contains(&entry) {
                labels.push(entry);
            }
        }
    }

    let mut memo: Option<Value> = None;
    let mut missing_fields: Vec<String> = Vec::new();
    if phase == "entry" {
        let mut normalized = serde_json::Map::new();
        let source = parsed
            .get("memo")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        for key in MEMO_FIELDS.iter().chain(std::iter::once(&"emotion")) {
            let mut field = match source.get(*key) {
                Some(field @ Value::Object(_)) => field.clone(),
                _ => {
                    if *key != "emotion" {
                        missing_fields.push(key.to_string());
                    }
                    continue;
                }
            };
            if !normalize_memo_value(key, &mut field) {
                if *key != "emotion" {
                    missing_fields.push(key.to_string());
                }
                continue;
            }
            quote_if_verbatim(&mut field, raw_text);
            normalized.insert(key.to_string(), field);
        }
        memo = Some(Value::Object(normalized));
    }

    Ok(json!({
        "schemaVersion": ANALYSIS_SCHEMA_VERSION,
        "promptVersion": PROMPT_VERSION,
        "model": model,
        "providerId": provider_id,
        "analyzedAt": now,
        "digest": digest,
        "barRef": bar_ref,
        "labels": labels,
        "memo": memo,
        "missingFields": missing_fields,
    }))
}

// ==================== 持仓管理动作补录建议 ====================

pub const SUGGESTION_PROMPT_VERSION: &str = "0.3.0-suggest-1";

/// 建议只覆盖管理类动作（编辑器规范集：stop / target-moved / order-edit）。
/// 开仓、加仓、减仓、平仓以交易所导入的成交为准，AI 一律不碰。
pub const SUGGESTION_ACTIONS: [&str; 3] = ["stop", "target-moved", "order-edit"];

pub fn build_suggestion_messages(context: &str) -> Vec<ChatMessage> {
    let system = "你是交易日志的持仓管理核对员。交易者在一个 Case 里用口语记录了全过程，这个 Case 绑定了一笔 Trade（成交记录来自交易所导出）。你的任务：找出「交易者明确说过要做、但成交记录里没有对应落库」的持仓管理动作，作为补录建议。

只关注管理类动作：移动/设置止损、移动/设置止盈、修改挂单价格、撤销挂单。开仓、加仓、减仓、平仓一律不管（成交以交易所记录为准）。

判定规则：
- 只提取「明确说了价格或明确位置」且语气是「已经决定 / 已经发生」的动作（如 我决定、我把、挪到、改到、挂到、撤掉）。
- 明确的否定不提取（如 不适合移动止盈止损、不向下移动也不向上移动、保持不变）；纯假设不提取（如 如果…就…）。
- 每条建议必须给出当时原话 quote（逐字复制、一字不差）和来源卡片编号 cardIndex（用户消息里每张卡开头的编号）。
- 已落库动作里已有同类且价格基本相同的动作、或与初始止损/止盈价相同的，不要建议（视为已覆盖）。
- price 是明确的数字价格；只说了位置没说价格（如 挪到成本线下方）时 price 为 null，并在 anchorText 里写位置描述。信息不足的动作宁可不建议。

只输出一个 JSON 对象，不要 markdown 代码块和解释：
{\"suggestions\":[{\"cardIndex\":<卡片编号>,\"action\":\"stop|target|order-edit\",\"price\":<数字或null>,\"anchorText\":\"<位置描述或null>\",\"orderType\":\"stop-loss|take-profit|limit 或null\",\"signal\":\"<不超过12字的简短理由>\",\"quote\":\"<逐字原话>\"}]}
没有可建议的就输出 {\"suggestions\":[]}。";
    vec![ChatMessage::system(system), ChatMessage::user(context.to_string())]
}

/// 单条建议的规范化结果（尚未与既有 Execution 去重，去重在 lib.rs 做机械比对）。
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedSuggestion {
    pub card_id: String,
    pub action: String,
    pub order_type: String,
    pub price: Option<f64>,
    pub anchor_text: Option<String>,
    pub signal: Option<String>,
    pub quote: String,
}

/// 校验并规范化模型输出：quote 逐字来自对应卡片原文、action/orderType 白名单、
/// price 必须是正的有限数、cardIndex 必须落在卡片清单内。不可信的一律丢弃。
pub fn parse_execution_suggestions(
    content: &str,
    cards: &[(String, String)],
) -> Result<Vec<ParsedSuggestion>, String> {
    let json_text = extract_json_object(content);
    let parsed: Value =
        serde_json::from_str(json_text).map_err(|err| format!("model output is not JSON: {err}"))?;
    let empty: Vec<Value> = Vec::new();
    let items = parsed
        .get("suggestions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or(empty);

    let mut out: Vec<ParsedSuggestion> = Vec::new();
    for item in items {
        let index = match item.get("cardIndex").and_then(Value::as_i64) {
            Some(index) if index >= 1 && (index as usize) <= cards.len() => index as usize - 1,
            _ => continue,
        };
        let (card_id, raw_text) = &cards[index];
        let Some(quote) = item
            .get("quote")
            .and_then(Value::as_str)
            .filter(|quote| !quote.trim().is_empty() && raw_text.contains(quote))
        else {
            continue;
        };
        let action = match item.get("action").and_then(Value::as_str) {
            Some("stop") => "stop",
            Some("target") => "target-moved",
            Some("order-edit") => "order-edit",
            _ => continue,
        };
        let price = item
            .get("price")
            .and_then(Value::as_f64)
            .filter(|price| price.is_finite() && *price > 0.0);
        let anchor_text = item
            .get("anchorText")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(|text| text.chars().take(40).collect::<String>());
        // 没有价格也没有位置描述的建议无法落地，丢弃
        if price.is_none() && anchor_text.is_none() {
            continue;
        }
        let order_type = match item.get("orderType").and_then(Value::as_str) {
            Some("stop-loss") => "stop-loss",
            Some("take-profit") => "take-profit",
            Some("limit") => "limit",
            Some("stop") => "stop",
            Some("market") => "market",
            _ => match action {
                "stop" => "stop-loss",
                "target-moved" => "take-profit",
                _ => "limit",
            },
        };
        let signal = item
            .get("signal")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(|text| text.chars().take(24).collect::<String>());
        let suggestion = ParsedSuggestion {
            card_id: card_id.clone(),
            action: action.to_string(),
            order_type: order_type.to_string(),
            price,
            anchor_text,
            signal,
            quote: quote.to_string(),
        };
        if !out.contains(&suggestion) {
            out.push(suggestion);
        }
        if out.len() >= 8 {
            break;
        }
    }
    Ok(out)
}

// ==================== Case 标题代拟 ====================

pub fn build_title_messages(cards: &[(String, String)]) -> Vec<ChatMessage> {
    let system = "你是交易日志的拟题秘书。交易者在一个 Case 里按阶段记录了几段口语原文，你为这个 Case 起一个简短标题。

规则：
- 只输出 JSON：{\"title\": \"...\"}，不要 markdown 代码块和解释。
- 标题用中文，不超过 20 个字，概括这笔交易的 setup 或核心想法（品种、方向、结构），像交易者随手记的名字，例如「BTC 区间假突破做空」「ETH 突破追多被扫」。
- 原文里没有的信息不要编造；如果还没有入场想法，就概括观察对象，例如「BTC 区间上沿反复测试观察」。";
    let user = cards
        .iter()
        .map(|(phase, text)| format!("[{}] {}", phase_label(phase), text))
        .collect::<Vec<_>>()
        .join("\n");
    vec![ChatMessage::system(system), ChatMessage::user(user)]
}

pub fn parse_title(content: &str) -> Result<String, String> {
    let json_text = extract_json_object(content);
    let parsed: Value =
        serde_json::from_str(json_text).map_err(|err| format!("model output is not JSON: {err}"))?;
    let title = parsed
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .ok_or_else(|| "model output has no title".to_string())?;
    let capped: String = title.chars().take(40).collect();
    Ok(capped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retryable_errors_are_network_like() {
        assert!(is_retryable_error("request failed: connection reset"));
        assert!(is_retryable_error("read response failed: unexpected eof"));
        assert!(is_retryable_error("provider returned 502: bad gateway"));
        assert!(is_retryable_error("provider returned empty content"));
    }

    #[test]
    fn config_and_parse_errors_are_not_retried() {
        assert!(!is_retryable_error("provider returned 401: unauthorized"));
        assert!(!is_retryable_error("provider returned 400: bad request"));
        assert!(!is_retryable_error("invalid response: expected value"));
        assert!(!is_retryable_error("response has no message content"));
        assert!(!is_retryable_error("model output is not JSON: trailing chars"));
    }

    #[test]
    fn ai_settings_default_to_auto_analyze() {
        let settings = AiSettings::default();
        assert!(settings.auto_analyze);
        let parsed: AiSettings = serde_json::from_str("{}").unwrap();
        assert!(parsed.auto_analyze, "missing field falls back to default");
    }

    const RAW: &str = "BAR38 第三次测试区间上沿失败收回，我做空，止损区间上沿上方，目标区间中轨，胜率我给七成，如果重新站上 41600 我就错了，以太想做多但放弃了，有点兴奋";

    #[test]
    fn analysis_messages_carry_phase_and_raw_text() {
        let messages = build_analysis_messages("entry", RAW, "");
        assert_eq!(messages[0].role, "system");
        assert!(messages[1].content.contains("入场"));
        assert!(messages[1].content.contains(RAW));
        assert!(!messages[1].content.contains("背景资料"), "empty context adds no header");
    }

    #[test]
    fn analysis_messages_prepend_context_block() {
        let context = "背景资料（仅供理解，不是本卡内容）：\n品种：BINANCE BTCUSDT\n绑定交易：做多（持仓中）";
        let messages = build_analysis_messages("intermediate", RAW, context);
        let user = &messages[1].content;
        let context_end = user.find(context).expect("context included verbatim");
        let phase_at = user.find("阶段：").expect("phase section present");
        assert!(context_end < phase_at, "context precedes phase/raw text");
        assert!(user.contains(RAW));
    }

    #[test]
    fn parse_analysis_accepts_digest_and_truncates() {
        let long = "很".repeat(60);
        let content = format!(r#"{{"digest":"{long}","barRef":null,"labels":[]}}"#);
        let analysis = parse_analysis("pre-entry", RAW, &content, "m", "p", 1).unwrap();
        let digest = analysis["digest"].as_str().unwrap();
        assert_eq!(digest.chars().count(), 40, "digest capped at 40 chars");

        let content = r#"{"digest":"  窄震荡区间等待突破  ","barRef":null,"labels":[]}"#;
        let analysis = parse_analysis("pre-entry", RAW, content, "m", "p", 1).unwrap();
        assert_eq!(analysis["digest"], "窄震荡区间等待突破", "digest trimmed");
    }

    #[test]
    fn parse_analysis_defaults_missing_digest_to_null() {
        let content = r#"{"barRef":null,"labels":[]}"#;
        let analysis = parse_analysis("pre-entry", RAW, content, "m", "p", 1).unwrap();
        assert!(analysis["digest"].is_null());
        assert_eq!(analysis["schemaVersion"], ANALYSIS_SCHEMA_VERSION);
        assert_eq!(analysis["promptVersion"], PROMPT_VERSION);
    }

    #[test]
    fn parse_analysis_accepts_fenced_json_and_validates_fields() {
        let content = "```json\n{\"barRef\":{\"bar\":38,\"quote\":\"BAR38\"},\"labels\":[{\"type\":\"observed-pattern\",\"quote\":\"第三次测试区间上沿失败收回\"},{\"type\":\"made-up\",\"quote\":\"我做空\"},{\"type\":\"risk-plan\",\"quote\":\"模型编的话\"}],\"memo\":{\"direction\":{\"value\":\"short\",\"quote\":\"我做空\"},\"entryPrice\":{\"value\":\"41600 下方追入\",\"quote\":\"41600 下方追入\"},\"stopLoss\":{\"value\":\"区间上沿上方\",\"quote\":\"止损区间上沿上方\"},\"confidence\":{\"value\":\"70%\",\"quote\":\"胜率我给七成\"},\"target\":null}}\n```";
        let analysis =
            parse_analysis("entry", RAW, content, "test-model", "ai-test", 1).unwrap();
        assert!(analysis["digest"].is_null(), "no digest in content → null");
        assert_eq!(analysis["barRef"]["bar"], 38);
        let labels = analysis["labels"].as_array().unwrap();
        assert_eq!(labels.len(), 1, "unknown type and non-verbatim quote dropped");
        assert_eq!(labels[0]["type"], "observed-pattern");
        assert_eq!(analysis["memo"]["direction"]["value"], "short");
        assert_eq!(analysis["memo"]["entryPrice"]["value"], "41600 下方追入");
        assert_eq!(analysis["memo"]["confidence"]["value"], 70, "percent string parsed");
        let missing = analysis["missingFields"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(missing, ["target", "invalidation", "rejectedAlternatives"]);
        assert_eq!(analysis["schemaVersion"], ANALYSIS_SCHEMA_VERSION);
    }

    #[test]
    fn parse_analysis_drops_bad_bar_and_non_entry_memo() {
        let content = r#"{"barRef":{"bar":0,"quote":"x"},"labels":[],"memo":{"direction":{"value":"short","quote":"做空"}}}"#;
        let analysis =
            parse_analysis("intermediate", RAW, content, "m", "p", 1).unwrap();
        assert!(analysis["barRef"].is_null());
        assert!(analysis["memo"].is_null());
        assert!(analysis["missingFields"].as_array().unwrap().is_empty());
    }

    #[test]
    fn parse_analysis_rejects_non_json() {
        assert!(parse_analysis("entry", RAW, "抱歉我不能", "m", "p", 1).is_err());
    }

    #[test]
    fn parse_execution_suggestions_validates_and_normalizes() {
        let raw1 = "BAR152 我决定现在把我的止损价格移动到 90820.36 这个位置";
        let raw2 = "目前不适合移动止盈止损，也没有什么需要改变的";
        let cards = vec![
            ("card-1".to_string(), raw1.to_string()),
            ("card-2".to_string(), raw2.to_string()),
        ];
        let content = r#"{"suggestions":[
            {"cardIndex":1,"action":"stop","price":90820.36,"anchorText":null,"orderType":null,"signal":"保护利润","quote":"把我的止损价格移动到 90820.36"},
            {"cardIndex":2,"action":"stop","price":90820.36,"anchorText":null,"orderType":null,"signal":"x","quote":"编的话"},
            {"cardIndex":3,"action":"target","price":91000,"anchorText":null,"orderType":null,"signal":"y","quote":"BAR152"},
            {"cardIndex":1,"action":"scale-in","price":1,"anchorText":null,"orderType":null,"signal":"z","quote":"我决定"},
            {"cardIndex":1,"action":"stop","price":null,"anchorText":"成本线下方","orderType":"stop-loss","signal":"w","quote":"我决定"}
        ]}"#;
        let parsed = parse_execution_suggestions(content, &cards).unwrap();
        // 非逐字 quote、越界 cardIndex、非白名单 action 全部丢弃
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].card_id, "card-1");
        assert_eq!(parsed[0].action, "stop");
        assert_eq!(parsed[0].order_type, "stop-loss", "orderType defaults per action");
        assert_eq!(parsed[0].price, Some(90820.36));
        assert_eq!(parsed[0].signal.as_deref(), Some("保护利润"));
        assert_eq!(parsed[1].price, None);
        assert_eq!(parsed[1].anchor_text.as_deref(), Some("成本线下方"));

        let empty = parse_execution_suggestions(r#"{"suggestions":[]}"#, &cards).unwrap();
        assert!(empty.is_empty());
        assert!(parse_execution_suggestions("我不会", &cards).is_err());
    }

    #[test]
    fn title_messages_and_parse() {
        let cards = vec![
            ("pre-entry".to_string(), "BAR28 区间上沿第三次测试".to_string()),
            ("entry".to_string(), "BAR38 做空，止损上沿上方".to_string()),
        ];
        let messages = build_title_messages(&cards);
        assert!(messages[1].content.contains("[观察] BAR28"));
        assert!(messages[1].content.contains("[入场] BAR38"));

        assert_eq!(
            parse_title("```json\n{\"title\":\"BTC 区间假突破做空\"}\n```").unwrap(),
            "BTC 区间假突破做空"
        );
        assert_eq!(parse_title(r#"{"title":"  ETH 突破追多  "}"#).unwrap(), "ETH 突破追多");
        assert!(parse_title(r#"{"title":"  "}"#).is_err());
        assert!(parse_title("我不会起标题").is_err());
    }

    /// 真实 provider 联调（读 dev-profile 的 ai-providers.json，花一次真实调用）。
    /// 运行：CAIRN_AI_E2E=1 cargo test --manifest-path src-tauri/Cargo.toml ai_chat_e2e -- --ignored --nocapture
    #[test]
    #[ignore]
    fn ai_chat_e2e() {
        use std::env;
        if env::var("CAIRN_AI_E2E").unwrap_or_default() != "1" {
            panic!("set CAIRN_AI_E2E=1 to run");
        }
        let path = env::var("LOCALAPPDATA")
            .map(|base| PathBuf::from(base).join("Cairn").join("dev-profile").join("ai-providers.json"))
            .expect("LOCALAPPDATA");
        let content = fs::read_to_string(&path).expect("dev-profile ai-providers.json");
        let file: ProviderFile = serde_json::from_str(&content).expect("parse providers");
        let provider = file
            .providers
            .iter()
            .find(|item| item.is_default)
            .expect("no default provider configured");
        let model = provider.default_model.as_deref().expect("no default model");

        let text = "BAR38 这里第三次测试区间上沿失败收回，我决定做空，止损放在区间上沿上方 41650，目标先看区间中轨 40800，这个把握我给七成，如果重新站上 41700 说明我判断错了收手，本来还想做多以太但大级别偏空放弃了，说实话有点兴奋";
        let messages = build_analysis_messages("entry", text, "");
        let output = tauri::async_runtime::block_on(chat_completion(provider, model, &messages))
            .expect("chat completion");
        println!("--- raw model output ---\n{output}\n------------------------");
        let analysis = parse_analysis("entry", text, &output, model, &provider.id, 0)
            .expect("parse analysis");
        println!("--- parsed analysis ---\n{analysis:#}\n-----------------------");
        assert!(!analysis["labels"].as_array().unwrap().is_empty());
        assert_eq!(analysis["memo"]["direction"]["value"], "short");
    }

    /// 验证"带补充要求重试"链路：用户 instruction 追加为额外 user message 并生效。
    #[test]
    #[ignore]
    fn ai_chat_e2e_instruction() {
        use std::env;
        if env::var("CAIRN_AI_E2E").unwrap_or_default() != "1" {
            panic!("set CAIRN_AI_E2E=1 to run");
        }
        let path = env::var("LOCALAPPDATA")
            .map(|base| PathBuf::from(base).join("Cairn").join("dev-profile").join("ai-providers.json"))
            .expect("LOCALAPPDATA");
        let content = fs::read_to_string(&path).expect("dev-profile ai-providers.json");
        let file: ProviderFile = serde_json::from_str(&content).expect("parse providers");
        let provider = file
            .providers
            .iter()
            .find(|item| item.is_default)
            .expect("no default provider configured");
        let model = provider.default_model.as_deref().expect("no default model");

        // 故意含糊：41650 既能读成止损也能读成失效条件
        let text = "BAR38 这里跌不动了我想空，41650 我就跑，目标 40800，把握七成";
        let mut messages = build_analysis_messages("entry", text, "");
        messages.push(ChatMessage::user(
            "补充整理要求：41650 是止损价，请放进 stopLoss，不要放进 invalidation。",
        ));
        let output = tauri::async_runtime::block_on(chat_completion(provider, model, &messages))
            .expect("chat completion");
        println!("--- instruction run raw output ---\n{output}\n------------------------");
        let analysis = parse_analysis("entry", text, &output, model, &provider.id, 0)
            .expect("parse analysis");
        println!("--- instruction run analysis ---\n{analysis:#}\n-----------------------");
        assert!(
            analysis["memo"]["stopLoss"]["value"]
                .as_str()
                .is_some_and(|value| value.contains("41650")),
            "instruction should put 41650 into stopLoss"
        );
    }
}
