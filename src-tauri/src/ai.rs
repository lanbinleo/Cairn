// AI Provider 配置：OpenAI compatible 端点的多 provider 管理。
// 凭证属于配置而非业务数据，存 app_data_dir/ai-providers.json，不进入备份。

use std::{fs, path::PathBuf, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

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
