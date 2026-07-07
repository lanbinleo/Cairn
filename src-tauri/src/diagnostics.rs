use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
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
    match paths::app_data_dir(app) {
        Ok(dir) => write_file(&dir.join("cairn-startup.log"), message.as_ref()),
        Err(_) => write_temp(message.as_ref()),
    }
}

pub fn write_temp(message: impl AsRef<str>) {
    write_file(&std::env::temp_dir().join("Cairn-startup.log"), message.as_ref());
}

fn write_file(path: &Path, message: &str) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}
