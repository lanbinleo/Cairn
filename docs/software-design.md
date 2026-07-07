# Cairn Software Design

## Product

Cairn is a local-first desktop app for personal trade journaling and review. It supports manual traders who import TradingView exports, group executions into trades, review charts and timelines, add notes, and analyze performance across backtest and live accounts.

The workflow is:

1. Create Account, Period, and Symbol.
2. Import TradingView trade exports, optional chart CSV, and reference images.
3. Review grouped Trades, Executions, TradeEvents, charts, tags, and notes.
4. Analyze account/period/trade performance.
5. Manage imported chart data and coverage.
6. Create notes that mention trades and trade images.
7. Back up or restore local data.

## Platform

- Frontend: React, Vite, TypeScript.
- Desktop runtime: Tauri 2.
- Native layer: Rust commands for SQLite, backup, tray, diagnostics, and packaging.
- Storage: local SQLite under the Tauri app data directory.
- Cloud: no runtime dependency. Future cloud sync is backup/restore only, not realtime multi-device sync.

## Design Principles

- Execution is the only成交事实来源. PnL, average prices, realized quantity, duration, and equity are computed from Executions.
- Time is UTC epoch milliseconds. Bar index is only a UI helper.
- Imports do not overwrite existing trades. Cairn creates global trade `seq` values and keeps `sourceRef` for imported rows.
- Backtest and live trading use the same model. `Account.kind` distinguishes them.
- Deletes are soft deletes in normal app operations through `deleted_at`.
- Local-first storage keeps app data available without network. File attachments are represented as attachment entities and should move toward app-data relative paths.

## Domain Model

```text
Account
  Period
    Trade
      Execution
      TradeEvent

Shared:
  Symbol
  TagDef
  Note
  Attachment
  ImportBatch
  ChartData
```

### Account

An Account is a trading environment or ledger, not necessarily a broker account. It contains initial balance, currency, and `kind` (`backtest` or `live`).

### Period

A Period is a user-created collection of trades under an Account. It has chart-time range and optional real-time range. Import order does not need to match chart time.

### Trade

A Trade represents one complete position lifecycle. `seq` is a global display number. A Trade contains its direction, status, tags, source reference, optional import batch, and hydrated child arrays for UI use.

### Execution

Execution is an atomic fill:

- `action`: `entry`, `scale-in`, `scale-out`, `exit`
- `orderType`: `market`, `limit`, `stop`, `stop-limit`, `stop-loss`, `take-profit`, `trailing-stop`
- `quantity` is always positive.
- Buy/sell meaning is derived from `Trade.direction` and `Execution.action`.
- `signal` preserves TradingView text.
- `sourceRef` preserves imported row identity.

### TradeEvent

TradeEvent is a non-fill timeline item:

- `sl-set`
- `sl-moved`
- `tp-set`
- `tp-moved`
- `note`

SL/TP movement is not an Execution. It appears on the trade timeline and chart markers without changing position or PnL.

### ImportBatch

An ImportBatch records one import operation. Imported trades store `importBatchId`, allowing a batch rollback to soft-delete all trades from that batch and mark the batch as `rolled-back`.

### Attachment

Attachment records files related to trades, notes, or import batches. Current UI can still render existing reference image strings; the target format is app-data relative file paths.

## SQLite Storage

The Rust layer stores app data in entity tables:

- `accounts`
- `periods`
- `symbols`
- `trades`
- `executions`
- `trade_events`
- `chart_data`
- `notes`
- `tag_defs`
- `attachments`
- `import_batches`

Normal entities store JSON payloads plus indexed ownership columns. `trades` are persisted as a parent row, while `executions`, `trade_events`, `chart_data`, and reference-image attachments are stored as child entities. `read_state` hydrates those child rows back into nested Trade objects for the React store.

Normal deletes set `deleted_at`. Full backup restore and clear-data actions replace the local database contents.

## Import Rules

TradingView import supports:

- Chinese and English field names.
- Workbook sheet auto-selection by required trade columns.
- TradingView `交易编号` / `Trade #` grouping when present.
- Net-position grouping when trade number is unavailable.
- UTC time parsing from Excel serials, ISO strings, Unix seconds, or Unix milliseconds.
- Order type inference from order type + signal text.
- Source row preservation through `sourceRef`.
- Optional chart CSV parsing for OHLC, EMA, and plotted SL/TP level columns.
- Chart SL/TP level changes become TradeEvents if the chart time overlaps the trade.

If trade export and chart CSV time ranges do not overlap, chart data is not attached to that trade.

## Metrics

Metrics are computed from Executions:

- Average entry/exit
- Realized PnL
- R multiple when initial stop loss is present
- Equity curve
- Win/loss/breakeven
- Profit factor
- Expectancy
- Max drawdown

Trade status is stored for workflow, but closed-trade metrics still derive from execution data. Trade detail editing can update executions, tags, initial stop loss, notes, and reference images.

## Tags

TagDef is global. Trade tags reference tag names. Renaming a TagDef updates all Trade tag references. Trade list filtering uses AND semantics across selected tags.

Note tags are text tags and are independent from Trade tags.

## Notes

Notes are Markdown text with mentions encoded as:

- `[[trade:ID]]`
- `[[image:URL_OR_PATH]]`

The editor supports creating and editing notes. Typing `@` in the note editor opens a mention picker for trades and trade reference images. Inline trade mentions render with trade-aware UI.

## Chart Data

Trade chart data is imported from TradingView OHLC CSV/Excel files. Chart data can be imported together with trades or independently from the Data page. The import flow asks the user to choose the K-line timeframe instead of inferring it from the file name.

Supported display timeframes are 5 minutes, 15 minutes, 1 hour, 4 hours, and 1 day. Existing legacy `chartBars` data is treated as 5-minute chart data. If a trade does not have data for the selected timeframe, the detail page shows an empty chart state instead of generated synthetic bars.

The Data page keeps two layers:

- `chart_imports`: one record per source file import, including parse status, timeframe, row counts, inserted rows, duplicate rows, conflicts, source file path, and UTC start/end.
- `chart_candles`: the normalized K-line library keyed by symbol, timeframe, and bar time. Duplicate imports do not create duplicate candles.

Imported source files are copied into the app data directory under `attachments/chart-data/` with normalized file names that include symbol, timeframe, and UTC range. The Data page can show monthly coverage, missing intervals, trade coverage checks, and export the normalized candle library.

Data coverage is organized around the selected timeframe. The Data page prioritizes missing symbol/month combinations so the user can work through incomplete data first. Coverage summaries are derived from expected bar timestamps for the timeframe and the candles already present in `chart_candles`.

Chart candle imports are persisted in batches through a native command so a multi-thousand-row CSV does not issue one frontend-to-Rust write per candle.

## Backup

Cairn exports JSON backups containing a version, timestamp, backup kind, and full hydrated state. Restore replaces the local app state.

Manual backups are written under the app data directory in `backups/`. Automatic backups are written to `backups/auto/`. The app creates one automatic backup the first time local state is loaded each local calendar day, and keeps the latest seven daily automatic backups. Automatic retention does not remove manual exports.

Future backup sync should upload encrypted backup files only; it should not become realtime sync.

## Packaging

The app is built with Tauri 2. Windows bundles are MSI and NSIS. macOS packaging remains a target; Linux can be built when convenient but is not a primary user target.

## Historical References

Legacy V0/backend/mock-data references live under `reference/legacy/`. They are not part of the active app architecture.
