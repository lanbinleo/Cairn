use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use chrono::{Duration, Local, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::paths;

const AUTO_BACKUP_RETENTION_DAYS: i64 = 7;
const AUTO_BACKUP_PREFIX: &str = "cairn-auto-backup-";
const AUTO_BACKUP_SUFFIX: &str = ".json";
const CURRENT_SCHEMA_VERSION: i64 = 3;

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub(crate) fn conn(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.conn.lock().map_err(|err| err.to_string())
    }

    /// 单测专用：用现成 Connection 包装（生产路径只经 `init` 创建）。
    #[cfg(test)]
    pub(crate) fn from_conn(conn: Connection) -> Self {
        Self { conn: Mutex::new(conn) }
    }
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
    #[serde(default)]
    pub cases: Vec<Value>,
    #[serde(default)]
    pub case_cards: Vec<Value>,
    #[serde(default)]
    pub case_bindings: Vec<Value>,
    #[serde(default)]
    pub case_tag_defs: Vec<Value>,
    pub import_batches: Vec<Value>,
    pub attachments: Vec<Value>,
    pub chart_imports: Vec<Value>,
    pub chart_candles: Vec<Value>,
}

pub fn init(app: &AppHandle) -> Result<Db, String> {
    let db_path = database_path(app)?;
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
    let migration_backup = backup_before_migration_if_needed(app, &conn)?;
    if let Err(err) = migrate(&conn) {
        let backup_hint = migration_backup
            .as_ref()
            .map(|path| format!(" A pre-migration backup was created at {}.", path.display()))
            .unwrap_or_default();
        return Err(format!("{err}.{backup_hint}"));
    }
    Ok(Db {
        conn: Mutex::new(conn),
    })
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = paths::app_data_dir(app)?;
    Ok(dir.join("cairn.sqlite3"))
}

