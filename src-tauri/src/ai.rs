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
    /// 模型列表（0.3.2）：一个 Provider 可配多个模型切换使用；旧文件无此字段时
    /// 由 default_model 合成。per-model 目前只覆盖思考等级。
    #[serde(default)]
    pub models: Vec<AiModelConfig>,
    #[serde(default)]
    pub is_default: bool,
    /// 思考等级（0.3.1 开关 → 0.3.2 统一等级）：Provider 级默认，
    /// auto = 不发参数（模型默认）；on/off/low/medium/high 按 preset 映射成各家原生参数。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    /// 并发上限（0.3.1）：「全部识别」批量与后台自动识别共用；默认 10。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub concurrency: Option<u8>,
    pub created_at: u64,
    pub updated_at: u64,
}

/// 模型级覆盖设置（0.3.2）：thinking 为 None = 继承 Provider 级 thinking。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiModelConfig {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
}

const THINKING_LEVELS: [&str; 5] = ["on", "off", "low", "medium", "high"];

fn sanitize_thinking(value: Option<String>) -> Option<String> {
    value.filter(|text| THINKING_LEVELS.contains(&text.as_str()))
}

/// Provider 并发上限（前端批量 worker 数与 Rust 后台闸门共用），默认 10。
pub fn concurrency_of(provider: &AiProvider) -> usize {
    provider
        .concurrency
        .map(|n| (n.max(1) as usize).min(32))
        .unwrap_or(10)
}

/// 把思考等级映射参数写入请求体；不支持的 preset/等级不写任何字段。
/// 统一等级（on/off/low/medium/high）按 preset 映射成各家 OpenAI 兼容端点的
/// 原生参数；未知 preset 一律不发——严格端点对未知字段直接 4xx（0.3.1 的教训）。
fn apply_thinking_param(body: &mut Value, provider: &AiProvider, model: &str) {
    // 模型级覆盖优先，None 继承 Provider 级，都空 = 跟随模型默认（不发）
    let Some(level) = provider
        .models
        .iter()
        .find(|item| item.id == model)
        .and_then(|item| item.thinking.as_deref())
        .or(provider.thinking.as_deref())
    else {
        return;
    };
    match provider.preset_id.as_deref() {
        // OpenRouter：reasoning.effort 统一参数（官方推荐替代 :thinking 变体）；none 关闭混合推理
        Some("openrouter") => match level {
            "low" | "medium" | "high" => body["reasoning"] = json!({ "effort": level }),
            "on" => body["reasoning"] = json!({ "effort": "high" }),
            "off" => body["reasoning"] = json!({ "effort": "none" }),
            _ => {}
        },
        // OpenAI：reasoning_effort；off 不发参数（非推理模型发未知字段会 4xx）
        Some("openai") => match level {
            "low" | "medium" | "high" => body["reasoning_effort"] = json!(level),
            "on" => body["reasoning_effort"] = json!("medium"),
            _ => {}
        },
        // 智谱 GLM：thinking.type 开关 + reasoning_effort 分档（GLM-5.2 起支持，
        // 官方档位 low/high/max）。GLM-5.3/5.3-FLASH 官方明确「始终思考，不能关闭」，
        // 实测发 disabled 会 400（「该模型始终思考，不支持关闭思考；请使用 low、high 或 max」），
        // 对这些模型的「关闭」降级为最低档 low——最接近省 token 的意图。
        Some("zhipu") => {
            let forced_thinking = model.to_ascii_lowercase().starts_with("glm-5.3");
            match level {
                "on" => body["thinking"] = json!({ "type": "enabled" }),
                "low" => {
                    body["thinking"] = json!({ "type": "enabled" });
                    body["reasoning_effort"] = json!("low");
                }
                "medium" | "high" => {
                    body["thinking"] = json!({ "type": "enabled" });
                    body["reasoning_effort"] = json!("high");
                }
                "off" if forced_thinking => {
                    body["thinking"] = json!({ "type": "enabled" });
                    body["reasoning_effort"] = json!("low");
                }
                "off" => body["thinking"] = json!({ "type": "disabled" }),
                _ => {}
            }
        }
        // 通义千问（DashScope 兼容模式）：enable_thinking 开关 + thinking_budget 分档
        //（high 不设上限，交给模型默认最大值）
        Some("qwen") => match level {
            "on" | "high" => body["enable_thinking"] = json!(true),
            "low" => {
                body["enable_thinking"] = json!(true);
                body["thinking_budget"] = json!(2048);
            }
            "medium" => {
                body["enable_thinking"] = json!(true);
                body["thinking_budget"] = json!(8192);
            }
            "off" => body["enable_thinking"] = json!(false),
            _ => {}
        },
        // 硅基流动：enable_thinking 开关（无 budget 分档）
        Some("siliconflow") => match level {
            "on" | "low" | "medium" | "high" => body["enable_thinking"] = json!(true),
            "off" => body["enable_thinking"] = json!(false),
            _ => {}
        },
        // deepseek（reasoner/chat 模型本身区分）、gemini、groq、moonshot、
        // anthropic 直连、custom：各家兼容端点无稳定思考参数，不发
        _ => {}
    }
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
    // 模型列表清洗：去空白、去重，模型级思考等级只留合法值
    for item in &mut provider.models {
        item.id = item.id.trim().to_string();
    }
    let mut seen = std::collections::HashSet::new();
    provider.models.retain(|item| !item.id.is_empty() && seen.insert(item.id.clone()));
    for item in &mut provider.models {
        item.thinking = sanitize_thinking(item.thinking.take());
    }
    provider.thinking = sanitize_thinking(provider.thinking.take());
    // 旧文件（无 models）兼容：由 default_model 合成；default_model 必须在列表里
    if provider.models.is_empty() {
        if let Some(model) = provider.default_model.clone() {
            let model = model.trim().to_string();
            if !model.is_empty() {
                provider.models.push(AiModelConfig { id: model, thinking: None });
            }
        }
    }
    let default_model = provider
        .default_model
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string);
    provider.default_model = match default_model {
        Some(model) if provider.models.iter().any(|item| item.id == model) => Some(model),
        _ => provider.models.first().map(|item| item.id.clone()),
    };
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
            // 默认 Provider 只在列表上显式切换（set_default），编辑不动它——
            // 否则「打开另一个 Provider 保存一下」就可能把默认标记挤掉。
            provider.is_default = file.providers[index].is_default;
            file.providers[index] = provider;
        }
        None => {
            if provider.id.trim().is_empty() {
                provider.id = format!("ai-{:x}-{:x}", now, file.providers.len() + 1);
            }
            provider.created_at = now;
            provider.updated_at = now;
            provider.is_default = false;
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

/// 把默认 Provider 切换到指定 id（设置页点击 Provider 卡片即选中）。
pub fn set_default(app: &AppHandle, id: String) -> Result<Vec<AiProvider>, String> {
    let mut file = read_file(app)?;
    if !file.providers.iter().any(|item| item.id == id) {
        return Err("provider not found".to_string());
    }
    let now = now_ms();
    for item in file.providers.iter_mut() {
        item.is_default = item.id == id;
        if item.is_default {
            item.updated_at = now;
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
    let client = http_client()
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
        .map_err(|err| format!("request failed: {}", describe_request_error(&err)))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("read response failed: {}", describe_read_error(&err)))?;
    if !status.is_success() {
        return Err(http_error_message(status, &body));
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

// ==================== 网络错误详情 ====================

/// 拼接错误 source 链（最多 3 层）：reqwest 的 Display 只说 "error sending request for url"，
/// 真正原因（DNS/连接/TLS/IO）藏在 source 链里，不取出来用户永远看不到为什么连不上。
fn join_source_chain(err: &dyn std::error::Error) -> String {
    let mut detail = String::new();
    let mut source = err.source();
    let mut depth = 0;
    while let Some(cause) = source {
        if depth > 0 {
            detail.push_str(" ← ");
        }
        let cause_text = cause.to_string();
        if !cause_text.is_empty() {
            detail.push_str(&cause_text);
            depth += 1;
        }
        source = cause.source();
        if depth >= 3 {
            break;
        }
    }
    detail
}

/// 请求发送失败 → 分类 + 地址 + 底层原因的中文详情。
/// 保持 "request failed:" 前缀：is_retryable_error 靠前缀分类。
fn describe_request_error(err: &reqwest::Error) -> String {
    let url = err.url().map(|url| url.to_string()).unwrap_or_default();
    let chain = join_source_chain(err);
    let chain_text = if chain.is_empty() { String::new() } else { format!("（{chain}）") };
    if err.is_timeout() {
        format!("请求超时：服务端长时间无响应 {url}{chain_text}")
    } else if err.is_connect() {
        format!("无法建立连接：DNS 解析失败、网络不通或被 VPN/代理拦截，请检查网络 {url}{chain_text}")
    } else {
        format!("请求发送失败 {url}{chain_text}")
    }
}

/// 响应体读取失败 → 详情。保持 "read response failed:" 前缀。
fn describe_read_error(err: &reqwest::Error) -> String {
    let chain = join_source_chain(err);
    let chain_text = if chain.is_empty() { String::new() } else { format!("（{chain}）") };
    if err.is_timeout() {
        format!("读取响应超时{chain_text}")
    } else if err.is_decode() {
        format!("响应内容异常{chain_text}")
    } else {
        format!("读取响应中断{chain_text}")
    }
}

/// HTTP 非 2xx 的状态提示；空串表示无补充。
fn http_status_hint(status: reqwest::StatusCode) -> &'static str {
    match status.as_u16() {
        401 | 403 => "（API Key 无效或无权限，去 设置 → AI 检查）",
        404 => "（路径不存在，检查 Base URL 是否正确）",
        429 => "（限流或额度不足，稍后再试）",
        _ => "",
    }
}

fn http_error_message(status: reqwest::StatusCode, body: &str) -> String {
    let snippet: String = body.chars().take(300).collect();
    format!("模型服务返回 {status}{}: {snippet}", http_status_hint(status))
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
    let client = http_client()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|err| err.to_string())?;
    let mut body = json!({
        "model": model,
        "messages": messages,
        "temperature": 0,
        "stream": false,
    });
    apply_thinking_param(&mut body, provider, model);
    let mut request = client.post(&url).json(&body);
    if !provider.api_key.is_empty() {
        request = request.bearer_auth(&provider.api_key);
    }
    let response = request
        .send()
        .await
        .map_err(|err| format!("request failed: {}", describe_request_error(&err)))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("read response failed: {}", describe_read_error(&err)))?;
    if !status.is_success() {
        return Err(http_error_message(status, &body));
    }
    extract_message_content(&body)
}

/// 从非流式响应体提取 choices[0].message.content（chat_completion 与流式降级路径共用）。
fn extract_message_content(body: &str) -> Result<String, String> {
    let parsed: Value = serde_json::from_str(body)
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
        || message.starts_with("模型服务返回 5")
        || message.starts_with("provider returned empty content")
}

// ==================== 流式 Chat Completion ====================

/// 流式回调的增量种类：思考文本（reasoning_content）或正文内容。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamChunkKind {
    Reasoning,
    Content,
}

