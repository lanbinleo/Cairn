# CAIRN Local App Design

## Product Shape

CAIRN is a local-first desktop trading journal. Version 1 stores data on the user's machine and does not require a cloud account.

## Runtime

- UI: React + Vite.
- Desktop: Tauri 2.
- Native commands: Rust.
- Database: SQLite in the app data directory.
- Attachments: files in the app data directory, referenced by SQLite metadata.

## Data Ownership

The local SQLite database is the source of truth. Future cloud support should be implemented as backup/restore or scheduled upload, not realtime multi-device editing.

## Command Boundary

React should call Tauri commands for:

- database reads/writes,
- file picking and imports,
- attachment storage,
- backup export/restore,
- tray/window control where needed.

React should keep presentation and temporary form state.

## Migration Policy

The original v0 screens are treated as the visual baseline. Migration work should preserve page structure and behavior unless a stage document names a new feature.
