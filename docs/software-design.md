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

A Case is a continuous reasoning record created under an Account and Period. It can exist before a Trade is imported. CaseCard stores one raw text entry in one of five phases: `pre-entry`, `entry`, `intermediate`, `closing`, or `reflection`. Each Card maps to at most one `barRef`; a Card never represents multiple BARs. Raw text is permanent but not frozen: typo corrections (for example speech-transcription errors) are allowed, and every change automatically appends the previous wording to `rawTextHistory` and stamps `rawTextEditedAt`; AI output never rewrites raw text, and the local REST API still rejects raw-text changes to keep idempotent replay semantics.

The "never rewrite" rule constrains the AI, not the user (0.3.0 clarification): user adjustability comes first. Besides correcting text and BAR, a user can delete a Card outright — deletion is a soft delete (`deleted_at`, attachments cascade) available from the Case page timeline, the widget card list (✕ next to ✎), and `DELETE /api/v1/cases/{caseId}/cards/{cardId}`; backups can restore deleted cards. This is the cleanup path for mis-recorded or badly-split cards.

Recording is thinking-first: users speak or type free text only. BAR numbers mentioned in the text (`BAR41`, `第 42 根 K 线`) are extracted mechanically into `barRef`; AI extraction and completeness checklists arrive in Stage 5. `barRef` may stay missing on a Card until extraction or a later manual backfill—the thinking layer never blocks on form filling.

`barRef` follows the TradingView Bar Count indicator convention: bar 1 is the first bar opening at UTC 00:00 of the day, incrementing by one per bar. `lib/bar-time.ts` converts between `barRef` and UTC time by pure arithmetic, which matches gapless 24/7 markets. Markets with session gaps will later need bar positioning from imported candles instead of time arithmetic.

Because the number resets every UTC day, a Case that crosses midnight can contain two Cards with the same or descending `barRef`. Display resolution on the Trade detail page (`resolveCaseCardTimesForTrade` in `lib/bar-time.ts`, feeding chart markers and the Timeline) is mechanical and monotonic by design, anchored to the Trade's first position fill — in replay/backtest sessions the Card `createdAt` is the recording wall clock and has nothing to do with the chart date, so it must never anchor the day. Rules: `barRef` is validated against the day's bar count first (a misrecognized number like 2265 never participates and falls back to creation order, flagged `invalid`); a candidate earlier than the previous Card's resolved time bumps the day by one (crossing midnight); if the bumped candidate still lands beyond the chart window the Card stays right after its predecessor (creation order wins over bar arithmetic — retrospective range references like "252–262 这 10 根" don't drag the chain); Cards without a usable `barRef` inherit the previous Card's time +1ms. The Case page itself groups by display phase and creation order and does no time resolution.

`barRef` is user-correctable derived-adjacent data: the BAR badge on a Card opens an inline editor (valid integers 1–1440, or clear), fixing speech-recognition errors without touching raw text.

A Case spans from the end of the previous Trade to the next executed Trade. Pre-entry observation and non-executed Entry ideas stay in the same Case while the trader keeps observing. A Case that never leads to an executed Trade remains as an observation-only record.

An Entry CaseCard can be marked `pending`, `executed`, or `continue-observing`. A non-executed Entry remains an Entry in stored data but is displayed with Pre-entry observations. Explicit BAR references are mechanically extracted without rewriting the raw text.

Case and Trade use a separate CaseTradeBinding. Active bindings are one-to-one in both directions. Case Tags use CaseTagDef and are independent from Trade TagDef.

**Auto-close** (`lib/case-auto-close.ts`): an `active` Case flips to `closed` automatically, once, after data-change events (card create/move, binding create, trade create/status/execution updates). Conditions: the bound Trade is fully closed (exit quantity ≥ entry quantity) and a Closing Card exists; or, with no binding at all, a Reflection Card exists (observation-only Cases). A closed Trade without a Closing Card keeps the Case `active` on purpose — the open Case is the reminder that the exit record is missing. Manual status edits never trigger the derivation, so reopening a Case sticks.

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

### Import Case Matching

After a batch is imported, `lib/case-import-matching.ts` proposes Case bindings per imported Trade (Cases and Cards do not store a symbol, so matching uses account plus time windows):

