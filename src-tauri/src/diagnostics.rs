use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use tauri::AppHandle;

use crate::paths;

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
        write_temp(&message);
    }));
}

pub fn app_log(app: &AppHandle, message: impl AsRef<str>) {
    match log_path(app) {
        Ok(path) => write_file(&path, message.as_ref()),
        Err(_) => write_temp(message.as_ref()),
    }
}

pub fn log_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(paths::app_data_dir(app)?.join("cairn.log"))
}

pub fn read_log(app: &AppHandle) -> Result<String, String> {
    let path = log_path(app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(path).map_err(|err| err.to_string())
}

pub fn write_temp(message: impl AsRef<str>) {
    write_file(&std::env::temp_dir().join("Cairn-startup.log"), message.as_ref());
}

fn write_file(path: &Path, message: &str) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f %:z");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}
