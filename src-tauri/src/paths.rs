use std::path::PathBuf;

use tauri::{AppHandle, Manager};

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("CAIRN_DATA_DIR") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    app.path().app_data_dir().map_err(|err| err.to_string())
}
