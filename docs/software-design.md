# Cairn Software Design

## Product

Cairn is a local-first desktop app for personal trade journaling and review. It supports manual traders who import TradingView exports, group executions into trades, review charts and timelines, add notes, and analyze performance across backtest and live accounts.

The workflow is:

1. Create Account, Period, and Symbol.
2. Import TradingView trade exports, optional chart CSV, and reference images.
3. Review grouped Trades, Executions, chart overlays, tags, and notes.
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

- Execution is the trade action timeline. Position-changing Executions are the only fill source for PnL, average prices, realized quantity, duration, and equity. Trade-management Executions describe stop/target/order changes for review and chart overlays.
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
    Case
      CaseCard

Shared:
  Symbol
  TagDef
  CaseTagDef
  CaseTradeBinding
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

Execution is an atomic trade action. It can be a position-changing fill or a trade-management update:

- Pending action: `undecided`
- Position-changing actions: `entry`, `scale-in`, `scale-out`, `exit`
- Trade-management actions: `stop`, `target-moved`, `order-edit`
- The manual UI labels `stop` as Move Stop. It records a stop-loss level change; if no previous stop exists, the first Move Stop establishes the active stop level.
- The manual UI labels `target-moved` as Move Target. It records a take-profit level change; if no previous target exists, the first Move Target establishes the active target level.
- Legacy actions `stop-set`, `stop-moved`, and `target-set` may still appear in restored/imported data. Editing and saving a trade may normalize them to `stop` or `target-moved`.
- `order-edit` records ordinary pending-order creation or modification, such as limit, stop, or stop-limit order changes. It should not be used for normal stop-loss or take-profit movement.
- `orderType`: `market`, `limit`, `stop`, `stop-limit`, `stop-loss`, `take-profit`, `trailing-stop`
- Manual Move Stop defaults to `stop-loss`; manual Move Target defaults to `take-profit`; manual Add / Edit Order defaults to `limit`.
- `trailing-stop` is retained for compatibility with imported or historical records. Manual trailing behavior is represented as Move Stop with a Reason such as Trail / protect profit, not as a trailing-stop order type by default.
- `price` is the fill price for position-changing actions, or the stop/target/order price for management actions.
- `quantity` is required for position-changing actions and may be empty for management actions.
- `anchorPrice` is an optional manual anchor used to draw risk/reward zones for management stages.
- Buy/sell meaning is derived from `Trade.direction` and position-changing `Execution.action`.
- `signal` preserves TradingView text for position-changing records. For trade-management records, the UI presents it as Reason, for example Trail / protect profit, Break even, Reduce risk, Widen stop / hold through, Structure changed, Target update, Manual order update, or Other.
- `sourceRef` preserves imported row identity.

### TradeEvent

TradeEvent is retained for imported chart annotations and legacy data:

- `sl-set`
- `sl-moved`
- `tp-set`
- `tp-moved`
- `note`

New manual trade-management records should be stored as Executions. TradeEvent records may still be rendered on the timeline and chart for compatibility.

### Case And CaseCard

A Case is a continuous reasoning record created under an Account and Period. It can exist before a Trade is imported. CaseCard stores one immutable raw text entry in one of five phases: `pre-entry`, `entry`, `intermediate`, `closing`, or `reflection`. Each Card has one `barRef`; a Card never represents multiple BARs.

An Entry CaseCard can be marked `pending`, `executed`, or `continue-observing`. A non-executed Entry remains an Entry in stored data but is displayed with Pre-entry observations. Explicit BAR references are mechanically extracted without rewriting the raw text.

Case and Trade use a separate CaseTradeBinding. Active bindings are one-to-one in both directions. Case Tags use CaseTagDef and are independent from Trade TagDef.

Trade detail separates `Overview`, `Case`, and `Trade` views. Overview keeps the chart and trade result summary, shows the Case summary below the result card, renders extracted BAR references as Case Card markers, and combines Executions, legacy TradeEvents, and Case Cards into one Timeline. Chart markers expose their event or Card summary on hover; Case markers can open the corresponding Card. Case shows the same immutable Card text as the Case page and supports creating, selecting, binding, unbinding, and rebinding Cases. Trade contains numeric analysis and is the future home of process scoring and AI suggestions.

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
- `cases`
- `case_cards`
- `case_trade_bindings`
- `case_tag_defs`
- `case_tag_links`
- `attachments`
- `import_batches`

Normal entities store JSON payloads plus indexed ownership columns. `trades` are persisted as a parent row, while `executions`, `trade_events`, `chart_data`, and reference-image attachments are stored as child entities. `read_state` hydrates those child rows back into nested Trade objects for the React store.

Normal deletes set `deleted_at`. Full backup restore and clear-data actions replace the local database contents.

## Import Rules

TradingView import supports:

- Chinese and English field names.
- Workbook sheet auto-selection by required trade columns.
- When every imported row has TradingView `交易编号` / `Trade #`, Cairn first restores each TradingView entry/exit pair, then merges overlapping same-direction pairs into one Cairn Trade.
- When TradingView trade numbers are unavailable or incomplete, Cairn falls back to position simulation by Account, Period, Symbol, and direction.
- Within one Cairn Trade, repeated entries are stored as `scale-in` executions until the simulated position is closed.
- Long and short positions are tracked independently and never offset each other.
- TradingView trade numbers are preserved as source references, but overlapping TradingView pairs may share one Cairn Trade.
- Partial exits become `scale-out`; the exit that closes the simulated position becomes `exit`.
- Import preview warns when an exit has no matching simulated position or exits more quantity than the current simulated position.
- UTC time parsing from Excel serials, ISO strings, Unix seconds, or Unix milliseconds.
- Order type inference from order type + signal text.
- Source row preservation through `sourceRef`.
- Optional chart CSV parsing for OHLC, EMA, and plotted SL/TP level columns.
- Chart SL/TP level changes become TradeEvents if the chart time overlaps the trade. Manual stop/target/order changes are stored as trade-management Executions.

If trade export and chart CSV time ranges do not overlap, chart data is not attached to that trade.

## Metrics

Metrics are computed from position-changing Executions only:

- Average entry/exit
- Realized PnL
- R multiple when initial stop loss is present
- Equity curve
- Win/loss/breakeven
- Profit factor
- Expectancy
- Max drawdown

Trade status is stored for workflow, but closed-trade metrics still derive from position-changing execution data. Trade detail editing can update executions, tags, initial stop loss, optional initial take profit, notes, and reference images.

## Trade Chart Overlays

Trade charts can render execution management stages:

- `Trail line`: stepped stop/target lines.
- `Entry line`: an entry/average-entry reference line.
- `Zones`: retained as an optional visual aid for risk/reward areas between an execution's `anchorPrice` and the active stop/target price.

A management stage begins at a `stop`, `target-moved`, `target-set`, or `order-edit` execution and ends at the next stop/target/order-edit execution. If a field is not changed, the previous active stop or target continues through the next stage.

## Tags

TagDef is global. Trade tags reference tag names. Tag names are trimmed, whitespace-normalized, and unique by case-insensitive comparison. Tag color is categorical, not decorative. Trade-tag groups should be displayed in color order from red to purple, with name order inside the same color. Renaming a TagDef updates all Trade tag references. Deleting a TagDef removes that tag from referencing trades after user confirmation. Trade list filtering uses AND semantics across selected tags. Tag management lists tags by localized name order and supports filtering by color.

Note tags are text tags and are independent from Trade tags. Note tag input uses the same trimming and de-duplication behavior.

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
