mod db;
mod diagnostics;

use serde_json::Value;
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

pub fn run() {
    diagnostics::install_panic_hook();
    diagnostics::write_temp("Cairn process starting");

    tauri::Builder::default()
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
            load_state,
            save_record,
            delete_record,
            replace_collection,
            restore_state,
            export_backup,
            frontend_log
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Cairn");
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