#[derive(Debug, Clone)]
pub struct StreamChunk {
    pub kind: StreamChunkKind,
    pub text: String,
}

/// 流式调用的最终结果：正文 + 思考量 + token 统计（provider 给了才有）。
#[derive(Debug, Default, Clone)]
pub struct StreamOutcome {
    pub content: String,
    pub reasoning_chars: usize,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

/// SSE 增量累积器：chunk 边界不与换行对齐，也不与 UTF-8 字符边界对齐，
/// 所以按字节缓冲、只在完整行（\n 之前）上做 UTF-8 解码与 JSON 解析。
struct SseAccumulator {
    buffer: Vec<u8>,
    content: String,
    reasoning: String,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
    done: bool,
}

impl SseAccumulator {
    fn new() -> Self {
        Self {
            buffer: Vec::new(),
            content: String::new(),
            reasoning: String::new(),
            completion_tokens: None,
            total_tokens: None,
            done: false,
        }
    }

    /// 喂入一个网络 chunk，返回本次产生的增量（content / reasoning，可能为空）。
    /// usage 统计（若 provider 在最后一帧带上）记在自身字段里。
    fn push_chunk(&mut self, chunk: &[u8]) -> Vec<StreamChunk> {
        self.buffer.extend_from_slice(chunk);
        let mut chunks: Vec<StreamChunk> = Vec::new();
        while let Some(pos) = self.buffer.iter().position(|&byte| byte == b'\n') {
            let line = String::from_utf8_lossy(&self.buffer[..pos]).to_string();
            self.buffer.drain(..=pos);
            let line = line.trim_end_matches('\r');
            let Some(data) = line.strip_prefix("data:") else { continue };
            let data = data.trim();
            if data == "[DONE]" {
                self.done = true;
                break;
            }
            if data.is_empty() {
                continue;
            }
            // 单个事件解析失败不致命（role-only 等无 delta 的帧直接跳过）
            let Ok(event) = serde_json::from_str::<Value>(data) else { continue };
            if let Some(usage) = event.get("usage").filter(|value| value.is_object()) {
                if self.completion_tokens.is_none() {
                    self.completion_tokens = usage.get("completion_tokens").and_then(Value::as_u64);
                    self.total_tokens = usage.get("total_tokens").and_then(Value::as_u64);
                }
                continue;
            }
            let Some(delta) = event.pointer("/choices/0/delta") else { continue };
            // 思考文本：GLM/deepseek 系字段名 reasoning_content，个别端点用 reasoning
            for field in ["reasoning_content", "reasoning"] {
                if let Some(text) = delta.get(field).and_then(Value::as_str) {
                    if !text.is_empty() {
                        self.reasoning.push_str(text);
                        chunks.push(StreamChunk { kind: StreamChunkKind::Reasoning, text: text.to_string() });
                    }
                    break;
                }
            }
            if let Some(text) = delta.get("content").and_then(Value::as_str) {
                if !text.is_empty() {
                    self.content.push_str(text);
                    chunks.push(StreamChunk { kind: StreamChunkKind::Content, text: text.to_string() });
                }
            }
        }
        chunks
    }
}

/// 流式 chat completion：stream: true，增量经 on_chunk 吐出（思考/正文分开），
/// 返回 StreamOutcome（正文喂给与非流式相同的解析器，提示词零改动）。
/// 超时口径：connect 15s + 两次 chunk 间隔 30s（read_timeout），无总时长限制——
/// 总超时会掐断长输出。provider 忽略 stream 参数时自动降级整段读。
pub async fn chat_completion_stream(
    provider: &AiProvider,
    model: &str,
    messages: &[ChatMessage],
    on_chunk: &(dyn Fn(&StreamChunk) + Send + Sync),
) -> Result<StreamOutcome, String> {
    let url = format!("{}/chat/completions", provider.base_url);
    let client = http_client()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))
        .build()
        .map_err(|err| err.to_string())?;
    let mut body = json!({
        "model": model,
        "messages": messages,
        "temperature": 0,
        "stream": true,
    });
    apply_thinking_param(&mut body, provider, model);
    let mut request = client.post(&url).json(&body);
    if !provider.api_key.is_empty() {
        request = request.bearer_auth(&provider.api_key);
    }
    let mut response = request
        .send()
        .await
        .map_err(|err| format!("request failed: {}", describe_request_error(&err)))?;

    let is_event_stream = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("text/event-stream"));
    if !is_event_stream {
        // provider 不支持流式：当普通响应整段读，并整体作为一次正文增量吐给回调
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|err| format!("read response failed: {}", describe_read_error(&err)))?;
        if !status.is_success() {
            return Err(http_error_message(status, &body));
        }
        let mut outcome = StreamOutcome {
            content: extract_message_content(&body)?,
            ..Default::default()
        };
        if let Ok(parsed) = serde_json::from_str::<Value>(&body) {
            outcome.completion_tokens = parsed.pointer("/usage/completion_tokens").and_then(Value::as_u64);
            outcome.total_tokens = parsed.pointer("/usage/total_tokens").and_then(Value::as_u64);
        }
        on_chunk(&StreamChunk { kind: StreamChunkKind::Content, text: outcome.content.clone() });
        return Ok(outcome);
    }

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(http_error_message(status, &body));
    }

    let mut acc = SseAccumulator::new();
    while !acc.done {
        let chunk = response
            .chunk()
            .await
            .map_err(|err| {
                if acc.content.is_empty() && acc.reasoning.is_empty() {
                    format!("request failed: {}", describe_request_error(&err))
                } else {
                    let received = acc.content.chars().count();
                    format!("流式输出中断（已接收 {received} 字）：{}", describe_read_error(&err))
                }
            })?;
        let Some(chunk) = chunk else { break };
        for piece in acc.push_chunk(&chunk) {
            on_chunk(&piece);
        }
    }
    if acc.content.trim().is_empty() {
        return Err("provider returned empty content".to_string());
    }
    Ok(StreamOutcome {
        content: acc.content,
        reasoning_chars: acc.reasoning.chars().count(),
        completion_tokens: acc.completion_tokens,
        total_tokens: acc.total_tokens,
    })
}

/// 流式重试：网络类失败且**尚未收到任何内容**时整体重试一次；
/// 已输出过内容后中断不重试（流文本会重复），错误直接返回。
pub async fn chat_completion_stream_with_retry(
    provider: &AiProvider,
    model: &str,
    messages: &[ChatMessage],
    on_chunk: &(dyn Fn(&StreamChunk) + Send + Sync),
) -> Result<StreamOutcome, String> {
    match chat_completion_stream(provider, model, messages, on_chunk).await {
        Ok(outcome) => Ok(outcome),
        Err(first) if is_retryable_error(&first) => {
            chat_completion_stream(provider, model, messages, on_chunk)
                .await
                .map_err(|second| format!("{first}；重试一次后仍失败：{second}"))
        }
        Err(first) => Err(first),
    }
}

// ==================== 出站网络设置（代理） ====================

/// 代理模式：跟随系统（默认）/ 手动 / 直连。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProxyMode {
    System,
    Manual,
    Off,
}