- **Exact (green, auto-bound)**: same account; the Trade's first entry fill is within ±15 min of an executed Entry Card's record time, and the last exit fill is within ±15 min of a Closing Card's time; the Case is unbound. Exact matches bind automatically with `source: 'import'`; each Case is consumed once so two Trades cannot claim it.
- **Suggest (yellow)**: entry-only matches, multiple exact candidates, or any Card overlapping the holding period ±60 min — listed as candidates for one-click manual confirmation.
- **None (red)**: no candidate Case at all, surfaced so missing recordings are visible.

The import result page renders one row per Trade with the color dot, both summaries, and candidate confirmation. Batch rollback also removes the bindings created during that import.

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

### Risk And R Decomposition

R keeps a single meaning — the plan's risk unit — and the Trade tab shows the decomposition instead of redefining R:

- **Initial risk (planned 1R)** = |first entry fill price − `initialStopLoss`| × first entry quantity. `rMultiple` = realized PnL ÷ initial risk, anchored to the first entry so scaling in does not dilute the denominator. For single-entry trades this equals the historical average-entry formula.
- **Actual risk** = Σ over every entry/scale-in fill of |fill price − stop in effect at that fill| × fill quantity. "Stop in effect" is the latest stop-action Execution (`stop`/`stop-set`/`stop-moved`, which carry the new stop price) before the fill; if none, `initialStopLoss`. Stop widens or tightens made before an add therefore land in that add's segment. `rActual` = PnL ÷ actual risk.
- **Final stop** = the stop price in effect at the last fill (equals `initialStopLoss` when never moved).
- No user input: everything derives mechanically from Executions plus `initialStopLoss`. Both R numbers display side by side without judgment; scale-out does not change either denominator, and gap/slippage losses beyond the stop surface as `rActual` < −1.

The Trade tab also renders a 计划 vs 实际 comparison table: plan direction/entry price/stop/target from the bound Case's Entry Card memo (Trade's `initialEntryPrice`/`initialStopLoss`/`initialTakeProfit` take precedence; each plan value carries a source marker 录=manual trade field / 卡=memo) against actual direction, average entry, final stop, and average exit — facts side by side, no verdicts. Plan prices backfill mechanically: when a Trade binds to a Case (import auto-bind or manual) and plan fields are empty, values are extracted from the Entry memo (`firstNumberIn`), filling only empty fields and never overwriting manual entries — each Trade gets one automatic attempt, plus an on-demand fill from the missing-fields prompt. That prompt opens once per visit on closed Trades missing the initial stop/target: 从 Entry 卡填入 / 手动填写 / 待会儿提醒 (default) / 忽略 (persisted per Trade).

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

## Local REST API

Cairn runs a local HTTP service for companion scripts (the TradingView capture widget) to write Case data without opening the main window. Implementation lives in `src-tauri/src/api.rs` and reuses the same SQLite write path as the app UI, so raw-text immutability and one-to-one binding constraints behave identically.

- The capture widget is a Tampermonkey userscript at `scripts/cairn-case-widget.user.js`: a floating ball and panel over the TradingView chart, rendered in light DOM under a `#cairn-cw-wrap` container (cw-prefixed ids, scoped styles in `document.head`; no Shadow DOM) so TradingView's input-focus guard recognizes the panel inputs. It matches the approved HTML mock (drag with a 4px misfire threshold, persistent ball that toggles to a collapse button, five phase pills, entry decision, optional BAR input, entry-phase completeness hints, card timeline), with a current-Case session header: the panel states where Cards go, switching Cases is an on-demand recent-cases menu, and ＋ starts a new Case (account/period remembered from last time). It talks to this API with `GM_xmlhttpRequest` (an https page cannot `fetch` http localhost directly), remembers token/port/selected Case/phase/widget position, and can create Cases inline with account and period picked from `GET /api/v1/accounts`. `scripts/cairn-case-widget.test.html` is a GM-shim harness page that runs the same userscript against the isolated dev environment for testing without Tampermonkey.