pub(crate) fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS periods (
          id TEXT PRIMARY KEY,
          account_id TEXT,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS symbols (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS trades (
          id TEXT PRIMARY KEY,
          account_id TEXT,
          period_id TEXT,
          symbol_id TEXT,
          seq INTEGER,
          import_batch_id TEXT,
          source_ref TEXT,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS executions (
          id TEXT PRIMARY KEY,
          trade_id TEXT NOT NULL,
          source_ref TEXT,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS trade_events (
          id TEXT PRIMARY KEY,
          trade_id TEXT NOT NULL,
          type TEXT,
          source_ref TEXT,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS chart_data (
          id TEXT PRIMARY KEY,
          trade_id TEXT NOT NULL,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS chart_imports (
          id TEXT PRIMARY KEY,
          symbol_id TEXT,
          timeframe TEXT,
          status TEXT,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS chart_candles (
          id TEXT PRIMARY KEY,
          symbol_id TEXT,
          timeframe TEXT,
          time INTEGER,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS tag_defs (
          id TEXT PRIMARY KEY,
          name TEXT,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS cases (
          id TEXT PRIMARY KEY,
          account_id TEXT,
          period_id TEXT,
          status TEXT,
          provenance TEXT,
          title TEXT,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS case_cards (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          phase TEXT,
          raw_text TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS case_trade_bindings (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          trade_id TEXT NOT NULL,
          source TEXT,
          data TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS case_tag_defs (
          id TEXT PRIMARY KEY,
          name TEXT,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS case_tag_links (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          tag_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS attachments (
          id TEXT PRIMARY KEY,
          owner_type TEXT,
          owner_id TEXT,
          kind TEXT,
          relative_path TEXT,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS import_batches (
          id TEXT PRIMARY KEY,
          status TEXT,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_periods_account ON periods(account_id) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_trades_period ON trades(period_id) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_trades_import_batch ON trades(import_batch_id) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_executions_trade ON executions(trade_id) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_trade_events_trade ON trade_events(trade_id) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_chart_data_trade ON chart_data(trade_id) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_chart_imports_symbol_timeframe ON chart_imports(symbol_id, timeframe) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_chart_candles_symbol_timeframe_time ON chart_candles(symbol_id, timeframe, time) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments(owner_type, owner_id) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_cases_period ON cases(period_id) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_case_cards_case ON case_cards(case_id) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_case_tag_links_case ON case_tag_links(case_id) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_case_tag_links_tag ON case_tag_links(tag_id) WHERE deleted_at IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_case_tag_links_active_unique ON case_tag_links(case_id, tag_id) WHERE deleted_at IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_case_bindings_active_case ON case_trade_bindings(case_id) WHERE deleted_at IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_case_bindings_active_trade ON case_trade_bindings(trade_id) WHERE deleted_at IS NULL;

        INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
          VALUES (1, 'entity_tables', unixepoch() * 1000);

        INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
          VALUES (2, 'attachment_file_references', unixepoch() * 1000);

        INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
          VALUES (3, 'case_records', unixepoch() * 1000);
        "#,
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn backup_before_migration_if_needed(
    app: &AppHandle,
    conn: &Connection,
) -> Result<Option<PathBuf>, String> {
    if !table_exists(conn, "schema_migrations")? {
        return Ok(None);
    }
    let version = current_schema_version(conn)?;
    if version >= CURRENT_SCHEMA_VERSION || active_entity_count(conn)? == 0 {
        return Ok(None);
    }

    let dir = paths::app_data_dir(app)?.join("backups").join("migrations");
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let path = dir.join(format!(
        "cairn-migration-backup-v{version}-to-v{CURRENT_SCHEMA_VERSION}-{}.json",
        now_ms()
    ));
    write_backup_file(conn, path.clone(), "pre-migration")?;
    Ok(Some(path))
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;
    Ok(exists > 0)
}

fn current_schema_version(conn: &Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )
    .map_err(|err| err.to_string())
}

pub fn load_or_seed(db: &Db, seed: AppState) -> Result<AppState, String> {
    let mut conn = db.conn.lock().map_err(|err| err.to_string())?;
    if active_entity_count(&conn)? == 0 {
        let tx = conn.transaction().map_err(|err| err.to_string())?;
        seed_collection(&tx, "accounts", &seed.accounts)?;
        seed_collection(&tx, "periods", &seed.periods)?;
        seed_collection(&tx, "trades", &seed.trades)?;
        seed_collection(&tx, "symbols", &seed.symbols)?;
        seed_collection(&tx, "notes", &seed.notes)?;
        seed_collection(&tx, "tagDefs", &seed.tag_defs)?;
        seed_collection(&tx, "caseTagDefs", &seed.case_tag_defs)?;
        seed_collection(&tx, "cases", &seed.cases)?;
        seed_collection(&tx, "caseCards", &seed.case_cards)?;
        seed_collection(&tx, "caseBindings", &seed.case_bindings)?;
        seed_collection(&tx, "importBatches", &seed.import_batches)?;
        seed_collection(&tx, "attachments", &seed.attachments)?;
        seed_collection(&tx, "chartImports", &seed.chart_imports)?;
        seed_collection(&tx, "chartCandles", &seed.chart_candles)?;
        tx.commit().map_err(|err| err.to_string())?;
    }

    read_state(&conn)
}

pub fn save_record(db: &Db, collection: &str, id: &str, data: Value) -> Result<(), String> {
    let mut conn = db.conn.lock().map_err(|err| err.to_string())?;
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    save_record_in_tx(&tx, collection, id, data)?;
    tx.commit().map_err(|err| err.to_string())?;
    Ok(())
}

pub fn save_records(db: &Db, collection: &str, records: Vec<Value>) -> Result<(), String> {
    let mut conn = db.conn.lock().map_err(|err| err.to_string())?;
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    for record in records {
        let id = record_id(&record)?.to_string();
        save_record_in_tx(&tx, collection, &id, record)?;
    }
    tx.commit().map_err(|err| err.to_string())?;
    Ok(())
}

pub fn delete_record(db: &Db, collection: &str, id: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|err| err.to_string())?;
    if collection == "trades" {
        soft_delete_trade(&conn, id)?;
        return Ok(());
    }
    if collection == "cases" {
        soft_delete_case(&conn, id)?;
        return Ok(());
    }
    if collection == "caseCards" {
        return soft_delete_case_card(&conn, id);
    }
    if collection == "caseTagDefs" {
        conn.execute(
            "UPDATE case_tag_links SET deleted_at = unixepoch() * 1000 WHERE tag_id = ?1 AND deleted_at IS NULL",
            params![id],
        )
        .map_err(|err| err.to_string())?;
    }
    let table = table_for_collection(collection)?;
    conn.execute(
        &format!("UPDATE {table} SET deleted_at = unixepoch() * 1000 WHERE id = ?1"),
        params![id],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

/// 软删除单张卡片（附件随删）。GUI 删除与 AI 重拆替换共用同一段语义。
pub(crate) fn soft_delete_case_card(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE case_cards SET deleted_at = unixepoch() * 1000 WHERE id = ?1",
        params![id],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
        "UPDATE attachments SET deleted_at = unixepoch() * 1000 WHERE owner_type = 'case-card' AND owner_id = ?1",
        params![id],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

pub fn replace_collection(db: &Db, collection: &str, records: Vec<Value>) -> Result<(), String> {
    let mut conn = db.conn.lock().map_err(|err| err.to_string())?;
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    if collection == "trades" {
        clear_trade_tables(&tx)?;
    } else {
        let table = table_for_collection(collection)?;
        tx.execute(&format!("DELETE FROM {table}"), [])
            .map_err(|err| err.to_string())?;
    }
    seed_collection(&tx, collection, &records)?;
    tx.commit().map_err(|err| err.to_string())?;
    Ok(())
}

pub fn restore_state(db: &Db, state: AppState) -> Result<AppState, String> {
    let mut conn = db.conn.lock().map_err(|err| err.to_string())?;
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    clear_all_tables(&tx)?;
    seed_collection(&tx, "accounts", &state.accounts)?;
    seed_collection(&tx, "periods", &state.periods)?;
    seed_collection(&tx, "trades", &state.trades)?;
    seed_collection(&tx, "symbols", &state.symbols)?;
    seed_collection(&tx, "notes", &state.notes)?;
    seed_collection(&tx, "tagDefs", &state.tag_defs)?;
    seed_collection(&tx, "caseTagDefs", &state.case_tag_defs)?;
    seed_collection(&tx, "cases", &state.cases)?;
    seed_collection(&tx, "caseCards", &state.case_cards)?;
    seed_collection(&tx, "caseBindings", &state.case_bindings)?;
    seed_collection(&tx, "importBatches", &state.import_batches)?;
    seed_collection(&tx, "attachments", &state.attachments)?;
    seed_collection(&tx, "chartImports", &state.chart_imports)?;
    seed_collection(&tx, "chartCandles", &state.chart_candles)?;
    tx.commit().map_err(|err| err.to_string())?;
    read_state(&conn)
}

pub fn export_backup(app: &AppHandle, db: &Db) -> Result<PathBuf, String> {
    let conn = db.conn.lock().map_err(|err| err.to_string())?;
    let now = now_ms();
    let dir = paths::app_data_dir(app)?.join("backups");
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let path = dir.join(format!("cairn-backup-{now}.json"));
    write_backup_file(&conn, path.clone(), "manual")?;
    Ok(path)
}

pub fn export_daily_backup_if_due(app: &AppHandle, db: &Db) -> Result<Option<PathBuf>, String> {
    let today = Local::now().date_naive();
    let dir = paths::app_data_dir(app)?.join("backups").join("auto");
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    prune_auto_backups(&dir, today)?;

    let path = dir.join(auto_backup_file_name(today));
    if path.exists() {
        return Ok(None);
    }

    let conn = db.conn.lock().map_err(|err| err.to_string())?;
    write_backup_file(&conn, path.clone(), "daily-auto")?;
    prune_auto_backups(&dir, today)?;
    Ok(Some(path))
}

fn write_backup_file(conn: &Connection, path: PathBuf, backup_kind: &str) -> Result<(), String> {
    let state = read_state(conn)?;
    let now = now_ms();
    let backup = serde_json::json!({
        "version": 3,
        "backupKind": backup_kind,
        "exportedAt": now,
        "state": state,
    });
    let content = serde_json::to_string_pretty(&backup).map_err(|err| err.to_string())?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, content).map_err(|err| err.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|err| err.to_string())?;
    Ok(())
}

fn prune_auto_backups(dir: &PathBuf, today: NaiveDate) -> Result<(), String> {
    let oldest_kept = today - Duration::days(AUTO_BACKUP_RETENTION_DAYS - 1);
    let mut backups = Vec::new();

    for entry in fs::read_dir(dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(date) = auto_backup_date(file_name) else {
            continue;
        };

        if date < oldest_kept {
            let _ = fs::remove_file(path);
        } else {
            backups.push((date, path));
        }
    }

    backups.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in backups
        .into_iter()
        .skip(AUTO_BACKUP_RETENTION_DAYS as usize)
    {
        let _ = fs::remove_file(path);
    }

    Ok(())
}

fn auto_backup_file_name(date: NaiveDate) -> String {
    format!(
        "{AUTO_BACKUP_PREFIX}{}{AUTO_BACKUP_SUFFIX}",
        date.format("%Y-%m-%d")
    )
}

fn auto_backup_date(file_name: &str) -> Option<NaiveDate> {
    let date = file_name
        .strip_prefix(AUTO_BACKUP_PREFIX)?
        .strip_suffix(AUTO_BACKUP_SUFFIX)?;
    NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
}

fn seed_collection(conn: &Connection, collection: &str, records: &[Value]) -> Result<(), String> {
    for record in records {
        let id = record_id(record)?;
        save_record_in_tx(conn, collection, id, record.clone())?;
    }
    Ok(())
}

pub(crate) fn save_record_in_tx(
    conn: &Connection,
    collection: &str,
    id: &str,
    data: Value,
) -> Result<(), String> {
    match collection {
        "trades" => save_trade(conn, id, data),
        "cases" => save_case(conn, id, data),
        "caseCards" => save_case_card(conn, id, data),
        "caseBindings" => save_case_binding(conn, id, data),
        "accounts" | "periods" | "symbols" | "notes" | "tagDefs" | "caseTagDefs"
        | "importBatches" | "attachments" | "chartImports" | "chartCandles" => {
            save_simple_record(conn, collection, id, data)
        }
        other => Err(format!("unknown collection: {other}")),
    }
}

fn save_simple_record(
    conn: &Connection,
    collection: &str,
    id: &str,
    data: Value,
) -> Result<(), String> {
    let table = table_for_collection(collection)?;
    let json = serde_json::to_string(&data).map_err(|err| err.to_string())?;
    let (col_a, val_a) = match collection {
        "periods" => ("account_id", data.get("accountId").and_then(Value::as_str)),
        "tagDefs" => ("name", data.get("name").and_then(Value::as_str)),
        "caseTagDefs" => ("name", data.get("name").and_then(Value::as_str)),
        "attachments" => ("owner_type", data.get("ownerType").and_then(Value::as_str)),
        "chartImports" | "chartCandles" => {
            ("symbol_id", data.get("symbolId").and_then(Value::as_str))
        }
        "importBatches" => ("status", data.get("status").and_then(Value::as_str)),
        _ => ("id", None),
    };
    let (col_b, val_b) = match collection {
        "attachments" => ("owner_id", data.get("ownerId").and_then(Value::as_str)),
        "chartImports" | "chartCandles" => {
            ("timeframe", data.get("timeframe").and_then(Value::as_str))
        }
        _ => ("id", None),
    };
    let (col_c, val_c) = match collection {
        "attachments" => ("kind", data.get("kind").and_then(Value::as_str)),
        "chartImports" => ("status", data.get("status").and_then(Value::as_str)),
        _ => ("id", None),
    };
    let (col_d, val_d) = match collection {
        "attachments" => (
            "relative_path",
            data.get("relativePath").and_then(Value::as_str),
        ),
        _ => ("id", None),
    };

    match collection {
        "periods" | "tagDefs" | "caseTagDefs" | "importBatches" => conn.execute(
            &format!(
                "INSERT INTO {table}(id, {col_a}, data, updated_at, deleted_at)
                 VALUES (?1, ?2, ?3, unixepoch() * 1000, NULL)
                 ON CONFLICT(id) DO UPDATE SET {col_a}=excluded.{col_a}, data=excluded.data, updated_at=excluded.updated_at, deleted_at=NULL"
            ),
            params![id, val_a, json],
        ),
        "attachments" => conn.execute(
            &format!(
                "INSERT INTO {table}(id, {col_a}, {col_b}, {col_c}, {col_d}, data, updated_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, unixepoch() * 1000, NULL)
                 ON CONFLICT(id) DO UPDATE SET {col_a}=excluded.{col_a}, {col_b}=excluded.{col_b}, {col_c}=excluded.{col_c}, {col_d}=excluded.{col_d}, data=excluded.data, updated_at=excluded.updated_at, deleted_at=NULL"
            ),
            params![id, val_a, val_b, val_c, val_d, json],
        ),
        "chartImports" => conn.execute(
            &format!(
                "INSERT INTO {table}(id, {col_a}, {col_b}, {col_c}, data, updated_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, unixepoch() * 1000, NULL)
                 ON CONFLICT(id) DO UPDATE SET {col_a}=excluded.{col_a}, {col_b}=excluded.{col_b}, {col_c}=excluded.{col_c}, data=excluded.data, updated_at=excluded.updated_at, deleted_at=NULL"
            ),
            params![id, val_a, val_b, val_c, json],
        ),
        "chartCandles" => conn.execute(
            &format!(
                "INSERT INTO {table}(id, {col_a}, {col_b}, time, data, updated_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, unixepoch() * 1000, NULL)
                 ON CONFLICT(id) DO UPDATE SET {col_a}=excluded.{col_a}, {col_b}=excluded.{col_b}, time=excluded.time, data=excluded.data, updated_at=excluded.updated_at, deleted_at=NULL"
            ),
            params![id, val_a, val_b, data.get("time").and_then(Value::as_i64), json],
        ),
        _ => conn.execute(
            &format!(
                "INSERT INTO {table}(id, data, updated_at, deleted_at)
                 VALUES (?1, ?2, unixepoch() * 1000, NULL)
                 ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at, deleted_at=NULL"
            ),
            params![id, json],
        ),
    }
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn save_case(conn: &Connection, id: &str, data: Value) -> Result<(), String> {
    let json = serde_json::to_string(&data).map_err(|err| err.to_string())?;
    conn.execute(
        r#"
        INSERT INTO cases(id, account_id, period_id, status, provenance, title, data, updated_at, deleted_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, unixepoch() * 1000, NULL)
        ON CONFLICT(id) DO UPDATE SET
          account_id=excluded.account_id,
          period_id=excluded.period_id,
          status=excluded.status,
          provenance=excluded.provenance,
          title=excluded.title,
          data=excluded.data,
          updated_at=excluded.updated_at,
          deleted_at=NULL
        "#,
        params![
            id,
            data.get("accountId").and_then(Value::as_str),
            data.get("periodId").and_then(Value::as_str),
            data.get("status").and_then(Value::as_str),
            data.get("provenance").and_then(Value::as_str),
            data.get("title").and_then(Value::as_str),
            json,
        ],
    )
    .map_err(|err| err.to_string())?;

    conn.execute(
        "UPDATE case_tag_links SET deleted_at = unixepoch() * 1000 WHERE case_id = ?1 AND deleted_at IS NULL",
        params![id],
    )
    .map_err(|err| err.to_string())?;
    if let Some(tag_ids) = data.get("tagIds").and_then(Value::as_array) {
        for tag_id in tag_ids.iter().filter_map(Value::as_str) {
            let link_id = format!("{id}:{tag_id}");
            conn.execute(
                r#"
                INSERT INTO case_tag_links(id, case_id, tag_id, created_at, deleted_at)
                VALUES (?1, ?2, ?3, unixepoch() * 1000, NULL)
                ON CONFLICT(id) DO UPDATE SET case_id=excluded.case_id, tag_id=excluded.tag_id, deleted_at=NULL
                "#,
                params![link_id, id, tag_id],
            )
            .map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

pub(crate) fn save_case_card(conn: &Connection, id: &str, mut data: Value) -> Result<(), String> {
    let raw_text = data
        .get("rawText")
        .and_then(Value::as_str)
        .ok_or_else(|| "case card is missing rawText".to_string())?
        .to_string();
    if raw_text.trim().is_empty() {
        return Err("case card rawText cannot be empty".to_string());
    }
    let existing: Option<(String, Value)> = conn
        .query_row(
            "SELECT raw_text, data FROM case_cards WHERE id = ?1",
            params![id],
            |row| {
                let raw: String = row.get(0)?;
                let json: String = row.get(1)?;
                Ok((raw, serde_json::from_str(&json).unwrap_or(Value::Null)))
            },
        )
        .optional()
        .map_err(|err| err.to_string())?;

    // 错字修正允许修改 rawText，但旧值自动进入 rawTextHistory 并盖 rawTextEditedAt 时间戳；
    // REST API 层仍按幂等语义拒绝同 id 不同 rawText 的重放。
    if let Some((existing_raw, existing_data)) = existing {
        if existing_raw != raw_text {
            let mut history: Vec<Value> = existing_data
                .get("rawTextHistory")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            history.push(json!(existing_raw));
            if let Value::Object(map) = &mut data {
                map.insert("rawTextHistory".to_string(), Value::Array(history));
                map.insert(
                    "rawTextEditedAt".to_string(),
                    json!(std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0)),
                );
            }
        }
    }

    let case_id = data
        .get("caseId")
        .and_then(Value::as_str)
        .ok_or_else(|| "case card is missing caseId".to_string())?;
    let phase = data
        .get("phase")
        .and_then(Value::as_str)
        .ok_or_else(|| "case card is missing phase".to_string())?;
    let created_at = data
        .get("createdAt")
        .and_then(Value::as_i64)
        .ok_or_else(|| "case card is missing createdAt".to_string())?;
    let json = serde_json::to_string(&data).map_err(|err| err.to_string())?;
    conn.execute(
        r#"
        INSERT INTO case_cards(id, case_id, phase, raw_text, data, created_at, updated_at, deleted_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, unixepoch() * 1000, NULL)
        ON CONFLICT(id) DO UPDATE SET
          case_id=excluded.case_id,
          phase=excluded.phase,
          raw_text=excluded.raw_text,
          data=excluded.data,
          updated_at=excluded.updated_at,
          deleted_at=NULL
        "#,
        params![id, case_id, phase, raw_text, json, created_at],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn save_case_binding(conn: &Connection, id: &str, data: Value) -> Result<(), String> {
    let case_id = data
        .get("caseId")
        .and_then(Value::as_str)
        .ok_or_else(|| "case binding is missing caseId".to_string())?;
    let trade_id = data
        .get("tradeId")
        .and_then(Value::as_str)
        .ok_or_else(|| "case binding is missing tradeId".to_string())?;
    let source = data.get("source").and_then(Value::as_str);
    let bound_at = data
        .get("boundAt")
        .and_then(Value::as_i64)
        .ok_or_else(|| "case binding is missing boundAt".to_string())?;
    let existing_pair: Option<(String, String)> = conn
        .query_row(
            "SELECT case_id, trade_id FROM case_trade_bindings WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    if existing_pair
        .as_ref()
        .is_some_and(|(existing_case, existing_trade)| {
            existing_case != case_id || existing_trade != trade_id
        })
    {
        return Err(
            "case binding endpoints are immutable; create a new binding after unbinding"
                .to_string(),
        );
    }
    let json = serde_json::to_string(&data).map_err(|err| err.to_string())?;
    conn.execute(
        r#"
        INSERT INTO case_trade_bindings(id, case_id, trade_id, source, data, created_at, updated_at, deleted_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, unixepoch() * 1000, NULL)
        ON CONFLICT(id) DO UPDATE SET
          source=excluded.source,
          data=excluded.data,
          updated_at=excluded.updated_at,
          deleted_at=NULL
        "#,
        params![id, case_id, trade_id, source, json, bound_at],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn save_trade(conn: &Connection, id: &str, data: Value) -> Result<(), String> {
    soft_delete_trade_data_children(conn, id)?;

    let mut trade_data = data.clone();
    let executions = trade_data
        .get_mut("executions")
        .map(Value::take)
        .unwrap_or(Value::Array(vec![]));
    let events = trade_data
        .get_mut("events")
        .map(Value::take)
        .unwrap_or(Value::Array(vec![]));
    let chart_bars = trade_data.get_mut("chartBars").map(Value::take);

    if let Value::Object(map) = &mut trade_data {
        map.insert("executions".to_string(), Value::Array(vec![]));
        map.insert("events".to_string(), Value::Array(vec![]));
    }

    let json = serde_json::to_string(&trade_data).map_err(|err| err.to_string())?;
    conn.execute(
        r#"
        INSERT INTO trades(id, account_id, period_id, symbol_id, seq, import_batch_id, source_ref, data, updated_at, deleted_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, unixepoch() * 1000, NULL)
        ON CONFLICT(id) DO UPDATE SET
          account_id=excluded.account_id,
          period_id=excluded.period_id,
          symbol_id=excluded.symbol_id,
          seq=excluded.seq,
          import_batch_id=excluded.import_batch_id,
          source_ref=excluded.source_ref,
          data=excluded.data,
          updated_at=excluded.updated_at,
          deleted_at=NULL
        "#,
        params![
            id,
            data.get("accountId").and_then(Value::as_str),
            data.get("periodId").and_then(Value::as_str),
            data.get("symbolId").and_then(Value::as_str),
            data.get("seq").and_then(Value::as_i64),
            data.get("importBatchId").and_then(Value::as_str),
            data.get("sourceRef").and_then(Value::as_str),
            json
        ],
    )
    .map_err(|err| err.to_string())?;

    if let Value::Array(rows) = executions {
        for row in rows {
            let exec_id = record_id(&row)?;
            let json = serde_json::to_string(&row).map_err(|err| err.to_string())?;
            conn.execute(
                r#"
                INSERT INTO executions(id, trade_id, source_ref, data, updated_at, deleted_at)
                VALUES (?1, ?2, ?3, ?4, unixepoch() * 1000, NULL)
                ON CONFLICT(id) DO UPDATE SET trade_id=excluded.trade_id, source_ref=excluded.source_ref, data=excluded.data, updated_at=excluded.updated_at, deleted_at=NULL
                "#,
                params![exec_id, id, row.get("sourceRef").and_then(Value::as_str), json],
            )
            .map_err(|err| err.to_string())?;
        }
    }

    if let Value::Array(rows) = events {
        for row in rows {
            let event_id = record_id(&row)?;
            let json = serde_json::to_string(&row).map_err(|err| err.to_string())?;
            conn.execute(
                r#"
                INSERT INTO trade_events(id, trade_id, type, source_ref, data, updated_at, deleted_at)
                VALUES (?1, ?2, ?3, ?4, ?5, unixepoch() * 1000, NULL)
                ON CONFLICT(id) DO UPDATE SET trade_id=excluded.trade_id, type=excluded.type, source_ref=excluded.source_ref, data=excluded.data, updated_at=excluded.updated_at, deleted_at=NULL
                "#,
                params![
                    event_id,
                    id,
                    row.get("type").and_then(Value::as_str),
                    row.get("sourceRef").and_then(Value::as_str),
                    json
                ],
            )
            .map_err(|err| err.to_string())?;
        }
    }

    if let Some(Value::Array(bars)) = chart_bars {
        if !bars.is_empty() {
            let dataset =
                serde_json::json!({ "id": format!("chart-{id}"), "tradeId": id, "bars": bars });
            let json = serde_json::to_string(&dataset).map_err(|err| err.to_string())?;
            conn.execute(
                r#"
                INSERT INTO chart_data(id, trade_id, data, updated_at, deleted_at)
                VALUES (?1, ?2, ?3, unixepoch() * 1000, NULL)
                ON CONFLICT(id) DO UPDATE SET trade_id=excluded.trade_id, data=excluded.data, updated_at=excluded.updated_at, deleted_at=NULL
                "#,
                params![format!("chart-{id}"), id, json],
            )
            .map_err(|err| err.to_string())?;
        }
    }

    Ok(())
}

fn read_state(conn: &Connection) -> Result<AppState, String> {
    Ok(AppState {
        accounts: read_simple_collection_if_exists(conn, "accounts")?,
        periods: read_simple_collection_if_exists(conn, "periods")?,
        trades: if table_exists(conn, "trades")? {
            read_trades(conn)?
        } else {
            vec![]
        },
        symbols: read_simple_collection_if_exists(conn, "symbols")?,
        notes: read_simple_collection_if_exists(conn, "notes")?,
        tag_defs: read_simple_collection_if_exists(conn, "tagDefs")?,
        cases: read_simple_collection_if_exists(conn, "cases")?,
        case_cards: read_case_cards_if_exists(conn)?,
        case_bindings: read_simple_collection_if_exists(conn, "caseBindings")?,
        case_tag_defs: read_simple_collection_if_exists(conn, "caseTagDefs")?,
        import_batches: read_simple_collection_if_exists(conn, "importBatches")?,
        attachments: read_simple_collection_if_exists(conn, "attachments")?,
        chart_imports: read_simple_collection_if_exists(conn, "chartImports")?,
        chart_candles: read_simple_collection_if_exists(conn, "chartCandles")?,
    })
}

fn read_simple_collection_if_exists(
    conn: &Connection,
    collection: &str,
) -> Result<Vec<Value>, String> {
    let table = table_for_collection(collection)?;
    if !table_exists(conn, table)? {
        return Ok(vec![]);
    }
    read_simple_collection(conn, collection)
}

pub(crate) fn read_simple_collection(
    conn: &Connection,
    collection: &str,
) -> Result<Vec<Value>, String> {
    let table = table_for_collection(collection)?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT data FROM {table} WHERE deleted_at IS NULL ORDER BY id ASC"
        ))
        .map_err(|err| err.to_string())?;
    read_json_rows(&mut stmt, [])
}

fn read_case_cards_if_exists(conn: &Connection) -> Result<Vec<Value>, String> {
    if !table_exists(conn, "case_cards")? {
        return Ok(vec![]);
    }
    let mut stmt = conn
        .prepare(
            "SELECT data FROM case_cards WHERE deleted_at IS NULL ORDER BY created_at ASC, id ASC",
        )
        .map_err(|err| err.to_string())?;
    read_json_rows(&mut stmt, [])
}

pub(crate) fn read_case_cards_for_case(
    conn: &Connection,
    case_id: &str,
) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT data FROM case_cards WHERE case_id = ?1 AND deleted_at IS NULL ORDER BY created_at ASC, id ASC",
        )
        .map_err(|err| err.to_string())?;
    read_json_rows(&mut stmt, params![case_id])
}

pub(crate) fn read_record_by_id(
    conn: &Connection,
    collection: &str,
    id: &str,
) -> Result<Option<Value>, String> {
    let table = table_for_collection(collection)?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT data FROM {table} WHERE id = ?1 AND deleted_at IS NULL"
        ))
        .map_err(|err| err.to_string())?;
    let mut rows = stmt.query(params![id]).map_err(|err| err.to_string())?;
    match rows.next().map_err(|err| err.to_string())? {
        Some(row) => {
            let data: String = row.get(0).map_err(|err| err.to_string())?;
            Ok(Some(
                serde_json::from_str(&data).map_err(|err| err.to_string())?,
            ))
        }
        None => Ok(None),
    }
}

/// 读单笔 Trade 并合并子表（executions / trade_events），供 AI 上下文与建议检查使用。
pub(crate) fn read_trade_with_children(
    conn: &Connection,
    trade_id: &str,
) -> Result<Option<Value>, String> {
    let Some(mut trade) = read_record_by_id(conn, "trades", trade_id)? else {
        return Ok(None);
    };
    let executions = read_child_rows(conn, "executions", trade_id, "time ASC, id ASC")?;
    let events = read_child_rows(conn, "trade_events", trade_id, "time ASC, id ASC")?;
    if let Value::Object(map) = &mut trade {
        map.insert("executions".to_string(), Value::Array(executions));
        map.insert("events".to_string(), Value::Array(events));
    }
    Ok(Some(trade))
}

fn read_trades(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT id, data FROM trades WHERE deleted_at IS NULL ORDER BY seq ASC, id ASC")
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|err| err.to_string())?;

    let mut trades = Vec::new();
    for row in rows {
        let (id, data) = row.map_err(|err| err.to_string())?;
        let mut trade: Value = serde_json::from_str(&data).map_err(|err| err.to_string())?;
        let executions = read_child_rows(conn, "executions", &id, "time ASC, id ASC")?;
        let events = read_child_rows(conn, "trade_events", &id, "time ASC, id ASC")?;
        let chart_bars = read_chart_bars(conn, &id)?;
        let legacy_reference_images = read_trade_reference_images(conn, &id)?;
        if let Value::Object(map) = &mut trade {
            let has_reference_images = map
                .get("referenceImages")
                .and_then(Value::as_array)
                .is_some_and(|items| !items.is_empty());
            map.insert("executions".to_string(), Value::Array(executions));
            map.insert("events".to_string(), Value::Array(events));
            if !has_reference_images {
                map.insert(
                    "referenceImages".to_string(),
                    Value::Array(legacy_reference_images),
                );
            }
            if let Some(bars) = chart_bars {
                map.insert("chartBars".to_string(), Value::Array(bars));
            }
        }
        trades.push(trade);
    }
    Ok(trades)
}

fn read_child_rows(
    conn: &Connection,
    table: &str,
    trade_id: &str,
    order: &str,
) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT data FROM {table} WHERE trade_id = ?1 AND deleted_at IS NULL ORDER BY json_extract(data, '$.{order_key}') ASC, id ASC",
            order_key = if order.starts_with("time") { "time" } else { "id" }
        ))
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![trade_id], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let data = row.map_err(|err| err.to_string())?;
        out.push(serde_json::from_str(&data).map_err(|err| err.to_string())?);
    }
    Ok(out)
}

fn read_chart_bars(conn: &Connection, trade_id: &str) -> Result<Option<Vec<Value>>, String> {
    let data: Option<String> = conn
        .query_row(
            "SELECT data FROM chart_data WHERE trade_id = ?1 AND deleted_at IS NULL ORDER BY id ASC LIMIT 1",
            params![trade_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    let Some(data) = data else {
        return Ok(None);
    };
    let parsed: Value = serde_json::from_str(&data).map_err(|err| err.to_string())?;
    Ok(parsed.get("bars").and_then(Value::as_array).cloned())
}

fn read_trade_reference_images(conn: &Connection, trade_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT data FROM attachments WHERE owner_type = 'trade' AND owner_id = ?1 AND kind = 'reference-image' AND deleted_at IS NULL ORDER BY id ASC",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![trade_id], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let data = row.map_err(|err| err.to_string())?;
        let parsed: Value = serde_json::from_str(&data).map_err(|err| err.to_string())?;
        if let Some(path) = parsed.get("relativePath").and_then(Value::as_str) {
            out.push(Value::String(path.to_string()));
        }
    }
    Ok(out)
}

fn read_json_rows(
    stmt: &mut rusqlite::Statement<'_>,
    params: impl rusqlite::Params,
) -> Result<Vec<Value>, String> {
    let rows = stmt
        .query_map(params, |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let data = row.map_err(|err| err.to_string())?;
        out.push(serde_json::from_str(&data).map_err(|err| err.to_string())?);
    }
    Ok(out)
}

fn active_entity_count(conn: &Connection) -> Result<i64, String> {
    let tables = [
        "accounts",
        "periods",
        "symbols",
        "trades",
        "notes",
        "tag_defs",
        "cases",
        "case_cards",
        "case_trade_bindings",
        "case_tag_defs",
        "import_batches",
        "attachments",
        "chart_imports",
        "chart_candles",
    ];
    let mut total = 0;
    for table in tables {
        if !table_exists(conn, table)? {
            continue;
        }
        let count: i64 = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE deleted_at IS NULL"),
                [],
                |row| row.get(0),
            )
            .map_err(|err| err.to_string())?;
        total += count;
    }
    Ok(total)
}

fn soft_delete_case(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE cases SET deleted_at = unixepoch() * 1000 WHERE id = ?1",
        params![id],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
        "UPDATE case_cards SET deleted_at = unixepoch() * 1000 WHERE case_id = ?1",
        params![id],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
        "UPDATE case_trade_bindings SET deleted_at = unixepoch() * 1000 WHERE case_id = ?1",
        params![id],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
        "UPDATE case_tag_links SET deleted_at = unixepoch() * 1000 WHERE case_id = ?1",
        params![id],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
        "UPDATE attachments SET deleted_at = unixepoch() * 1000 WHERE (owner_type = 'case' AND owner_id = ?1) OR (owner_type = 'case-card' AND owner_id IN (SELECT id FROM case_cards WHERE case_id = ?1))",
        params![id],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn soft_delete_trade(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE trades SET deleted_at = unixepoch() * 1000 WHERE id = ?1",
        params![id],
    )
    .map_err(|err| err.to_string())?;
    soft_delete_trade_children(conn, id)
}

fn soft_delete_trade_data_children(conn: &Connection, id: &str) -> Result<(), String> {
    for table in ["executions", "trade_events", "chart_data"] {
        conn.execute(
            &format!("UPDATE {table} SET deleted_at = unixepoch() * 1000 WHERE trade_id = ?1"),
            params![id],
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn soft_delete_trade_children(conn: &Connection, id: &str) -> Result<(), String> {
    soft_delete_trade_data_children(conn, id)?;
    conn.execute(
        "UPDATE case_trade_bindings SET deleted_at = unixepoch() * 1000 WHERE trade_id = ?1 AND deleted_at IS NULL",
        params![id],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
        "UPDATE attachments SET deleted_at = unixepoch() * 1000 WHERE owner_type = 'trade' AND owner_id = ?1",
        params![id],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn clear_trade_tables(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM case_trade_bindings", [])
        .map_err(|err| err.to_string())?;
    for table in ["trades", "executions", "trade_events", "chart_data"] {
        conn.execute(&format!("DELETE FROM {table}"), [])
            .map_err(|err| err.to_string())?;
    }
    conn.execute("DELETE FROM attachments WHERE owner_type = 'trade'", [])
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn clear_all_tables(conn: &Connection) -> Result<(), String> {
    for table in [
        "case_tag_links",
        "case_trade_bindings",
        "case_cards",
        "cases",
        "case_tag_defs",
        "accounts",
        "periods",
        "symbols",
        "trades",
        "executions",
        "trade_events",
        "chart_data",
        "notes",
        "tag_defs",
        "attachments",
        "import_batches",
        "chart_imports",
        "chart_candles",
    ] {
        conn.execute(&format!("DELETE FROM {table}"), [])
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn table_for_collection(collection: &str) -> Result<&'static str, String> {
    match collection {
        "accounts" => Ok("accounts"),
        "periods" => Ok("periods"),
        "trades" => Ok("trades"),
        "symbols" => Ok("symbols"),
        "notes" => Ok("notes"),
        "tagDefs" => Ok("tag_defs"),
        "cases" => Ok("cases"),
        "caseCards" => Ok("case_cards"),
        "caseBindings" => Ok("case_trade_bindings"),
        "caseTagDefs" => Ok("case_tag_defs"),
        "importBatches" => Ok("import_batches"),
        "attachments" => Ok("attachments"),
        "chartImports" => Ok("chart_imports"),
        "chartCandles" => Ok("chart_candles"),
        other => Err(format!("unknown collection: {other}")),
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn record_id(record: &Value) -> Result<&str, String> {
    record
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "record is missing string id".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_auto_backup_dates_from_expected_file_names() {
        assert_eq!(
            auto_backup_date("cairn-auto-backup-2026-07-07.json"),
            Some(NaiveDate::from_ymd_opt(2026, 7, 7).unwrap())
        );
        assert_eq!(auto_backup_date("cairn-backup-123.json"), None);
        assert_eq!(auto_backup_date("cairn-auto-backup-bad.json"), None);
    }

    #[test]
    fn formats_auto_backup_file_names_by_local_date() {
        let date = NaiveDate::from_ymd_opt(2026, 7, 7).unwrap();
        assert_eq!(
            auto_backup_file_name(date),
            "cairn-auto-backup-2026-07-07.json"
        );
    }

    #[test]
    fn case_card_raw_text_edit_records_history() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let original = serde_json::json!({
            "id": "card-1",
            "caseId": "case-1",
            "phase": "entry",
            "rawText": "BAR38 出现二次入场做多信号",
            "barRef": 38,
            "createdAt": 1
        });
        save_record_in_tx(&conn, "caseCards", "card-1", original).unwrap();

        let corrected = serde_json::json!({
            "id": "card-1",
            "caseId": "case-1",
            "phase": "entry",
            "rawText": "BAR38 出现二次入场做多型号（错字已修正）",
            "barRef": 38,
            "createdAt": 1
        });
        save_record_in_tx(&conn, "caseCards", "card-1", corrected).unwrap();

        let stored = read_record_by_id(&conn, "caseCards", "card-1")
            .unwrap()
            .expect("card exists");
        assert_eq!(stored["rawText"], "BAR38 出现二次入场做多型号（错字已修正）");
        let history = stored["rawTextHistory"].as_array().unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0], "BAR38 出现二次入场做多信号");
        assert!(stored["rawTextEditedAt"].as_u64().unwrap() > 0);
    }

    #[test]
    fn active_case_trade_binding_is_one_to_one() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let first = serde_json::json!({
            "id": "binding-1",
            "caseId": "case-1",
            "tradeId": "trade-1",
            "source": "manual",
            "boundAt": 1
        });
        save_record_in_tx(&conn, "caseBindings", "binding-1", first).unwrap();

        let same_trade = serde_json::json!({
            "id": "binding-2",
            "caseId": "case-2",
            "tradeId": "trade-1",
            "source": "manual",
            "boundAt": 2
        });
        assert!(save_record_in_tx(&conn, "caseBindings", "binding-2", same_trade).is_err());

        let same_case = serde_json::json!({
            "id": "binding-3",
            "caseId": "case-1",
            "tradeId": "trade-2",
            "source": "manual",
            "boundAt": 3
        });
        assert!(save_record_in_tx(&conn, "caseBindings", "binding-3", same_case).is_err());
    }
}
