# Cairn 0.1.2 Release Notes

## Highlights

- Expanded trade execution editing for trade-management actions, including undecided rows, unified stop records, optional quantities, and optional anchor prices.
- Added trail-line and entry-line chart toggles on trade detail charts.
- Added stop/target trail rendering and initial take-profit support for trade review charts.
- Prevented dialogs from closing through accidental backdrop clicks, Escape, or focus loss.
- Added optional initial take-profit editing on trade details.
- Improved note mention popovers so they are not clipped by card overflow.
- Reworked the Data page around chart-data coverage timelines, canonical candle ranges, gap review, dataset import, dataset deletion, and canonical CSV export.
- Added chart dataset helpers and coverage timeline UI for reviewing symbol/timeframe data quality.
- Normalized trade and note tags, improved duplicate tag handling, and made tag rename/delete behavior safer.

## Local Data

Cairn continues to store production data under the Tauri app data directory:

```text
%APPDATA%\app.cairn.desktop
```

Existing trades, notes, and tag definitions are normalized on load where needed. Chart imports and candles remain in the local SQLite database, with imported source files stored under:

```text
attachments/chart-data/
```

## Verification

Release verification should include:

```powershell
pnpm release:check 0.1.2
pnpm release:check 0.1.2 -BuildInstaller
```

Installer artifacts are expected under:

```text
src-tauri/target/release/bundle/nsis/
src-tauri/target/release/bundle/msi/
```
