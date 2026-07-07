mod db;

use serde_json::Value;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
fn app_ready() -> &'static str {
    "ok"
}

#[tauri::command]
fn load_state(db: State<'_, db::Db>, seed: db::AppState) -> Result<db::AppState, String> {
    db::load_or_seed(&db, seed)
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

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let db = db::init(app.handle())?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_ready,
            load_state,
            save_record,
            delete_record,
            replace_collection,
            restore_state,
            export_backup
        ])
        .run(tauri::generate_context!())
        .expect("failed to run CAIRN");
}
