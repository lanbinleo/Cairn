use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::AppHandle;

use crate::paths;

/// 日志级别（0.3.6 起行内结构化，写文件全量保留，过滤在读取端做）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    fn as_str(self) -> &'static str {
        match self {
            Level::Info => "info",
            Level::Warn => "warn",
            Level::Error => "error",
        }
    }
}

/// 当日常开的日志文件，跨日自动切新文件。写入共用一把锁，锁内只有 writeln + flush。
struct DailyFile {
    dir: PathBuf,
    date: String,
    file: Option<fs::File>,
}

impl DailyFile {
    fn new(dir: PathBuf) -> Self {
        Self { dir, date: String::new(), file: None }
    }

    fn write_line(&mut self, line: &str) {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        if self.file.is_none() || self.date != today {
            self.date = today.clone();
            self.file = None;
            let _ = fs::create_dir_all(&self.dir);
            self.file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(self.dir.join(format!("cairn-{today}.log")))
                .ok();
        }
        if let Some(file) = self.file.as_mut() {
            let _ = writeln!(file, "{line}");
            let _ = file.flush();
        }
    }
}

static LOGGER: Mutex<Option<DailyFile>> = Mutex::new(None);
static LOGS_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

/// setup 时初始化：解析日志目录、清理超期文件、写启动分隔头。
/// 未初始化（单测二进制 / 启动极早期）时 log() 落 temp 兜底。
pub fn init(app: &AppHandle) {
    let dir = match paths::app_data_dir(app) {
        Ok(base) => base.join("logs"),
        Err(_) => return,
    };
    if let Ok(mut guard) = LOGS_DIR.lock() {
        *guard = Some(dir.clone());
    }
    prune_old_logs(&dir, KEEP_DAYS);
    let version = app.package_info().version.to_string();
    let os = std::env::consts::OS;
    log(
        Level::Info,
        "app",
        format!("==== Cairn {version} 启动（{os}）· 数据目录见 get_logs_dir ===="),
    );
}

/// 日志保留天数（按日期文件名判断，超出删除）。
const KEEP_DAYS: usize = 14;

/// 写一条结构化日志：`[时间] [级别] [来源] 消息`。
pub fn log(level: Level, target: &str, message: impl AsRef<str>) {
    let line = format_line(level, target, message.as_ref());
    let mut guard = match LOGGER.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    if guard.is_none() {
        let dir = LOGS_DIR.lock().ok().and_then(|g| g.clone());
        *guard = dir.map(DailyFile::new);
    }
    if let Some(logger) = guard.as_mut() {
        logger.write_line(&line);
    } else {
        write_temp(&line);
    }
}

fn format_line(level: Level, target: &str, message: &str) -> String {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f %:z");
    if target.is_empty() {
        format!("[{timestamp}] [{}] {}", level.as_str(), message)
    } else {
        format!("[{timestamp}] [{}] [{}] {}", level.as_str(), target, message)
    }
}

pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let message = match info.location() {
            Some(location) => format!(
                "panic at {}:{}:{} - {info}",
                location.file(),
                location.line(),
                location.column()
            ),
            None => format!("panic - {info}"),
        };
        // 已初始化则进当天日志文件；未初始化（启动极早期）由 log() 落 temp
        log(Level::Error, "panic", message);
    }));
}

/// 兼容旧调用点：无级别无来源的 info 日志（app 参数仅为签名兼容）。
pub fn app_log(app: &AppHandle, message: impl AsRef<str>) {
    let _ = app;
    log(Level::Info, "", message);
}

pub fn logs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(paths::app_data_dir(app)?.join("logs"))
}

/// 列出可用日志日期（新的在前）。文件名 = cairn-YYYY-MM-DD.log。
pub fn list_log_files(app: &AppHandle) -> Result<Vec<String>, String> {
    let dir = logs_dir(app)?;
    let mut dates: Vec<String> = fs::read_dir(&dir)
        .map_err(|err| err.to_string())?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            Some(name.strip_prefix("cairn-")?.strip_suffix(".log")?.to_string())
        })
        .collect();
    dates.sort_by(|a, b| b.cmp(a));
    Ok(dates)
}