- The server binds to `127.0.0.1` only and starts with the app; closing the window hides to tray and the API keeps running.
- Configuration and a 32-byte random token are stored in `app_data_dir/api-config.json` (atomic tmp+rename writes). Default port is 8787. Port and enabled flag changes apply after restart; token regeneration applies immediately.
- All endpoints except `GET /api/v1/health` require `Authorization: Bearer <token>`. Responses include permissive CORS headers and handle OPTIONS preflight so both `GM_xmlhttpRequest` and plain `fetch` clients work.
- Endpoints: `GET /api/v1/health`, `GET/POST /api/v1/cases`, `GET /api/v1/cases/:id`, `GET/POST /api/v1/cases/:id/cards`, `PUT /api/v1/cases/:id/cards/:cardId` (raw-text correction + barRef), `DELETE /api/v1/cases/:id/cards/:cardId` (soft delete, 0.3.0), `POST /api/v1/bindings`, `DELETE /api/v1/bindings/:id`, `GET/POST /api/v1/case-tags`, `GET /api/v1/accounts` (with nested periods for capture context).
- Card creation requires `phase` and `rawText`. `barRef` is optional; when omitted the server mechanically extracts the first explicit BAR reference from the raw text (`BAR41`, `bar #38`, `第 42 根 K 线`), and the Card may be stored without one. Creation is idempotent: clients submit a stable `id`; replaying the same content returns the stored record, while replaying the same id with different raw text is rejected with 409.
- The API never accepts order placement, position modification, or Trade writes.
- Successful writes emit a `cairn://data-changed` Tauri event; the React store debounces and rehydrates so the UI reflects external writes without polling.

## AI Providers

Cairn talks to OpenAI-compatible chat APIs through user-configured providers. Implementation lives in `src-tauri/src/ai.rs`; the Settings page has a dedicated AI tab.

- Providers are OpenAI-compatible endpoints with a name, base URL, optional API key, and an optional default model. Common presets (OpenAI, Anthropic, OpenRouter, Gemini, Groq, DeepSeek, Zhipu GLM, Kimi, Qwen, SiliconFlow, local Ollama, custom) prefill the base URL and show a branded badge.
- Model discovery uses `GET {base_url}/models` with Bearer auth (omitted for keyless local endpoints). A successful fetch doubles as a connection test.
- One provider is marked default; AI features (Stage 5 card extraction and completeness checks) will use it.
- Credentials are configuration, not data: they are stored in `app_data_dir/ai-providers.json` (atomic writes) and are excluded from backups and restores.
- The client is a thin reqwest layer rather than an SDK; chat calls stay a `chat(provider, messages, schema)`-style function so requests and responses remain fully recordable for provenance (model/prompt/schema versions).

### Card AI Analysis

The first Stage 5 slice runs on each CaseCard ("AI 整理"): the default provider receives the Card phase, raw text, and (since 0.3.0) a background context block, then returns structured JSON that is validated and stored on the Card as `aiAnalysis` — a versioned derived record (`schemaVersion`, `promptVersion`, `model`, `providerId`, `analyzedAt`; schema `0.3.0-schema-3` / prompt `0.3.0-prompt-3` since 0.3.0). Raw text is never rewritten; re-running replaces the analysis.

