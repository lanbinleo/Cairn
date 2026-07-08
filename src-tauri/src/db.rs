use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use chrono::{Duration, Local, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::paths;

const AUTO_BACKUP_RETENTION_DAYS: i64 = 7;
const AUTO_BACKUP_PREFIX: &str = "cairn-auto-backup-";
const AUTO_BACKUP_SUFFIX: &str = ".json";
const CURRENT_SCHEMA_VERSION: i64 = 2;

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

        INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
          VALUES (1, 'entity_tables', unixepoch() * 1000);

        INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
          VALUES (2, 'attachment_file_references', unixepoch() * 1000);
        "#,
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn backup_before_migration_if_needed(app: &AppHandle, conn: &Connection) -> Result<Option<PathBuf>, String> {
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
    let table = table_for_collection(collection)?;
    conn.execute(
        &format!("UPDATE {table} SET deleted_at = unixepoch() * 1000 WHERE id = ?1"),
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
        "version": 2,
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

fn save_record_in_tx(conn: &Connection, collection: &str, id: &str, data: Value) -> Result<(), String> {
    match collection {
        "trades" => save_trade(conn, id, data),
        "accounts" | "periods" | "symbols" | "notes" | "tagDefs" | "importBatches" | "attachments" | "chartImports" | "chartCandles" => {
            save_simple_record(conn, collection, id, data)
        }
        other => Err(format!("unknown collection: {other}")),
    }
}

fn save_simple_record(conn: &Connection, collection: &str, id: &str, data: Value) -> Result<(), String> {
    let table = table_for_collection(collection)?;
    let json = serde_json::to_string(&data).map_err(|err| err.to_string())?;
    let (col_a, val_a) = match collection {
        "periods" => ("account_id", data.get("accountId").and_then(Value::as_str)),
        "tagDefs" => ("name", data.get("name").and_then(Value::as_str)),
        "attachments" => ("owner_type", data.get("ownerType").and_then(Value::as_str)),
        "chartImports" | "chartCandles" => ("symbol_id", data.get("symbolId").and_then(Value::as_str)),
        "importBatches" => ("status", data.get("status").and_then(Value::as_str)),
        _ => ("id", None),
    };
    let (col_b, val_b) = match collection {
        "attachments" => ("owner_id", data.get("ownerId").and_then(Value::as_str)),
        "chartImports" | "chartCandles" => ("timeframe", data.get("timeframe").and_then(Value::as_str)),
        _ => ("id", None),
    };
    let (col_c, val_c) = match collection {
        "attachments" => ("kind", data.get("kind").and_then(Value::as_str)),
        "chartImports" => ("status", data.get("status").and_then(Value::as_str)),
        _ => ("id", None),
    };
    let (col_d, val_d) = match collection {
        "attachments" => ("relative_path", data.get("relativePath").and_then(Value::as_str)),
        _ => ("id", None),
    };

    match collection {
        "periods" | "tagDefs" | "importBatches" => conn.execute(
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

fn save_trade(conn: &Connection, id: &str, data: Value) -> Result<(), String> {
    soft_delete_trade_data_children(conn, id)?;

    let mut trade_data = data.clone();
    let executions = trade_data.get_mut("executions").map(Value::take).unwrap_or(Value::Array(vec![]));
    let events = trade_data.get_mut("events").map(Value::take).unwrap_or(Value::Array(vec![]));
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
            let dataset = serde_json::json!({ "id": format!("chart-{id}"), "tradeId": id, "bars": bars });
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
        accounts: read_simple_collection(conn, "accounts")?,
        periods: read_simple_collection(conn, "periods")?,
        trades: read_trades(conn)?,
        symbols: read_simple_collection(conn, "symbols")?,
        notes: read_simple_collection(conn, "notes")?,
        tag_defs: read_simple_collection(conn, "tagDefs")?,
        import_batches: read_simple_collection(conn, "importBatches")?,
        attachments: read_simple_collection(conn, "attachments")?,
        chart_imports: read_simple_collection(conn, "chartImports")?,
        chart_candles: read_simple_collection(conn, "chartCandles")?,
    })
}

fn read_simple_collection(conn: &Connection, collection: &str) -> Result<Vec<Value>, String> {
    let table = table_for_collection(collection)?;
    let mut stmt = conn
        .prepare(&format!("SELECT data FROM {table} WHERE deleted_at IS NULL ORDER BY id ASC"))
        .map_err(|err| err.to_string())?;
    read_json_rows(&mut stmt, [])
}

fn read_trades(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT id, data FROM trades WHERE deleted_at IS NULL ORDER BY seq ASC, id ASC")
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
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
                map.insert("referenceImages".to_string(), Value::Array(legacy_reference_images));
            }
            if let Some(bars) = chart_bars {
                map.insert("chartBars".to_string(), Value::Array(bars));
            }
        }
        trades.push(trade);
    }
    Ok(trades)
}

fn read_child_rows(conn: &Connection, table: &str, trade_id: &str, order: &str) -> Result<Vec<Value>, String> {
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

fn read_json_rows(stmt: &mut rusqlite::Statement<'_>, params: impl rusqlite::Params) -> Result<Vec<Value>, String> {
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
        "import_batches",
        "attachments",
        "chart_imports",
        "chart_candles",
    ];
    let mut total = 0;
    for table in tables {
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
        "UPDATE attachments SET deleted_at = unixepoch() * 1000 WHERE owner_type = 'trade' AND owner_id = ?1",
        params![id],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn clear_trade_tables(conn: &Connection) -> Result<(), String> {
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
}