pub fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// 日期参数必须是 YYYY-MM-DD（前端下拉的产物）——拒绝任何携带路径分隔符的
/// 输入，避免 read/clear 拼路径时越出 logs 目录。
fn valid_log_date(date: &str) -> bool {
    let bytes = date.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

/// 读取指定日期（None = 当天）的日志，超过 512KB 只取尾部（从完整行开始）。
pub fn read_log(app: &AppHandle, date: Option<&str>) -> Result<String, String> {
    let dir = logs_dir(app)?;
    let today = today();
    let date = date.unwrap_or(&today);
    if !valid_log_date(date) {
        return Err(format!("invalid date: {date} (expect YYYY-MM-DD)"));
    }
    let path = dir.join(format!("cairn-{date}.log"));
    if !path.exists() {
        return Ok(String::new());
    }
    let bytes = fs::read(&path).map_err(|err| err.to_string())?;
    const TAIL: usize = 512 * 1024;
    if bytes.len() <= TAIL {
        return String::from_utf8(bytes).map_err(|err| err.to_string());
    }
    let cut = bytes.len() - TAIL;
    let start = bytes[cut..]
        .iter()
        .position(|byte| *byte == b'\n')
        .map(|offset| cut + offset + 1)
        .unwrap_or(cut);
    Ok(String::from_utf8_lossy(&bytes[start..]).to_string())
}

/// 清空指定日期（None = 当天）的日志文件。
pub fn clear_log(app: &AppHandle, date: Option<&str>) -> Result<(), String> {
    let dir = logs_dir(app)?;
    let today = today();
    let date = date.unwrap_or(&today);
    if !valid_log_date(date) {
        return Err(format!("invalid date: {date} (expect YYYY-MM-DD)"));
    }
    let path = dir.join(format!("cairn-{date}.log"));
    if path.exists() {
        fs::write(&path, b"").map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// 只保留最近 keep 个日志文件（按文件名日期，新的在前；解析不出的文件不动）。
pub fn prune_old_logs(dir: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut files: Vec<(String, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let date = name.strip_prefix("cairn-")?.strip_suffix(".log")?.to_string();
            Some((date, entry.path()))
        })
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in files.into_iter().skip(keep) {
        let _ = fs::remove_file(path);
    }
}

/// 兜底输出：日志目录不可用（启动极早期 / 初始化失败）时写 temp。
pub fn write_temp(message: impl AsRef<str>) {
    let path = std::env::temp_dir().join("Cairn-startup.log");
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{}", message.as_ref());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_logs_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join("cairn-diagnostics-tests")
            .join(format!("{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn format_line_carries_level_and_target() {
        let line = format_line(Level::Warn, "ai", "拆卡降级");
        assert!(line.starts_with("[20"));
        assert!(line.contains("] [warn] [ai] 拆卡降级"));
        let plain = format_line(Level::Info, "", "普通");
        assert!(plain.contains("] [info] 普通"));
        assert!(!plain.contains("[]"));
    }

    #[test]
    fn daily_file_writes_into_dated_log() {
        let dir = temp_logs_dir("daily");
        let mut daily = DailyFile::new(dir.clone());
        daily.write_line("first");
        daily.write_line("second");
        let path = dir.join(format!("cairn-{}.log", today()));
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, "first\nsecond\n");
    }

    #[test]
    fn log_date_validation_rejects_path_inputs() {
        assert!(valid_log_date("2026-08-31"));
        assert!(!valid_log_date("2026-8-31"));
        assert!(!valid_log_date("../2026-08-31"));
        assert!(!valid_log_date("2026-08-31/../../x"));
        assert!(!valid_log_date(""));
        assert!(!valid_log_date("2026-08-31.log"));
    }

    #[test]
    fn prune_keeps_newest_files_only() {
        let dir = temp_logs_dir("prune");
        for date in ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"] {
            fs::write(dir.join(format!("cairn-{date}.log")), b"x").unwrap();
        }
        fs::write(dir.join("unrelated.txt"), b"x").unwrap();
        prune_old_logs(&dir, 2);
        let mut remaining: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        remaining.sort();
        assert_eq!(
            remaining,
            vec!["cairn-2026-08-03.log", "cairn-2026-08-04.log", "unrelated.txt"]
        );
    }
}