- Extraction targets: `digest` (a ≤30-char one-line gist of what the card is about, shown on collapsed card rows; old analyses without it fall back to the raw-text preview), `barRef` proposal (backfills a missing Card `barRef`; the prompt anchors on the card's "now" bar and ignores backward references), span-quote `labels` across eleven fixed categories, and for Entry Cards the seven-field memo (direction, entry price, stop-loss, target, confidence, invalidation, rejected alternatives, plus optional emotion). Every quote must be a verbatim substring of the raw text; anything else is dropped during validation, and `missingFields` is derived mechanically from the memo rather than trusted from the model.
- Background context (0.3.0, assembled in `lib.rs card_context`): symbol, the bound trade's direction/status/initial stop plus a merged execution+event timeline (≤24 one-liners), and up to six earlier cards of the same Case (digest or first line). Context is auxiliary only — the system prompt hard-binds quotes to the card's own raw text and forbids digest from using context-only facts. Any context source failing to read degrades to skipping that section; analysis is never blocked.
- Price conventions (0.3.0, calibrated on production transcripts): memo price fields output pure-number strings when the raw text names an explicit price; K-line numbers, R-multiples, and percentages are not prices. The TS side defends mechanically anyway — `firstPlausibleNumberIn` (`lib/process-score.ts`) only accepts numbers within 10× of a reference price (actual avg entry) when picking a price out of memo strings, which eliminated the production bugs `initialTakeProfit=2` (from "2~3 倍") and `initialEntryPrice=64` (from "64 号 K 线"). It backs the trade-plan prefill, the plan-vs-actual card, and planned-RR derivation.
- Validation is defensive: markdown fences are stripped, unknown label types and non-verbatim quotes are dropped, `direction` normalizes to long/short, `confidence` clamps to 0–100. The UI renders label-colored underlines directly on the original text, the memo grid with quotes, and missing-field hints.
- Analysis runs automatically: a Card created through the local REST API (the capture widget) is analyzed in a background thread right after creation (`ai::spawn_auto_analysis`, settings toggle 自动 AI 整理, default on; idempotent replays never trigger it). Failures retry once and then only log — recording is never interrupted.
- All AI requests retry once automatically on network-class failures (send failure, timeout, 5xx, empty content); configuration and parse errors return immediately without wasting a call.
- Every AI surface ships with a retry control (`components/ai-retry-button.tsx`): clicking retries immediately; a dotted link opens a popover where the user can type a correction instruction (appended as an extra user message) and retry with it.
- Derived data is user-correctable: the BAR badge edits `barRef`, the memo popover edits memo values (missing fields recompute mechanically), the 标签整理 mode relabels or deletes span labels and labels newly selected text (labels stay quote+type overlays — raw text is never rewritten). Manual edits stamp `userAdjusted`, and re-running analysis on an adjusted Card asks for confirmation first.
- If the raw text was edited after an analysis (`analyzedAt` older than `rawTextEditedAt`), the UI marks the analysis stale; the badge offers re-run or 忽略本次过期 (`staleDismissedAt` — the badge returns as soon as the raw text is edited again).
- The analysis footer is deliberately compact — legend, missing fields, model, and time on one muted line; the memo grid with verbatim quotes lives behind a popover. "全部 AI 整理" analyzes every Card of the Case in parallel with per-card busy and error state. The shared card timeline (`components/case-card-timeline.tsx`) renders on both the Case page and the Trade Case tab, so cards are equally editable in review context.
- The same chat layer drafts Case titles (`draft_case_title`): it reads all Card raw texts of a Case and returns a short title suggestion (≤20 chars). Binding a Trade auto-titles Cases whose title is still a default placeholder (未命名 Case / Case date / widget's "SYM 观察 HH:MM" / "Trade #N Case"); user-chosen titles are never overwritten. The manual button stays.

### Process Score (Trade 分析)

Display aggregation treats iceberg fills honestly: same-bar same-price same-side fills (one submission split by the exchange) merge into a single display row — `Entry (2)` / `Exit (2)` with summed quantity and weighted price. Data is never merged, only presentation.

Account equity is a derived snapshot: after trades change, the frontend recomputes each Account's `equity` = `initialBalance` + Σ closed-trade PnL and writes it back onto the Account record (unchanged values don't rewrite). The local REST API exposes it with the account payload, and the capture widget shows balance plus 1% / 2% fixed-risk amounts for position sizing. The trades table's PnL% column divides each closed trade's PnL by equity before that trade (`equityBeforeByTrade`, initial balance plus all earlier closed PnLs by close order), making risk-budget violations (e.g. a loss beyond the fixed 2%) visible at a glance.

The Trade tab hosts the ten-point process scorecard (`lib/process-score.ts`, `components/trade-process-score.tsx`). Mechanical items derive live: memo completeness from the bound Case's Entry Card analysis (missing fields count), planned risk-reward from entry/stop/target prices (memo strings, `initialEntryPrice`/`initialStopLoss`/`initialTakeProfit` fallbacks), and stop-only-tightened from the stop Execution sequence (direction-aware). Judgment items (structure valid, entry discipline, exit per plan, unplanned-action count) are human inputs; saved scores snapshot the derivation into `Trade.processScore.computed` so the evaluation stays anchored to decision-time facts. R is displayed beside the score and never contributes to it.

## Backup

Cairn exports JSON backups containing a version, timestamp, backup kind, and full hydrated state. Restore replaces the local app state.

Manual backups are written under the app data directory in `backups/`. Automatic backups are written to `backups/auto/`. The app creates one automatic backup the first time local state is loaded each local calendar day, and keeps the latest seven daily automatic backups. Automatic retention does not remove manual exports.

Future backup sync should upload encrypted backup files only; it should not become realtime sync.

## Packaging

The app is built with Tauri 2. Windows bundles are MSI and NSIS. macOS packaging remains a target; Linux can be built when convenient but is not a primary user target.

## Historical References

Legacy V0/backend/mock-data references live under `reference/legacy/`. They are not part of the active app architecture.
