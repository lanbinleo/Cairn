# Stage 03 - Import, Backup, Clipboard

## Goal

Implement the real business workflows that are currently demos or missing.

## TradingView Import

- Accept trade export files in CSV or Excel-compatible format where feasible.
- Accept OHLC chart CSV.
- Accept optional reference image.
- Parse executions.
- Preview grouping.
- Confirm to write Trades, Executions, ChartData, ChartBars, and Attachment metadata.

Current implementation:

- Trade export files are parsed with `xlsx`, covering CSV/XLS/XLSX-compatible inputs.
- Rows are grouped into proposed trades by direction and position state.
- Confirm creates local Trade and Execution records through `useCairn()` and persists them to SQLite.
- Chart CSV and reference image file inputs exist; persistent ChartData/Attachment wiring remains to be completed.

## Backup

- Export all local data and attachment files into a portable CAIRN backup file.
- Restore from a backup file.
- Keep format documented and versioned.

Current implementation:

- Backup format is JSON with `version`, `exportedAt`, and `state`.
- Export writes to the Tauri app data `backups/` directory.
- Restore accepts either the full backup object or the raw state object.

## Clipboard Images

- Allow Ctrl+V image paste in relevant note/review image entry surfaces.
- Save pasted image as an attachment.
- Insert or associate it with the current entity without changing existing visual design.

Current implementation:

- Note creation and trade review note textareas accept pasted images.
- Pasted images are stored inline as `[[image:data:...]]` references so current note rendering and backups preserve them.
- Separate attachment-file storage remains to be completed.

## Verification

- Parser tests for CSV examples.
- Backup export and restore roundtrip test.
- Clipboard handler typechecks and stores through the same attachment path.
