mod api;
mod db;
mod diagnostics;
mod paths;

use std::{
    fs,
    path::{Component, Path},
};

use base64::{engine::general_purpose, Engine as _};
use serde_json::Value;
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, State, WindowEvent,
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

#[tauri::command]
fn regenerate_api_token(app: AppHandle) -> Result<api::ApiStatus, String> {
    api::regenerate_token(&app)
}

#[tauri::command]
fn set_api_config(app: AppHandle, enabled: bool, port: u16) -> Result<api::ApiStatus, String> {
    api::set_config(&app, enabled, port)
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
            regenerate_api_token,
            set_api_config,
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