impl ProxyMode {
    pub fn as_str(self) -> &'static str {
        match self {
            ProxyMode::System => "system",
            ProxyMode::Manual => "manual",
            ProxyMode::Off => "off",
        }
    }
}

/// 全局出站代理设置，存 app_data_dir/network-settings.json，不进入备份。
/// 作用于 Rust 侧全部出站请求（AI 请求 + GitHub 浮窗脚本检查 + 应用内更新检查）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSettings {
    /// "system" | "manual" | "off"；None = 0.3.2 旧文件，由 proxy_enabled 迁移。
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default = "default_proxy_url")]
    pub proxy_url: String,
    /// 0.3.2 旧字段：只读迁移用（true → manual），保存时按 mode 重写。
    #[serde(default)]
    pub proxy_enabled: bool,
    /// 当前实际生效的代理地址（manual 配置值，或 system 模式探测到的系统代理）；
    /// 直连 / 未探测到为 None。只读，由 get/save 命令回填。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_proxy_url: Option<String>,
}

fn default_proxy_url() -> String {
    "http://127.0.0.1:7890".to_string()
}

impl Default for NetworkSettings {
    fn default() -> Self {
        Self { mode: None, proxy_url: default_proxy_url(), proxy_enabled: false, effective_proxy_url: None }
    }
}

impl NetworkSettings {
    pub fn proxy_mode(&self) -> ProxyMode {
        match self.mode.as_deref() {
            Some("manual") => ProxyMode::Manual,
            Some("off") => ProxyMode::Off,
            Some("system") => ProxyMode::System,
            _ if self.proxy_enabled => ProxyMode::Manual,
            _ => ProxyMode::System,
        }
    }
}

fn network_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(paths::app_data_dir(app)?.join("network-settings.json"))
}

