# Cairn 0.1.1 Release Notes

## Highlights

- Replaced the Cairn logo assets with the new stacked-stone mark on a dark blue background.
- Added daily automatic local backups. Cairn now creates one backup the first time local state is loaded each local calendar day.
- Added automatic backup retention. The app keeps the latest seven daily automatic backups and removes older automatic backups.
- Added trade detail actions for copying trade IDs, creating linked notes, editing executions, and managing trade reference images.
- Added note editor `@` mentions for trades and trade images.
- Added explicit K-line timeframe selection during import and per-trade chart timeframe switching.
- Removed synthetic fallback chart rendering from trade details; missing timeframe data now shows an empty chart state.
- Added a Data page for independent chart-data import, import history, normalized candle storage, monthly coverage, missing interval review, trade coverage checks, and CSV export.
- Archived imported chart source files under the app data directory in `attachments/chart-data/`.
- Added Cairn release workflow documentation and a local release check script.

## Local Data

Cairn stores production data in the Tauri app data directory, normally under the current user's app data path:

```text
%APPDATA%\app.cairn.desktop
```

Daily automatic backups are written to:

```text
backups/auto/cairn-auto-backup-YYYY-MM-DD.json
```

Manual backups remain in `backups/` and are not removed by the automatic backup retention task.

## Verification

Recommended local checks:

```powershell
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml --release --features tauri/custom-protocol
```
