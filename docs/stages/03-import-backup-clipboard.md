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

## Verification

- Parser tests for CSV examples.
- Backup export and restore roundtrip test.
- Clipboard handler typechecks and stores through the same attachment path.
