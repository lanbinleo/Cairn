# Stage 02 - Local Data + SQLite

## Goal

Replace mock state with durable local SQLite data while keeping the existing UI behavior.

## Storage

- SQLite database lives in the Tauri app data directory.
- Rust owns migrations and database access.
- React talks to Rust through typed Tauri commands.

## Required Entities

- Account
- Period
- Symbol
- Trade
- Execution
- TradeEvent
- Note
- TagDef
- Attachment
- ChartData and ChartBar

## Required Behavior

- Existing edit dialogs save real data.
- Existing lists/details read real data.
- Existing tag management persists.
- Existing metrics remain compatible with the current UI.

## Verification

- Unit tests cover metric-sensitive database mapping where practical.
- App starts with seed data when the database is empty.
- CRUD commands can be exercised through automated command-level checks or Rust tests.

## Current Implementation Notes

- SQLite is owned by Rust under `src-tauri/src/db.rs`.
- The first migration creates `schema_migrations` and `records`.
- Current records are document-shaped by collection so existing TypeScript page models can be preserved during migration.
- `useCairn()` loads from SQLite through Tauri commands and writes edited records back to SQLite.
- Account, Period, Trade, Symbol, Note, and Tag create/update/delete paths now persist through the same local SQLite command layer.