pub fn network_settings(app: &AppHandle) -> NetworkSettings {
    let Ok(path) = network_settings_path(app) else {
        return NetworkSettings::default();
    };
    let Ok(content) = fs::read_to_string(&path) else {
        return NetworkSettings::default();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

pub fn save_network_settings(app: &AppHandle, value: NetworkSettings) -> Result<NetworkSettings, String> {
    let mode = value.proxy_mode();
    let mut proxy_url = value.proxy_url.trim().to_string();
    if matches!(mode, ProxyMode::Manual) {
        if !proxy_url.starts_with("http://") && !proxy_url.starts_with("https://") {
            return Err("代理地址必须以 http:// 或 https:// 开头".to_string());
        }
        if reqwest::Proxy::all(&proxy_url).is_err() {
            return Err("代理地址无效".to_string());
        }
    } else if proxy_url.is_empty() {
        proxy_url = default_proxy_url();
    }
    // 保存时把解析后的 mode 落盘，旧版 {proxyEnabled} 文件自此升级
    let stored = NetworkSettings {
        mode: Some(mode.as_str().to_string()),
        proxy_url,
        proxy_enabled: matches!(mode, ProxyMode::Manual),
        effective_proxy_url: None,
    };
    let path = network_settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let content = serde_json::to_string_pretty(&stored).map_err(|err| err.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|err| err.to_string())?;
    fs::rename(&tmp, &path).map_err(|err| err.to_string())?;
    refresh_proxy(app);
    let mut stored = stored;
    stored.effective_proxy_url = effective_proxy_url();
    Ok(stored)
}

/// 进程内代理缓存：启动与保存时刷新，请求路径只读这里——
/// fetch_models 等无 AppHandle 的调用也能走代理，且不用每次请求探测。
#[derive(Clone)]
struct ProxyState {
    mode: ProxyMode,
    /// 生效代理地址；system 未探测到为 None
    url: Option<String>,
}

static PROXY_STATE: std::sync::RwLock<ProxyState> = std::sync::RwLock::new(ProxyState {
    mode: ProxyMode::System,
    url: None,
});

pub fn refresh_proxy(app: &AppHandle) {
    let settings = network_settings(app);
    let mode = settings.proxy_mode();
    let url = match mode {
        ProxyMode::Manual => {
            let url = settings.proxy_url.trim().to_string();
            (!url.is_empty()).then_some(url)
        }
        ProxyMode::System => detect_system_proxy(),
        ProxyMode::Off => None,
    };
    *PROXY_STATE.write().unwrap() = ProxyState { mode, url };
}

/// 探测操作系统代理（Windows 注册表 / macOS scutil / Linux 桌面设置）。
/// 系统未配置、已关闭或仅 PAC 自动配置时返回 None → 直连。
fn detect_system_proxy() -> Option<String> {
    system_proxy_url(&sysproxy::Sysproxy::get_system_proxy().ok()?)
}

/// enable=false 必须直接忽略：sysproxy 在系统代理关闭时仍会返回注册表残留的
/// host/port（Windows 关掉开关后 ProxyServer 旧值保留），跟着走会把全部出站
/// 请求引到一个死代理上。
fn system_proxy_url(proxy: &sysproxy::Sysproxy) -> Option<String> {
    if !proxy.enable {
        return None;
    }
    let host = proxy.host.trim();
    if host.is_empty() || proxy.port == 0 {
        return None;
    }
    let url = if host.contains("://") {
        format!("{host}:{}", proxy.port)
    } else {
        format!("http://{host}:{}", proxy.port)
    };
    reqwest::Proxy::all(&url).is_ok().then_some(url)
}

/// 统一出站 Client 构建：manual/system 解析出地址则全部请求经代理；
/// 地址无效时降级直连（不让配置错误打断所有请求）；off 强制直连
/// （no_proxy 压掉 reqwest 的系统代理默认探测）。
pub fn http_client() -> reqwest::ClientBuilder {
    let mut builder = reqwest::Client::builder();
    let state = PROXY_STATE.read().unwrap().clone();
    if let Some(url) = state.url {
        if let Ok(proxy) = reqwest::Proxy::all(&url) {
            builder = builder.proxy(proxy);
        }
    } else if state.mode == ProxyMode::Off {
        builder = builder.no_proxy();
    }
    builder
}

/// 当前生效的代理地址（manual 配置或 system 探测结果）；直连为 None。
/// 更新器插件自建 HTTP client、不走 http_client()，前端把这个值传给 check({proxy})。
pub fn effective_proxy_url() -> Option<String> {
    PROXY_STATE.read().unwrap().url.clone()
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

// ==================== 后台 AI 任务事件（前端任务中心） ====================

static TASK_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// 后台自动识别的全局并发闸门（0.3.1）：批量拆卡一次会 spawn N 个线程，
/// 不限流的话 N 路并发打 provider 容易 429。上限取默认 Provider 的并发设置。
static ACTIVE_AUTO_ANALYSIS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

pub fn next_task_id() -> String {
    let seq = TASK_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("bg-{:x}-{seq:x}", now_ms())
}

/// 后台 AI 任务生命周期事件（cairn://ai-task）：前端任务中心据此合并展示
/// 「哪些在进行、哪些成功/失败」。GUI 发起的任务由前端自行注册，不走这里。
pub fn emit_task_event(
    app: &AppHandle,
    id: &str,
    kind: &str,
    status: &str,
    label: &str,
    target_type: Option<&str>,
    target_id: Option<&str>,
    error: Option<&str>,
) {
    let mut payload = json!({
        "id": id,
        "kind": kind,
        "status": status,
        "label": label,
        "at": now_ms(),
    });
    if let Some(target_type) = target_type {
        payload["targetType"] = json!(target_type);
    }
    if let Some(target_id) = target_id {
        payload["targetId"] = json!(target_id);
    }
    if let Some(error) = error {
        payload["error"] = json!(error);
    }
    let _ = app.emit(crate::api::AI_TASK_EVENT, payload);
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
        let task_id = next_task_id();
        emit_task_event(&app, &task_id, "analysis", "start", "识别卡片", Some("card"), Some(&card_id), None);
        // 并发闸门：达到上限就等下一个空位（150ms 轮询足够，任务本身长达数秒）
        let max = default_provider(&app)
            .ok()
            .flatten()
            .map(|(provider, _)| concurrency_of(&provider))
            .unwrap_or(10);
        while ACTIVE_AUTO_ANALYSIS.load(std::sync::atomic::Ordering::Relaxed) >= max {
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
        ACTIVE_AUTO_ANALYSIS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let result =
            tauri::async_runtime::block_on(crate::run_card_analysis(&app, &db, &card_id, None, false));
        ACTIVE_AUTO_ANALYSIS.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
        match result {
            Ok(Some(card)) => {
                emit_task_event(&app, &task_id, "analysis", "succeeded", "识别卡片", Some("card"), Some(&card_id), None);
                let _ = app.emit(crate::api::DATA_CHANGED_EVENT, &card);
            }
            // userAdjusted 放弃写回：不是失败，任务正常完成
            Ok(None) => {
                emit_task_event(&app, &task_id, "analysis", "succeeded", "识别卡片", Some("card"), Some(&card_id), None);
            }
            Err(err) => {
                emit_task_event(&app, &task_id, "analysis", "failed", "识别卡片", Some("card"), Some(&card_id), Some(&err));
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
        let task_id = next_task_id();
        emit_task_event(&app, &task_id, "suggestions", "start", "补录建议", Some("case"), Some(&case_id), None);
        let result =
            tauri::async_runtime::block_on(crate::run_execution_suggestions(&app, &db, &case_id));
        match result {
            Ok(case) => {
                emit_task_event(&app, &task_id, "suggestions", "succeeded", "补录建议", Some("case"), Some(&case_id), None);
                let _ = app.emit(crate::api::DATA_CHANGED_EVENT, &case);
            }
            Err(err) => {
                emit_task_event(&app, &task_id, "suggestions", "failed", "补录建议", Some("case"), Some(&case_id), Some(&err));
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

pub const SUGGESTION_PROMPT_VERSION: &str = "0.3.4-suggest-2";

/// 建议只覆盖管理类动作（编辑器规范集：stop / target-moved / order-edit）。
/// 开仓、加仓、减仓、平仓以交易所导入的成交为准，AI 一律不碰。
/// 0.3.4 起同一次调用还产出交易标签建议（tradeTags，打到绑定的 Trade 上）：
/// 只能从用户消息里的标签词表中选，每条必须有逐字原话证据。

pub fn build_suggestion_messages(context: &str) -> Vec<ChatMessage> {
    let system = "你是交易日志的持仓管理核对员。交易者在一个 Case 里用口语记录了全过程，这个 Case 绑定了一笔 Trade（成交记录来自交易所导出）。你有两个任务：一是找出「交易者明确说过要做、但成交记录里没有对应落库」的持仓管理动作，作为补录建议；二是为这笔 Trade 建议标签。

任务一：管理类动作补录
只关注管理类动作：移动/设置止损、移动/设置止盈、修改挂单价格、撤销挂单。开仓、加仓、减仓、平仓一律不管（成交以交易所记录为准）。

判定规则：
- 只提取「明确说了价格或明确位置」且语气是「已经决定 / 已经发生」的动作（如 我决定、我把、挪到、改到、挂到、撤掉）。
- 明确的否定不提取（如 不适合移动止盈止损、不向下移动也不向上移动、保持不变）；纯假设不提取（如 如果…就…）。
- 每条建议必须给出当时原话 quote（逐字复制、一字不差）和来源卡片编号 cardIndex（用户消息里每张卡开头的编号）。
- 已落库动作里已有同类且价格基本相同的动作、或与初始止损/止盈价相同的，不要建议（视为已覆盖）。
- price 是明确的数字价格；只说了位置没说价格（如 挪到成本线下方）时 price 为 null，并在 anchorText 里写位置描述。信息不足的动作宁可不建议。

任务二：交易标签建议（打到这笔 Trade 上）
- 只能从用户消息里的「标签词表」中选择，不许造新标签名；词表按颜色分组，分组语义写在词表里。
- 每条标签必须给出卡片原话 quote（逐字复制）作为证据，并给 cardIndex；cardIndex 缺失时也必须能从某张卡原文里逐字找到 quote。
- 按证据强度从高到低排列，最多 15 条；证据不足的不要凑数。交易者已有标签不要重复建议。
- 没有足够证据就输出空数组。

只输出一个 JSON 对象，不要 markdown 代码块和解释：
{\"suggestions\":[{\"cardIndex\":<卡片编号>,\"action\":\"stop|target|order-edit\",\"price\":<数字或null>,\"anchorText\":\"<位置描述或null>\",\"orderType\":\"stop-loss|take-profit|limit 或null\",\"signal\":\"<不超过12字的简短理由>\",\"quote\":\"<逐字原话>\"}],\"tradeTags\":[{\"cardIndex\":<卡片编号>,\"name\":\"<词表中的标签名>\",\"quote\":\"<逐字原话>\",\"signal\":\"<不超过12字的理由>\"}]}
没有可建议的就输出 {\"suggestions\":[],\"tradeTags\":[]}";
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

// ==================== 交易标签建议 ====================

/// 一条交易标签建议：name 必须命中用户标签词表，quote 逐字来自卡片原文。
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedTradeTag {
    pub name: String,
    pub card_id: String,
    pub quote: String,
    pub signal: Option<String>,
}

/// 校验标签建议（不整体失败，逐条丢弃不可信项）：name 命中词表（忽略大小写与
/// 空白差异）、quote 必须逐字来自某张卡原文（优先 cardIndex 指向的卡）、按 name
/// 去重、最多 15 条。词表为空（用户还没建标签）时直接返回空。
pub fn parse_trade_tags(
    content: &str,
    cards: &[(String, String)],
    vocabulary: &[String],
) -> Vec<ParsedTradeTag> {
    if vocabulary.is_empty() {
        return Vec::new();
    }
    let Ok(parsed) = serde_json::from_str::<Value>(extract_json_object(content)) else {
        return Vec::new();
    };
    let Some(items) = parsed.get("tradeTags").and_then(Value::as_array) else {
        return Vec::new();
    };
    let normalize = |text: &str| text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    let vocab: Vec<(String, String)> = vocabulary
        .iter()
        .map(|name| (normalize(name), name.trim().to_string()))
        .collect();
    let mut out: Vec<ParsedTradeTag> = Vec::new();
    for item in items {
        let Some(raw_name) = item
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
        else {
            continue;
        };
        let Some(name) = vocab
            .iter()
            .find(|(key, _)| *key == normalize(raw_name))
            .map(|(_, original)| original.clone())
        else {
            continue;
        };
        if out.iter().any(|tag| tag.name == name) {
            continue;
        }
        let Some(quote) = item
            .get("quote")
            .and_then(Value::as_str)
            .filter(|quote| !quote.trim().is_empty())
        else {
            continue;
        };
        // 证据定位：cardIndex 指向的卡优先（错位即丢），缺失时全文找第一张含该原话的卡
        let card_id = match item.get("cardIndex").and_then(Value::as_i64) {
            Some(index) if index >= 1 && (index as usize) <= cards.len() => {
                let (card_id, raw_text) = &cards[(index - 1) as usize];
                if raw_text.contains(quote) {
                    card_id.clone()
                } else {
                    continue;
                }
            }
            _ => cards
                .iter()
                .find(|(_, raw_text)| raw_text.contains(quote))
                .map(|(card_id, _)| card_id.clone())
                .unwrap_or_default(),
        };
        if card_id.is_empty() {
            continue;
        }
        let signal = item
            .get("signal")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(|text| text.chars().take(24).collect::<String>());
        out.push(ParsedTradeTag {
            name,
            card_id,
            quote: quote.to_string(),
            signal,
        });
        if out.len() >= 15 {
            break;
        }
    }
    out
}

// ==================== 整单 AI 总结 ====================

pub const SUMMARY_PROMPT_VERSION: &str = "0.3.4-summary-2";

pub fn build_summary_messages(context: &str) -> Vec<ChatMessage> {
    let system = "你是交易日志的复盘整理员。交易者在一个 Case 里用口语记录了一笔交易从观察到离场的全过程，你把它整理成一份复盘总结。

硬性规则：
- 只输出一个 JSON 对象，不要 markdown 代码块和解释。
- 只使用背景资料里的信息；资料里没有的不许编造。数字（价格、盈亏、时间）以资料中的数字为准；卡片叙述与数字冲突时，并列陈述不裁决。
- 只描述事实与偏差，不打分、不下对错结论、不给建议——过程评价永远留给交易者本人。
- 概括交易者的口语时要忠实原意，语气词和语音识别噪音直接忽略。

输出字段：
- overview：一句话定性这笔交易（不超过 40 字），例如「BTC 区间突破追多，测距止盈 1:1 离场」。
- narrative：2-4 段复盘叙述（用 \\n\\n 分段），按时间线串联：计划怎么形成 → 怎么入场 → 持仓中怎么管理 → 怎么离场，穿插交易者的关键判断与情绪。引用原话时用「」。文中重点可以加受限标注：**关键事实**（加粗）、!!问题或偏差!!（红下划线）、==执行到位或亮点==（绿下划线）；标注要克制（全文合计不超过 15 处），不是每段都必须有；标注不许嵌套、不许跨段（不能包含换行）。
- highlights：3-5 条要点字符串数组，每条一个独立事实或偏差（计划价 vs 实际价、说过但没落库的动作、情绪信号等）。
- missing：资料中缺失或对不上的信息数组（如无止损记录、开平仓时间缺失），没有则空数组。";
    vec![ChatMessage::system(system), ChatMessage::user(context.to_string())]
}

/// 标注记号对：加粗 / 红（问题偏差）/ 绿（执行到位）。与前端 lib/summary-markup.ts 同语义。
fn summary_marker_pair(kind: &str) -> (&'static str, &'static str) {
    match kind {
        "bold" => ("**", "**"),
        "red" => ("!!", "!!"),
        _ => ("==", "=="),
    }
}

/// 总结 narrative 的受限标注清洗（0.3.4）：模型输出不可信，未配对、空内容、
/// 跨行（含换行）、嵌套或超量（>20 处）的标注一律剥掉记号保留文字——永不丢内容。
/// 算法：单遍扫描，进入标注态后遇到任何记号即结算当前段（同记号且合法→保留记号，
/// 否则→只留文字），换开新段；文本结束仍在标注态→只留文字。
pub fn sanitize_summary_markup(text: &str) -> String {
    const MAX_MARKED: usize = 20;
    let chars: Vec<char> = text.chars().collect();
    let marker_at = |i: usize| -> Option<&'static str> {
        if i + 1 >= chars.len() {
            return None;
        }
        match (chars[i], chars[i + 1]) {
            ('*', '*') => Some("bold"),
            ('!', '!') => Some("red"),
            ('=', '=') => Some("green"),
            _ => None,
        }
    };
    let mut out = String::new();
    let mut marked = 0usize;
    let mut open: Option<&'static str> = None;
    let mut buf = String::new();
    let mut i = 0usize;
    while i < chars.len() {
        if let Some(kind) = marker_at(i) {
            match open {
                None => {
                    open = Some(kind);
                    buf.clear();
                }
                Some(current) => {
                    let keep = current == kind
                        && !buf.trim().is_empty()
                        && !buf.contains('\n')
                        && marked < MAX_MARKED;
                    if keep {
                        let (left, right) = summary_marker_pair(kind);
                        out.push_str(left);
                        out.push_str(&buf);
                        out.push_str(right);
                        marked += 1;
                    } else {
                        out.push_str(&buf);
                    }
                    buf.clear();
                    // 异记号换开：剥掉旧记号后以新记号重开一段，嵌套错误可预测地降级
                    open = if current == kind { None } else { Some(kind) };
                }
            }
            i += 2;
        } else {
            match open {
                Some(_) => buf.push(chars[i]),
                None => out.push(chars[i]),
            }
            i += 1;
        }
    }
    if open.is_some() {
        out.push_str(&buf);
    }
    out
}

pub fn parse_summary(content: &str) -> Result<Value, String> {
    let json_text = extract_json_object(content);
    let parsed: Value =
        serde_json::from_str(json_text).map_err(|err| format!("model output is not JSON: {err}"))?;

    let overview = parsed
        .get("overview")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| text.chars().take(60).collect::<String>())
        .ok_or_else(|| "model output has no overview".to_string())?;
    let narrative = parsed
        .get("narrative")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| text.chars().take(4000).collect::<String>())
        .map(|text| sanitize_summary_markup(&text))
        .unwrap_or_default();
    let cap_list = |value: &Value, item_cap: usize, max_items: usize| -> Vec<String> {
        value
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .take(max_items)
                    .map(|text| text.chars().take(item_cap).collect::<String>())
                    .collect()
            })
            .unwrap_or_default()
    };
    let highlights = cap_list(parsed.get("highlights").unwrap_or(&Value::Null), 120, 6);
    let missing = cap_list(parsed.get("missing").unwrap_or(&Value::Null), 80, 6);

    Ok(json!({
        "schemaVersion": SUMMARY_PROMPT_VERSION,
        "promptVersion": SUMMARY_PROMPT_VERSION,
        "overview": overview,
        "narrative": narrative,
        "highlights": highlights,
        "missing": missing,
    }))
}

// ==================== Case↔Trade 关联推荐 ====================

pub const BINDING_PROMPT_VERSION: &str = "0.3.0-binding-1";

pub fn build_binding_messages(context: &str) -> Vec<ChatMessage> {
    let system = "你是交易日志的关联核对员。一个 Case（交易者的口语记录集合）可能对应一笔 Trade（交易所成交记录）。用户给了一个目标和一份候选清单，你找出最可能匹配的候选并说明理由。

规则：
- 只输出一个 JSON 对象，不要 markdown 代码块和解释：{\"matches\":[{\"candidateIndex\":<候选编号>,\"reason\":\"<不超过 60 字的理由，指出方向、价格区间、时间上的吻合点>\",\"confidence\":\"high|medium|low\"}]}
- 按可能性从高到低排列，最多 3 条；都不匹配就输出 {\"matches\":[]}。
- 只依据资料判断，资料里没有的信息不要编造。方向相反、价格数量级差很远、时间差很大的候选不要选。";
    vec![ChatMessage::system(system), ChatMessage::user(context.to_string())]
}

pub fn parse_binding_matches(content: &str, candidate_count: usize) -> Result<Vec<Value>, String> {
    let json_text = extract_json_object(content);
    let parsed: Value =
        serde_json::from_str(json_text).map_err(|err| format!("model output is not JSON: {err}"))?;
    let empty: Vec<Value> = Vec::new();
    let items = parsed
        .get("matches")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or(empty);
    let mut out: Vec<Value> = Vec::new();
    for item in items {
        let index = match item.get("candidateIndex").and_then(Value::as_i64) {
            Some(index) if index >= 1 && (index as usize) <= candidate_count => index,
            _ => continue,
        };
        if out.iter().any(|kept| kept["candidateIndex"].as_i64() == Some(index)) {
            continue;
        }
        let confidence = match item.get("confidence").and_then(Value::as_str) {
            Some("high") => "high",
            Some("medium") => "medium",
            Some("low") => "low",
            _ => "low",
        };
        let reason = item
            .get("reason")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(|text| text.chars().take(80).collect::<String>())
            .unwrap_or_default();
        out.push(json!({ "candidateIndex": index, "reason": reason, "confidence": confidence }));
        if out.len() >= 3 {
            break;
        }
    }
    Ok(out)
}

// ==================== 批量语音拆卡 ====================

pub const SPLIT_PROMPT_VERSION: &str = "0.3.5-split-3";

pub fn build_split_messages(phase: &str, raw_text: &str) -> Vec<ChatMessage> {
    let system = "你是交易日志的拆卡员。交易者用语音一口气讲了几根 K 线的观察，一口气提交了一大段原文。你把这一大段按 K 线锚点拆成多张卡片。

拆分粒度——K 线锚定，宁合勿拆：
- 只有交易者明确把内容推进到一根新的 K 线时才开新卡：显式报号，或「下一根 K 线收出了……」「再下一根走出了……」「立马跟着一根……」这类已发生的事实陈述。
- 「如果下一根……我就……」「要是回到 120 我就……」这类假设/计划句式不是锚点：那是当前 K 线上的思考，留在上一张卡。
- 当前 K 线上的评述、市场分析、计划、情绪，无论换了几个想法都留在当前这张卡——交易者没说换了 K 线，就当作还在原来那根；中间实际隔了几根也不拆开，缺号不补、不猜。
- 第一个锚点之前的引子并进第一张卡；整段没有任何 K 线锚点就输出一张卡（barRef 为 null）。

规则：
- 只输出一个 JSON 对象，不要 markdown 代码块和解释：{\"cards\":[{\"barRef\":<正整数或null>,\"text\":\"<原文逐字连续片段>\"}]}
- text 必须逐字复制原文（一字不差；可以去掉段首尾的语气词和空白，但不许改字、不许翻译、不许润色），各段按原文出现顺序排列，合起来覆盖全部有信息的内容。
- 锚点识别的写法：「120号K线」「120 号 K 线」「BAR 120」「bar #120」「第 42 根 K 线」「现在是 254」，以及整段开头的裸数字（「89，价格选择去上涨」）。
- 「下一根 / 再下一根 / 下一根 K 线」= 上一个 barRef + 1；交易者再次显式报号后以新报的号为准。
- 回顾更早 K 线的引用不是锚点，以陈述时刻的 K 线为准。
- 每张卡的 barRef 取它的锚点段；只有整段完全没有锚点时才输出 barRef 为 null 的单卡。";
    let user = format!("记录阶段：{}（{}）\n原文：\n{}", phase_label(phase), phase, raw_text);
    vec![ChatMessage::system(system), ChatMessage::user(user)]
}

/// 一段拆分结果：barRef 可缺失，text 是原文逐字片段。
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedCardSplit {
    pub bar_ref: Option<i64>,
    pub text: String,
}

/// 机械校验模型拆分：每段 text 必须是原文的子串且按序不重叠；barRef 合法（1-1440）
/// 且出现时单调递增（违反则该段 barRef 置空）；段数 ≤20；无锚点的段并入前一张卡
/// （首段无锚点则拼进下一个锚点段开头，全部无锚点保持单卡）；各段合计需覆盖原文
/// ≥85% 的非空白字符——模型漏句时宁可整体 Err（调用方退化为完整单卡），绝不静默
/// 丢内容。
pub fn parse_card_splits(content: &str, raw_text: &str) -> Result<Vec<ParsedCardSplit>, String> {
    let json_text = extract_json_object(content);
    let parsed: Value =
        serde_json::from_str(json_text).map_err(|err| format!("model output is not JSON: {err}"))?;
    let empty: Vec<Value> = Vec::new();
    let items = parsed
        .get("cards")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or(empty);
    if items.is_empty() {
        return Err("model output has no cards".to_string());
    }
    if items.len() > 20 {
        return Err(format!("model output has {} cards (max 20)", items.len()));
    }

    let mut out: Vec<ParsedCardSplit> = Vec::new();
    let mut search_from = 0usize;
    let mut last_bar: Option<i64> = None;
    for item in &items {
        let text = item
            .get("text")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .ok_or_else(|| "split text is empty".to_string())?;
        let position = raw_text[search_from..]
            .find(text)
            .map(|offset| search_from + offset)
            .ok_or_else(|| format!("split text is not a verbatim substring: {text}"))?;
        search_from = position + text.len();

        let mut bar_ref = item
            .get("barRef")
            .and_then(Value::as_i64)
            .filter(|bar| (1..=1440).contains(bar));
        if let (Some(bar), Some(last)) = (bar_ref, last_bar) {
            if bar <= last {
                bar_ref = None;
            }
        }
        if bar_ref.is_some() {
            last_bar = bar_ref;
        }
        out.push(ParsedCardSplit { bar_ref, text: text.to_string() });
    }

    // 无锚点段落并入前一张卡（0.3.5）：交易者没明确说换了 K 线，评述就属于上一根。
    // 模型偶尔仍会把无锚点评述拆成独立卡，这里机械合并兜底；首段无锚点时作为引子
    // 拼进下一个锚点段开头，全部无锚点则保持一张卡。逐字/顺序校验已在上面按段
    // 完成，拼接只是把已校验的相邻片段连起来，不引入新文本。
    let mut merged: Vec<ParsedCardSplit> = Vec::with_capacity(out.len());
    let mut pending_prefix = String::new();
    for split in out {
        if split.bar_ref.is_none() {
            if let Some(last) = merged.last_mut() {
                last.text.push_str(&split.text);
            } else {
                pending_prefix.push_str(&split.text);
            }
            continue;
        }
        let mut split = split;
        if !pending_prefix.is_empty() {
            split.text = format!("{pending_prefix}{}", split.text);
            pending_prefix.clear();
        }
        merged.push(split);
    }
    if !pending_prefix.is_empty() {
        merged.push(ParsedCardSplit { bar_ref: None, text: pending_prefix });
    }
    let out = merged;

    // 覆盖率：漏句（哪怕只是开头/结尾）不达标即整体拒绝，退化为完整单卡
    let non_whitespace = |text: &str| text.chars().filter(|ch| !ch.is_whitespace()).count();
    let raw_chars = non_whitespace(raw_text);
    let covered: usize = out.iter().map(|split| non_whitespace(&split.text)).sum();
    if (covered as f64) < raw_chars as f64 * 0.85 {
        return Err(format!(
            "split coverage {covered}/{raw_chars} chars below 85% — content would be lost"
        ));
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

    fn provider(preset: Option<&str>, thinking: Option<&str>) -> AiProvider {
        AiProvider {
            id: "p1".into(),
            name: "test".into(),
            base_url: "https://api.example.com/v1".into(),
            api_key: String::new(),
            preset_id: preset.map(str::to_string),
            default_model: Some("m1".into()),
            models: vec![],
            is_default: true,
            thinking: thinking.map(str::to_string),
            concurrency: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    fn body_after(preset: Option<&str>, thinking: Option<&str>) -> Value {
        let mut body = json!({});
        let provider = provider(preset, thinking);
        apply_thinking_param(&mut body, &provider, "m1");
        body
    }

    #[test]
    fn thinking_maps_per_preset() {
        // OpenRouter：等级走 reasoning.effort，on→high、off→none
        assert_eq!(body_after(Some("openrouter"), Some("low")), json!({ "reasoning": { "effort": "low" } }));
        assert_eq!(body_after(Some("openrouter"), Some("on")), json!({ "reasoning": { "effort": "high" } }));
        assert_eq!(body_after(Some("openrouter"), Some("off")), json!({ "reasoning": { "effort": "none" } }));
        // OpenAI：reasoning_effort；off 不发字段
        assert_eq!(body_after(Some("openai"), Some("high")), json!({ "reasoning_effort": "high" }));
        assert_eq!(body_after(Some("openai"), Some("on")), json!({ "reasoning_effort": "medium" }));
        assert_eq!(body_after(Some("openai"), Some("off")), json!({}));
        // GLM：thinking.type 开关 + reasoning_effort 分档（GLM-5.2+）；
        // GLM-5.3 系列强制思考，off 降级为 enabled+low（官方 400：不支持关闭）
        assert_eq!(body_after(Some("zhipu"), Some("on")), json!({ "thinking": { "type": "enabled" } }));
        assert_eq!(body_after(Some("zhipu"), Some("low")), json!({ "thinking": { "type": "enabled" }, "reasoning_effort": "low" }));
        assert_eq!(body_after(Some("zhipu"), Some("high")), json!({ "thinking": { "type": "enabled" }, "reasoning_effort": "high" }));
        assert_eq!(body_after(Some("zhipu"), Some("off")), json!({ "thinking": { "type": "disabled" } }));
        {
            let mut body = json!({});
            let mut provider = provider(Some("zhipu"), Some("off"));
            provider.models = vec![AiModelConfig { id: "glm-5.3-flash".into(), thinking: Some("off".into()) }];
            apply_thinking_param(&mut body, &provider, "glm-5.3-flash");
            assert_eq!(body, json!({ "thinking": { "type": "enabled" }, "reasoning_effort": "low" }));
        }
        // 千问：开关 + budget 分档
        assert_eq!(body_after(Some("qwen"), Some("low")), json!({ "enable_thinking": true, "thinking_budget": 2048 }));
        assert_eq!(body_after(Some("qwen"), Some("medium")), json!({ "enable_thinking": true, "thinking_budget": 8192 }));
        assert_eq!(body_after(Some("qwen"), Some("off")), json!({ "enable_thinking": false }));
        assert_eq!(body_after(Some("siliconflow"), Some("off")), json!({ "enable_thinking": false }));
    }

    #[test]
    fn thinking_absent_cases_send_nothing() {
        // auto/未设置 → 不发；不支持思考参数的 preset → 不发
        for preset in [None, Some("deepseek"), Some("gemini"), Some("groq"), Some("moonshot"), Some("anthropic"), Some("custom"), Some("ollama")] {
            for level in [None, Some("on"), Some("off"), Some("high")] {
                assert_eq!(body_after(preset, level), json!({}));
            }
        }
        assert_eq!(body_after(Some("openrouter"), None), json!({}));
    }

    #[test]
    fn model_level_thinking_overrides_provider() {
        let mut base = provider(Some("openrouter"), Some("off"));
        base.models = vec![
            AiModelConfig { id: "m1".into(), thinking: Some("high".into()) },
            AiModelConfig { id: "m2".into(), thinking: None },
            AiModelConfig { id: "m3".into(), thinking: None },
        ];
        let mut body = json!({});
        apply_thinking_param(&mut body, &base, "m1");
        assert_eq!(body, json!({ "reasoning": { "effort": "high" } }));
        // m2 无覆盖 → 继承 provider 的 off
        let mut body = json!({});
        apply_thinking_param(&mut body, &base, "m2");
        assert_eq!(body, json!({ "reasoning": { "effort": "none" } }));
    }

    #[test]
    fn normalize_backfills_models_from_legacy_file() {
        let mut legacy = provider(Some("zhipu"), Some("auto-ish"));
        legacy.default_model = Some("glm-4.6".into());
        legacy.thinking = Some("bogus".into());
        let normalized = normalize(legacy).unwrap();
        assert_eq!(normalized.models, vec![AiModelConfig { id: "glm-4.6".into(), thinking: None }]);
        assert_eq!(normalized.default_model.as_deref(), Some("glm-4.6"));
        assert_eq!(normalized.thinking, None);
        // default_model 不在列表里 → 修正为首个模型
        let mut stale = provider(None, None);
        stale.default_model = Some("gone".into());
        stale.models = vec![AiModelConfig { id: "kept".into(), thinking: None }];
        let normalized = normalize(stale).unwrap();
        assert_eq!(normalized.default_model.as_deref(), Some("kept"));
    }

    #[test]
    fn network_settings_mode_migration() {
        // 显式 mode 优先
        let explicit = NetworkSettings {
            mode: Some("off".into()),
            proxy_url: String::new(),
            proxy_enabled: true,
            effective_proxy_url: None,
        };
        assert_eq!(explicit.proxy_mode(), ProxyMode::Off);
        // 0.3.2 旧文件：proxyEnabled=true → manual，否则默认跟随系统
        let legacy_on = NetworkSettings { mode: None, proxy_url: String::new(), proxy_enabled: true, effective_proxy_url: None };
        assert_eq!(legacy_on.proxy_mode(), ProxyMode::Manual);
        let legacy_off = NetworkSettings { mode: None, proxy_url: String::new(), proxy_enabled: false, effective_proxy_url: None };
        assert_eq!(legacy_off.proxy_mode(), ProxyMode::System);
        // 未知 mode 字符串按旧字段迁移
        let bogus = NetworkSettings { mode: Some("bogus".into()), proxy_url: String::new(), proxy_enabled: true, effective_proxy_url: None };
        assert_eq!(bogus.proxy_mode(), ProxyMode::Manual);
    }

    #[test]
    fn system_proxy_url_ignores_disabled_registry_residue() {
        let proxy = |enable: bool| sysproxy::Sysproxy {
            enable,
            host: "127.0.0.1".into(),
            port: 7890,
            bypass: String::new(),
        };
        // Windows 关掉系统代理开关后注册表 ProxyServer 仍残留旧值——enable=false 必须视为无代理
        assert_eq!(system_proxy_url(&proxy(false)), None);
        assert_eq!(system_proxy_url(&proxy(true)).as_deref(), Some("http://127.0.0.1:7890"));
        // 地址为空或端口 0 → 无代理
        assert_eq!(
            system_proxy_url(&sysproxy::Sysproxy { enable: true, host: "  ".into(), port: 7890, bypass: String::new() }),
            None
        );
        assert_eq!(
            system_proxy_url(&sysproxy::Sysproxy { enable: true, host: "127.0.0.1".into(), port: 0, bypass: String::new() }),
            None
        );
    }

    #[test]
    fn retryable_errors_are_network_like() {
        assert!(is_retryable_error("request failed: 请求超时：服务端长时间无响应"));
        assert!(is_retryable_error("read response failed: 读取响应中断"));
        assert!(is_retryable_error("模型服务返回 502 Bad Gateway: upstream"));
        assert!(is_retryable_error("provider returned empty content"));
    }

    #[test]
    fn config_and_parse_errors_are_not_retried() {
        assert!(!is_retryable_error("模型服务返回 401 Unauthorized（API Key 无效或无权限，去 设置 → AI 检查）:"));
        assert!(!is_retryable_error("模型服务返回 400 Bad Request: bad json"));
        assert!(!is_retryable_error("invalid response: expected value"));
        assert!(!is_retryable_error("response has no message content"));
        assert!(!is_retryable_error("model output is not JSON: trailing chars"));
    }

    #[test]
    fn source_chain_joins_up_to_three_levels() {
        use std::fmt;

        #[derive(Debug)]
        struct Level(&'static str, Option<Box<dyn std::error::Error + 'static>>);
        impl fmt::Display for Level {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}", self.0)
            }
        }
        impl std::error::Error for Level {
            fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
                self.1.as_deref().map(|cause| cause as &(dyn std::error::Error + 'static))
            }
        }

        let leaf = Level("dns error: lookup failed", None);
        let mid = Level("connect failed", Some(Box::new(leaf)));
        let root = Level("hyper client error", Some(Box::new(mid)));
        let deep = Level("outermost", Some(Box::new(root)));
        // 三层取满，第四层截断
        assert_eq!(join_source_chain(&deep), "hyper client error ← connect failed ← dns error: lookup failed");

        let single = Level("only me", None);
        assert_eq!(join_source_chain(&single), "");
    }

    #[test]
    fn http_status_hint_maps_common_codes() {
        assert!(http_status_hint(reqwest::StatusCode::UNAUTHORIZED).contains("API Key"));
        assert!(http_status_hint(reqwest::StatusCode::TOO_MANY_REQUESTS).contains("限流"));
        assert!(http_status_hint(reqwest::StatusCode::NOT_FOUND).contains("Base URL"));
        assert_eq!(http_status_hint(reqwest::StatusCode::BAD_REQUEST), "");
        assert!(http_error_message(reqwest::StatusCode::from_u16(502).unwrap(), "upstream down")
            .starts_with("模型服务返回 502"));
    }

    fn content_of(chunks: &[StreamChunk]) -> String {
        chunks
            .iter()
            .filter(|chunk| chunk.kind == StreamChunkKind::Content)
            .map(|chunk| chunk.text.as_str())
            .collect()
    }

    #[test]
    fn sse_accumulator_handles_multi_event_chunks_and_done() {
        let mut acc = SseAccumulator::new();
        // 注释行/事件行忽略；一个 chunk 内多事件 + 空行分隔；[DONE] 终止后续解析
        let chunks = acc.push_chunk(
            b": keepalive\nevent: message\ndata: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: {\"choices\":[{\"delta\":{}}]}\ndata: [DONE]\ndata: {\"choices\":[{\"delta\":{\"content\":\"ignored\"}}]}\n",
        );
        assert_eq!(content_of(&chunks), "hi");
        assert!(acc.done);
        assert_eq!(acc.content, "hi");
    }

    #[test]
    fn sse_accumulator_splits_lines_and_multibyte_across_chunks() {
        let mut acc = SseAccumulator::new();
        // 「观察」是 UTF-8 多字节字符，故意从字符中间切开验证按字节缓冲；
        // 行没结束（无换行）时整段留在缓冲，不产出
        let line = b"data: {\"choices\":[{\"delta\":{\"content\":\"\xe8\xa7\x82\xe5\xaf\x9f\"}}]}\n".to_vec();
        let split = line.len() - 2;
        let d1 = acc.push_chunk(&line[..split]);
        assert_eq!(content_of(&d1), "");
        let d2 = acc.push_chunk(&line[split..]);
        assert_eq!(content_of(&d2), "观察");
        assert_eq!(acc.content, "观察");
        assert!(!acc.done);
    }

    #[test]
    fn sse_accumulator_captures_reasoning_and_usage() {
        let mut acc = SseAccumulator::new();
        // 思考增量（reasoning_content）单独成 chunk；usage 帧记入统计不产出
        let chunks = acc.push_chunk(
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"思考\"}}]}\ndata: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\ndata: {\"choices\":[],\"usage\":{\"completion_tokens\":42,\"total_tokens\":100}}\ndata: [DONE]\n".as_bytes(),
        );
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].kind, StreamChunkKind::Reasoning);
        assert_eq!(chunks[0].text, "思考");
        assert_eq!(content_of(&chunks), "ok");
        assert_eq!(acc.reasoning, "思考");
        assert_eq!(acc.completion_tokens, Some(42));
        assert_eq!(acc.total_tokens, Some(100));
        assert!(acc.done);
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
    fn summary_parse_validates_and_caps() {
        let content = r#"{"overview":"BTC 区间突破追多，测距止盈 1:1 离场","narrative":"第一段。\n\n第二段。","highlights":["计划止损 90364，最终止损 90820（有移动）","说过要在 91000 挂止盈，成交记录里没有"],"missing":["复盘卡缺失"]}"#;
        let summary = parse_summary(content).unwrap();
        assert_eq!(summary["overview"], "BTC 区间突破追多，测距止盈 1:1 离场");
        assert_eq!(summary["schemaVersion"], SUMMARY_PROMPT_VERSION);
        assert_eq!(summary["highlights"].as_array().unwrap().len(), 2);
        assert_eq!(summary["missing"].as_array().unwrap().len(), 1);

        // overview 缺失 → 报错；空字段数组容忍
        let content = r#"{"overview":"  ","narrative":"","highlights":[]}"#;
        assert!(parse_summary(content).is_err());
        let content = r#"{"overview":"观察记录","narrative":"","highlights":null,"missing":null}"#;
        let summary = parse_summary(content).unwrap();
        assert_eq!(summary["highlights"].as_array().unwrap().len(), 0);
        assert_eq!(summary["narrative"], "");
    }

    #[test]
    fn parse_card_splits_validates_substrings_and_bar_monotonic() {
        let raw = "120号K线收了长上影，上沿又一次失败。下一根直接砸下来，跌破昨天低点。再下一根缩量回抽，空头没有跟随。整体我打算继续等。";
        let content = r#"{"cards":[
            {"barRef":120,"text":"120号K线收了长上影，上沿又一次失败。"},
            {"barRef":121,"text":"下一根直接砸下来，跌破昨天低点。"},
            {"barRef":119,"text":"再下一根缩量回抽，空头没有跟随。"},
            {"barRef":null,"text":"整体我打算继续等。"}
        ]}"#;
        let splits = parse_card_splits(content, raw).unwrap();
        // 非递增 barRef（119<121）置空、null 段无锚点 → 都并入前一张卡（0.3.5）
        assert_eq!(splits.len(), 2);
        assert_eq!(splits[0].bar_ref, Some(120));
        assert_eq!(splits[0].text, "120号K线收了长上影，上沿又一次失败。");
        assert_eq!(splits[1].bar_ref, Some(121));
        assert_eq!(
            splits[1].text,
            "下一根直接砸下来，跌破昨天低点。再下一根缩量回抽，空头没有跟随。整体我打算继续等。"
        );

        // 非逐字片段 → 整体 Err（调用方退化为单卡）
        let bad = r#"{"cards":[{"barRef":1,"text":"模型编的话"}]}"#;
        assert!(parse_card_splits(bad, raw).is_err());
        // 乱序片段（后段先于前段出现）→ Err
        let reversed = r#"{"cards":[{"barRef":2,"text":"再下一根缩量回抽，空头没有跟随。"},{"barRef":1,"text":"120号K线收了长上影，上沿又一次失败。"}]}"#;
        assert!(parse_card_splits(reversed, raw).is_err());
        assert!(parse_card_splits("拆不了", raw).is_err());
    }

    #[test]
    fn parse_card_splits_merges_unanchored_commentary_into_previous_card() {
        // 交易者提到一根 K 线后追加市场分析（含假设句式），模型仍按「独立评述」拆出
        // 无锚点段 → 机械合并回锚点卡；开头引子拼进第一张锚点卡。
        let raw = "先说下整体结构，这里是个区间。120号K线收了长上影。如果下一根突破上沿我就放弃观察。下一根直接吞掉了上影。这根的量能不错，说明空头真的来了。";
        let content = r#"{"cards":[
            {"barRef":null,"text":"先说下整体结构，这里是个区间。"},
            {"barRef":120,"text":"120号K线收了长上影。"},
            {"barRef":null,"text":"如果下一根突破上沿我就放弃观察。"},
            {"barRef":121,"text":"下一根直接吞掉了上影。"},
            {"barRef":null,"text":"这根的量能不错，说明空头真的来了。"}
        ]}"#;
        let splits = parse_card_splits(content, raw).unwrap();
        assert_eq!(splits.len(), 2);
        assert_eq!(splits[0].bar_ref, Some(120));
        assert_eq!(
            splits[0].text,
            "先说下整体结构，这里是个区间。120号K线收了长上影。如果下一根突破上沿我就放弃观察。"
        );
        assert_eq!(splits[1].bar_ref, Some(121));
        assert_eq!(splits[1].text, "下一根直接吞掉了上影。这根的量能不错，说明空头真的来了。");

        // 全部无锚点 → 维持一张卡（文本按原文顺序拼接）
        let calm = r#"{"cards":[
            {"barRef":null,"text":"先说下整体结构，"},
            {"barRef":null,"text":"这里是个区间。"}
        ]}"#;
        let single = parse_card_splits(calm, "先说下整体结构，这里是个区间。").unwrap();
        assert_eq!(single.len(), 1);
        assert_eq!(single[0].bar_ref, None);
        assert_eq!(single[0].text, "先说下整体结构，这里是个区间。");
    }

    #[test]
    fn parse_card_splits_rejects_low_coverage() {
        let raw = "120号K线收了长上影，上沿又一次失败。下一根直接砸下来，跌破昨天低点。再下一根缩量回抽，空头没有跟随。整体来看我打算继续等待，等一个更干净也更明确的入场位置再动手。";
        // 模型漏掉最后一句（约三分之一内容）→ 覆盖率不足 → 整体 Err，调用方退化为完整单卡
        let content = r#"{"cards":[
            {"barRef":120,"text":"120号K线收了长上影，上沿又一次失败。"},
            {"barRef":121,"text":"下一根直接砸下来，跌破昨天低点。"},
            {"barRef":122,"text":"再下一根缩量回抽，空头没有跟随。"}
        ]}"#;
        let err = parse_card_splits(content, raw).unwrap_err();
        assert!(err.contains("coverage"), "coverage error, got: {err}");

        // 全覆盖版本通过（结尾无锚点段并入 122 那张卡）
        let full = r#"{"cards":[
            {"barRef":120,"text":"120号K线收了长上影，上沿又一次失败。"},
            {"barRef":121,"text":"下一根直接砸下来，跌破昨天低点。"},
            {"barRef":122,"text":"再下一根缩量回抽，空头没有跟随。"},
            {"barRef":null,"text":"整体来看我打算继续等待，等一个更干净也更明确的入场位置再动手。"}
        ]}"#;
        let splits = parse_card_splits(full, raw).unwrap();
        assert_eq!(splits.len(), 3);
        assert!(splits[2].text.ends_with("再动手。"));
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

    /// 验证流式链路：增量回调逐段吐出，累积全文与非流式解析结果一致。
    /// 运行：CAIRN_AI_E2E=1 cargo test --manifest-path src-tauri/Cargo.toml ai_chat_e2e -- --ignored --nocapture
    #[test]
    #[ignore]
    fn ai_chat_e2e_stream() {
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
        let content_deltas: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
        let reasoning_len = std::sync::atomic::AtomicUsize::new(0);
        let collect = |chunk: &StreamChunk| {
            match chunk.kind {
                StreamChunkKind::Reasoning => { reasoning_len.fetch_add(chunk.text.chars().count(), std::sync::atomic::Ordering::Relaxed); }
                StreamChunkKind::Content => content_deltas.lock().unwrap().push(chunk.text.clone()),
            }
        };
        let outcome = tauri::async_runtime::block_on(async {
            chat_completion_stream_with_retry(provider, model, &messages, &collect).await
        })
        .expect("stream chat completion");
        let delta_count = content_deltas.lock().unwrap().len();
        let joined = content_deltas.lock().unwrap().concat();
        println!(
            "--- stream output ({} deltas, {} chars, {} reasoning chars, tokens {:?}) ---\n{}\n------------------------",
            delta_count,
            outcome.content.chars().count(),
            outcome.reasoning_chars,
            outcome.completion_tokens,
            outcome.content
        );
        assert!(!outcome.content.trim().is_empty());
        assert_eq!(outcome.reasoning_chars, reasoning_len.load(std::sync::atomic::Ordering::Relaxed));
        // 增量拼接必须等于返回的累积全文（流式完整性）
        assert_eq!(joined, outcome.content);
        // 真流式（event-stream）应产生多个增量；单增量说明 provider 降级了，也允许但打印提示
        if delta_count <= 1 {
            println!("NOTE: provider likely ignored stream=true and returned one body");
        }
        let analysis = parse_analysis("entry", text, &outcome.content, model, &provider.id, 0)
            .expect("parse analysis from streamed content");
        assert!(!analysis["labels"].as_array().unwrap().is_empty());
    }

    #[test]
    fn summary_markup_sanitizer_keeps_valid_and_strips_invalid() {
        // 合法标注原样保留
        assert_eq!(
            sanitize_summary_markup("前置**关键**中置!!问题!!后置==亮点=="),
            "前置**关键**中置!!问题!!后置==亮点=="
        );
        // 未闭合：剥记号留文字
        assert_eq!(sanitize_summary_markup("说了**没关"), "说了没关");
        // 空内容：剥记号
        assert_eq!(sanitize_summary_markup("前****后"), "前后");
        // 跨行：剥记号留文字
        assert_eq!(sanitize_summary_markup("**第一段\n\n第二段**结尾"), "第一段\n\n第二段结尾");
        // 嵌套：外层剥记号，内层完整则保留；内容顺序不乱
        assert_eq!(sanitize_summary_markup("**外层==内层==收尾**"), "外层==内层==收尾");
    }

    #[test]
    fn summary_markup_sanitizer_caps_marked_segments() {
        let mut text = String::new();
        for i in 0..25 {
            text.push_str(&format!("**标注{i}**",));
        }
        let sanitized = sanitize_summary_markup(&text);
        assert_eq!(sanitized.matches("**").count(), 40, "20 处保留（40 个记号），其余剥掉");
        for i in 20..25 {
            assert!(sanitized.contains(&format!("标注{i}")), "超量标注的文字保留");
        }
    }

    #[test]
    fn summary_parse_passes_markup_through_sanitizer() {
        let content = r#"{"overview":"BTC 区间突破追多","narrative":"计划**止损 90364**；!!仓位过重!!；==按计划离场==；未闭合的 **记号","highlights":["要点"],"missing":[]}"#;
        let summary = parse_summary(content).unwrap();
        assert_eq!(summary["narrative"].as_str().unwrap(), "计划**止损 90364**；!!仓位过重!!；==按计划离场==；未闭合的 记号");
    }

    #[test]
    fn parse_trade_tags_validates_vocabulary_and_quotes() {
        let cards = vec![
            ("card-1".to_string(), "这一段是震荡区间，我做的突破追多，仓位有点过重了".to_string()),
            ("card-2".to_string(), "我决定把止损移动到 90820.36".to_string()),
        ];
        let vocabulary = vec!["突破".to_string(), "仓位过重".to_string(), "FOMO".to_string()];
        let content = r#"{"suggestions":[],"tradeTags":[
            {"cardIndex":1,"name":"突破","quote":"我做的突破追多","signal":"区间上沿突破"},
            {"cardIndex":1,"name":"仓位过重","quote":"止损移动到 90820.36"},
            {"cardIndex":1,"name":"不在词表","quote":"震荡区间"},
            {"name":"FOMO","quote":"不存在的原话"},
            {"cardIndex":1,"name":"突破","quote":"我做的突破追多"},
            {"name":"仓位过重"},
            {"name":"FOMO","quote":"仓位有点过重了"}
        ]}"#;
        let tags = parse_trade_tags(content, &cards, &vocabulary);
        // 命中：突破（cardIndex 定位）；FOMO（无 cardIndex → 全文找第一张含原话的卡）。
        // 丢弃：quote 与 cardIndex 错位（仓位过重@card-1）、不在词表、quote 无处可寻、
        // 缺 quote、重名去重。
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].name, "突破");
        assert_eq!(tags[0].card_id, "card-1");
        assert_eq!(tags[0].signal.as_deref(), Some("区间上沿突破"));
        assert_eq!(tags[1].name, "FOMO");
        assert_eq!(tags[1].card_id, "card-1");
        // 空词表 → 直接空（用户还没建标签）
        assert!(parse_trade_tags(content, &cards, &[]).is_empty());
        // 输出里没有 tradeTags 字段 → 空，不报错
        assert!(parse_trade_tags(r#"{"suggestions":[]}"#, &cards, &vocabulary).is_empty());
    }
}
