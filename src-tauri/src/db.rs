use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

pub struct Db {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub accounts: Vec<Value>,
    pub periods: Vec<Value>,
    pub trades: Vec<Value>,
    pub symbols: Vec<Value>,
    pub notes: Vec<Value>,
    pub tag_defs: Vec<Value>,
}

pub fn init(app: &AppHandle) -> Result<Db, String> {
    let db_path = database_path(app)?;
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
    migrate(&conn)?;
    Ok(Db {
        conn: Mutex::new(conn),
    })
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    Ok(dir.join("cairn.sqlite3"))
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS records (
          collection TEXT NOT NULL,
          id TEXT NOT NULL,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER,
          PRIMARY KEY (collection, id)
        );

        CREATE INDEX IF NOT EXISTS idx_records_collection
          ON records(collection)
          WHERE deleted_at IS NULL;

        INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
          VALUES (1, 'document_records', unixepoch() * 1000);
        "#,
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

pub fn load_or_seed(db: &Db, seed: AppState) -> Result<AppState, String> {
    let mut conn = db.conn.lock().map_err(|err| err.to_string())?;
    let existing: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM records WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;

    if existing == 0 {
        let tx = conn.transaction().map_err(|err| err.to_string())?;
        seed_collection(&tx, "accounts", &seed.accounts)?;
        seed_collection(&tx, "periods", &seed.periods)?;
        seed_collection(&tx, "trades", &seed.trades)?;
        seed_collection(&tx, "symbols", &seed.symbols)?;
        seed_collection(&tx, "notes", &seed.notes)?;
        seed_collection(&tx, "tagDefs", &seed.tag_defs)?;
        tx.commit().map_err(|err| err.to_string())?;
    }

    read_state(&conn)
}

pub fn save_record(db: &Db, collection: &str, id: &str, data: Value) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|err| err.to_string())?;
    let json = serde_json::to_string(&data).map_err(|err| err.to_string())?;
    conn.execute(
        r#"
        INSERT INTO records(collection, id, data, updated_at, deleted_at)
        VALUES (?1, ?2, ?3, unixepoch() * 1000, NULL)
        ON CONFLICT(collection, id) DO UPDATE SET
          data = excluded.data,
          updated_at = excluded.updated_at,
          deleted_at = NULL
        "#,
        params![collection, id, json],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

pub fn delete_record(db: &Db, collection: &str, id: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|err| err.to_string())?;
    conn.execute(
        "UPDATE records SET deleted_at = unixepoch() * 1000 WHERE collection = ?1 AND id = ?2",
        params![collection, id],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

pub fn replace_collection(db: &Db, collection: &str, records: Vec<Value>) -> Result<(), String> {
    let mut conn = db.conn.lock().map_err(|err| err.to_string())?;
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute("DELETE FROM records WHERE collection = ?1", params![collection])
        .map_err(|err| err.to_string())?;
    seed_collection(&tx, collection, &records)?;
    tx.commit().map_err(|err| err.to_string())?;
    Ok(())
}

pub fn restore_state(db: &Db, state: AppState) -> Result<AppState, String> {
    let mut conn = db.conn.lock().map_err(|err| err.to_string())?;
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute("DELETE FROM records", [])
        .map_err(|err| err.to_string())?;
    seed_collection(&tx, "accounts", &state.accounts)?;
    seed_collection(&tx, "periods", &state.periods)?;
    seed_collection(&tx, "trades", &state.trades)?;
    seed_collection(&tx, "symbols", &state.symbols)?;
    seed_collection(&tx, "notes", &state.notes)?;
    seed_collection(&tx, "tagDefs", &state.tag_defs)?;
    tx.commit().map_err(|err| err.to_string())?;
    read_state(&conn)
}

pub fn export_backup(app: &AppHandle, db: &Db) -> Result<PathBuf, String> {
    let conn = db.conn.lock().map_err(|err| err.to_string())?;
    let state = read_state(&conn)?;
    let now = now_ms();
    let backup = serde_json::json!({
        "version": 1,
        "exportedAt": now,
        "state": state,
    });
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("backups");
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let path = dir.join(format!("cairn-backup-{now}.json"));
    let content = serde_json::to_string_pretty(&backup).map_err(|err| err.to_string())?;
    fs::write(&path, content).map_err(|err| err.to_string())?;
    Ok(path)
}

fn seed_collection(conn: &Connection, collection: &str, records: &[Value]) -> Result<(), String> {
    for record in records {
        let id = record_id(record)?;
        let json = serde_json::to_string(record).map_err(|err| err.to_string())?;
        conn.execute(
            r#"
            INSERT INTO records(collection, id, data, updated_at, deleted_at)
            VALUES (?1, ?2, ?3, unixepoch() * 1000, NULL)
            ON CONFLICT(collection, id) DO UPDATE SET
              data = excluded.data,
              updated_at = excluded.updated_at,
              deleted_at = NULL
            "#,
            params![collection, id, json],
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn read_state(conn: &Connection) -> Result<AppState, String> {
    Ok(AppState {
        accounts: read_collection(conn, "accounts")?,
        periods: read_collection(conn, "periods")?,
        trades: read_collection(conn, "trades")?,
        symbols: read_collection(conn, "symbols")?,
        notes: read_collection(conn, "notes")?,
        tag_defs: read_collection(conn, "tagDefs")?,
    })
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn read_collection(conn: &Connection, collection: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT data FROM records WHERE collection = ?1 AND deleted_at IS NULL ORDER BY id ASC",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![collection], |row| {
            let data: String = row.get(0)?;
            Ok(data)
        })
        .map_err(|err| err.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        let data = row.map_err(|err| err.to_string())?;
        out.push(serde_json::from_str(&data).map_err(|err| err.to_string())?);
    }
    Ok(out)
}

fn record_id(record: &Value) -> Result<&str, String> {
    record
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "record is missing string id".to_string())
}
