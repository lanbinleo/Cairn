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

An Account is a trading environment or ledger, not necessarily a broker account. It contains initial balance, currency, `kind` (`backtest` or `live`), and optional fee rates `takerFeePct` / `makerFeePct` (percentage numbers: `0.05` = 0.05%; missing or 0 = no fee, see Metrics).

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
- `feeOverride` (0.3.7) optionally records an actual per-fill fee amount (account currency), imported from the export file's Commission/手续费 column when present. It always wins over rate-based fee estimation; sign is ignored (absolute value).
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

A Case is a continuous reasoning record created under an Account and Period. It can exist before a Trade is imported. CaseCard stores one raw text entry in one of five phases: `pre-entry`, `entry`, `intermediate`, `closing`, or `reflection`. Each Card maps to at most one `barRef`; a Card never represents multiple BARs. Raw text is permanent but not frozen: text edits are allowed (the「编辑原文」editor, upgraded from typo correction in 0.3.7 — full rewrites included, since spoken text carries filler), and every change automatically appends the previous wording to `rawTextHistory` and stamps `rawTextEditedAt`; AI output never rewrites raw text, and the local REST API still rejects raw-text changes to keep idempotent replay semantics.

Two AI assists around text editing (0.3.7), both draft-only — the pen always stays with the user:

- **AI 重写** (`draft_case_card_rewrite` GUI command): produces a cleaned-up draft that removes filler, repetition, and off-topic noise while keeping the trader's first-person voice. The draft never touches storage; it is pre-filled into the 编辑原文 editor for review and manual saving. Mechanical validation: every number token in the original must survive into the draft verbatim, and the length ratio must stay within 30%–110% — one repair round on failure, error otherwise.
- **AI 校对** (`proofread_case_card` GUI command): finds likely errors (mis-transcriptions, numbers that contradict the bound Trade's facts, out-of-range BAR references) and returns oldText→newText replacement pairs. `oldText` must be a verbatim substring (invalid pairs are dropped silently). The dialog lets the user check pairs, add manual pairs, and preview the combined result; applying is a single normal text edit (one history entry, analysis marked stale). `lib/case-card-corrections.ts` applies pairs sequentially and flags failures instead of skipping silently.

The "never rewrite" rule constrains the AI, not the user (0.3.0 clarification): user adjustability comes first. Besides correcting text and BAR, a user can delete a Card outright — deletion is a soft delete (`deleted_at`, attachments cascade) available from the Case page timeline, the widget card list (✕ next to ✎), and `DELETE /api/v1/cases/{caseId}/cards/{cardId}`; backups can restore deleted cards. This is the cleanup path for mis-recorded or badly-split cards.

Recording is thinking-first: users speak or type free text only. BAR numbers mentioned in the text (`BAR41`, `第 42 根 K 线`) are extracted mechanically into `barRef`; AI extraction and completeness checklists arrive in Stage 5. `barRef` may stay missing on a Card until extraction or a later manual backfill—the thinking layer never blocks on form filling.

`barRef` follows the TradingView Bar Count indicator convention: bar 1 is the first bar opening at UTC 00:00 of the day, incrementing by one per bar. `lib/bar-time.ts` converts between `barRef` and UTC time by pure arithmetic, which matches gapless 24/7 markets. Markets with session gaps will later need bar positioning from imported candles instead of time arithmetic.

Because the number resets every UTC day, a Case that crosses midnight can contain two Cards with the same or descending `barRef`. Display resolution on the Trade detail page (`resolveCaseCardTimesForTrade` in `lib/bar-time.ts`, feeding chart markers and the Timeline) is mechanical and monotonic by design, anchored to the Trade's first position fill — in replay/backtest sessions the Card `createdAt` is the recording wall clock and has nothing to do with the chart date, so it must never anchor the day. Rules: `barRef` is validated against the day's bar count first (a misrecognized number like 2265 never participates and falls back to creation order, flagged `invalid`); a candidate earlier than the previous Card's resolved time bumps the day by one (crossing midnight); a candidate beyond the chart window first searches one day backward (0.3.7: "yesterday-context" pre-entry Cards reviewing the previous day's setup — accepted when the result lands inside the window without violating creation order) and only then falls back to right after its predecessor (creation order wins over bar arithmetic — retrospective range references like "252–262 这 10 根" don't drag the chain); Cards without a usable `barRef` inherit the previous Card's time +1ms. The Case page itself groups by display phase and creation order and does no time resolution.

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
- Optional Commission / 手续费 / 佣金 column (0.3.7): per-row actual fee amounts become Execution `feeOverride`; a present-but-zero value counts as "no data" and falls back to account-rate estimation.
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

**Fees and net PnL (0.3.7)**: fees are a configuration, not a record — accounts carry `takerFeePct`/`makerFeePct`, fees are estimated after the fact per position-changing fill (`fee = |price| × quantity × rate`, `lib/fee.ts`), and changing the rates retroactively recomputes every historical statistic (the exact backtest-with-real-cost workflow). Order classification: `market`/`stop`/`stop-loss`/`stop-limit`/`trailing-stop` → taker, `limit`/`take-profit` → maker; `feeOverride` (imported actual commission) always wins. `computeTradeMetrics(trade, rates?)` returns `grossPnl`, `fees` (summed over all position fills — entry legs included, the money is spent), and net `pnl = grossPnl − fees`; rates default to zero for backward compatibility. Net PnL propagates everywhere through `pnl`: win rate, profit factor, expectancy, equity curve/drawdown, the equity snapshot on Account (which the widget reads — its balance turns net with zero widget changes), PnL% denominators, R numerators (R denominators stay pure price risk), AI summary context. UI surfacing: the Trade 复盘 sidebar gains a 手续费 line and the 评估 tab gains 毛盈亏/手续费/净盈亏 rows when fees > 0; the trade list gains no new column.

Number formatting convention (0.3.6): quantities go through `fmtQty` (TS, `lib/format.ts`) / `fmt_num` (Rust, `lib.rs`) — at most 6 decimals with trailing zeros trimmed, killing float-accumulation noise (`2.4425999999999997` → `2.4426`) without losing contract-quantity precision; prices in AI contexts trim the same way capped by the symbol's price precision (`fmtNum`), while UI price cells keep `fmtPrice`. Applied at every AI-context assembly point (case summary, card context, suggestion context) and the raw-float render sites (总仓位 stat card, timeline/chart/hover quantities); the data layer itself never rounds.

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
- Endpoints: `GET /api/v1/health`, `GET/POST /api/v1/cases`, `GET /api/v1/cases/:id`, `GET/POST /api/v1/cases/:id/cards`, `PUT /api/v1/cases/:id/cards/:cardId` (raw-text correction + barRef), `DELETE /api/v1/cases/:id/cards/:cardId` (soft delete, 0.3.0), `POST /api/v1/cases/:id/cards/batch-split` (voice batch split, 0.3.0), `POST /api/v1/cases/:id/cards/split-preview` + `POST /api/v1/cases/:id/cards/batch-create` (manual split with preview, 0.3.6), `POST /api/v1/bindings`, `DELETE /api/v1/bindings/:id`, `GET/POST /api/v1/case-tags`, `GET /api/v1/accounts` (with nested periods for capture context).
- Batch split (0.3.0): the capture widget's explicit 拆卡 checkbox (0.3.1; checking it disables the BAR input because split anchors come from the card text) posts the whole speech to `cards/batch-split` with a `clientRequestId`. The server asks the AI to split under the 0.3.5 granularity rule (prompt `0.3.5-split-3`): **a new card opens only when the trader explicitly advances to a new bar** — an explicit number (explicit anchors set `barRef`, "下一根" increments it, explicit re-mentions reset) or a factual progression statement (「下一根 K 线收出了…」「立马跟着一根…」). Hypothetical/plan phrasings (「如果下一根…我就…」) are not anchors: commentary, market analysis, plans, and emotions on the current bar stay in the current card however many ideas they contain, and missing bar numbers are never guessed or backfilled. Mechanical validation then runs the existing checks — verbatim ordered substrings, monotonic barRefs, **≥85% character coverage of the raw text (a dropped sentence fails the whole parse)**, ≤20 segments — and finally **merges every unanchored segment into the previous card** (a leading unanchored segment prepends to the first anchored card; all-unanchored stays one card), so an unanchored card cannot exist even when the model disobeys the prompt. Cards are created directly: no preview, fluency first; mistakes are cleaned up with edit/delete (F7a). Any failure (no provider, network, bad parse, low coverage) degrades to one whole-text card — the raw speech is never lost. Replay with the same `clientRequestId` returns the previously created cards and **rejects a different rawText (409, matching the POST /cards immutable semantics)**; the widget reuses the request id for same-text retries and uses a 300s timeout (server worst case ~270s: 90s×2 network retry + one 90s repair round, 0.3.6). The route is dispatched at the server-loop level (before the DB mutex is taken) because it needs the AppHandle for AI — keeping `handle_request` free of GUI dependencies so the test binary links cleanly, and `run_batch_split` holds the DB lock only in short phases (validate/replay → AI unlocked → persist) so GUI Tauri commands never block behind a split. The AI call still occupies the single-threaded REST server (the widget is the only client and is awaiting this submit anyway).
- Manual split with preview (0.3.6): the widget's optional 预览 sub-checkbox (only enabled while 拆卡 is checked) first posts to `cards/split-preview` — same AI call (repair round included) and same mechanical validation, **but nothing is persisted and failures error out instead of degrading** (the user is present and waiting). The widget's preview modal lets the user edit each segment's text and barRef, merge a segment into the previous one, and shows uncovered-character counts; 确认 posts the edited segments to `cards/batch-create`, which only validates bounds (1–20 segments, non-empty trimmed text, barRef 1–1440 or null — verbatim coverage is NOT enforced because the user has already reviewed) and persists via the shared batch persist helper (`{rid}-{i}` ids, same idempotent replay). Cancel (or Esc) creates nothing and leaves the text in the input. A single returned segment skips the modal and saves directly, matching the direct-split behavior.
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
- All AI requests retry once automatically on network-class failures (send failure, timeout, 5xx, empty content); configuration and parse errors return immediately without wasting a call. Since 0.3.6 a **validation-failure repair round** (`ai.rs chat_completion_validated`) covers the other failure class: when the model's output fails mechanical validation (non-JSON, non-verbatim splits, low coverage), the call is re-sent as base messages + `assistant`(first output verbatim) + `user`(the specific validation error and a fix-only-JSON instruction) — with temperature 0 the error text is what makes round two differ. The repair round uses a plain call (no nested network retry; total worst case ~270s). Wired into batch split (repair first, then degrade with the reason logged — previously silent), card re-split (repair first, then error carrying the specific reason), card analysis (non-JSON), and the shared suggestions call. The streamed summary deliberately does NOT repair: its markup sanitizer never fails and re-sending would double the streamed text.
- Every AI call is logged in full (0.3.6): request line (target host, provider, model, message count/chars) + request body, response line (duration, chars, usage tokens) + response body — bodies truncated at 16KB, the Authorization header / API key are never written. Logs live in per-date files (see Diagnostics & Logging).
- Every AI surface ships with a retry control (`components/ai-retry-button.tsx`): clicking retries immediately; a dotted link opens a popover where the user can type a correction instruction (appended as an extra user message) and retry with it.
- Derived data is user-correctable: the BAR badge edits `barRef`, the memo popover edits memo values (missing fields recompute mechanically), the 标签整理 mode relabels or deletes span labels and labels newly selected text (labels stay quote+type overlays — raw text is never rewritten). Manual edits stamp `userAdjusted`, and re-running analysis on an adjusted Card asks for confirmation first.
- If the raw text was edited after an analysis (`analyzedAt` older than `rawTextEditedAt`), the UI marks the analysis stale; the badge offers re-run or 忽略本次过期 (`staleDismissedAt` — the badge returns as soon as the raw text is edited again).
- The analysis footer is deliberately compact — legend, missing fields, model, and time on one muted line; the memo grid with verbatim quotes lives behind a popover. "全部 AI 整理" analyzes every Card of the Case in parallel with per-card busy and error state. The shared card timeline (`components/case-card-timeline.tsx`) renders on both the Case page and the Trade Case tab, so cards are equally editable in review context.
- The same chat layer drafts Case titles (`draft_case_title`): it reads all Card raw texts of a Case and returns a short title suggestion (≤20 chars). Binding a Trade auto-titles Cases whose title is still a default placeholder (未命名 Case / Case date / widget's "SYM 观察 HH:MM" / "Trade #N Case"); user-chosen titles are never overwritten. The manual button stays.

### Execution Suggestions (持仓管理补录建议, 0.3.0)

The real workflow is Case-first: cards are recorded before the Trade exists, so suggestion checking triggers when a binding is established (frontend `createCaseBinding` fires it for UI paths; `POST /api/v1/bindings` spawns `ai::spawn_auto_suggestions` for REST paths — both gated by the `autoSuggest` setting, default on), plus a manual 重新检查 button. One AI call covers the whole Case: the prompt receives the trade background (direction/symbol/first entry/initial stop+target), the merged execution+event one-liners already on the trade, and all cards with stable `cardIndex` numbers.

- Scope is management-only (`stop`, `target-moved`, `order-edit` in editor-canonical actions). Position fills (entry/scale/exit) are never suggested — exchange-imported fills are the source of truth. The prompt hard-codes the calibrated rules: explicit price/position + decided tone only; explicit negations ("不适合移动止盈止损") and hypotheticals ("如果…就…") are never extracted; actions already covered on the trade are skipped.
- Mechanical validation distrusts the model (`parse_execution_suggestions`): quotes must be verbatim substrings of the referenced card, actions/orderTypes are whitelisted, prices must be positive finite numbers, card indices must resolve; suggestions without a price AND without an anchor text are dropped; max 8 kept.
- Mechanical dedup (`dedup_suggestions_against_trade` in `lib.rs`): a suggestion is dropped when the trade already carries a same-class action (executions, legacy SL/TP events, or the initial stop/target) at a price within a 0.02% relative tolerance of the first-entry reference.
- Persistence mirrors `aiAnalysis`: `TradeCase.aiExecutionSuggestions` is a versioned blob (`schemaVersion`/`promptVersion` = `0.3.0-suggest-1`, model, provider, analyzedAt, suggestions). Each suggestion carries evidence (`cardId`, verbatim `quote`, the card's `barRef`) and a `status` (`pending`/`accepted`/`dismissed`, with `acceptedExecutionId`). Re-runs replace the list but carry accepted/dismissed states forward by fingerprint (cardId+action+quote+price). Deleted cards' suggestions disappear on re-run.
- Review UI (`components/case-execution-suggestions.tsx`, Trade page Case tab): pending cards show action, price/anchor, reason, BAR, and the mechanically resolved time (`resolveCaseCardTimesForTrade` — the AI never computes times). Three actions: 直接添加 (creates a real Execution via the normal save path with the quote in its note, marks the suggestion accepted), 修改后添加 (opens the edit dialog's Executions tab pre-filled with a draft row via the `prefill` prop), 忽略. Suggestions are always candidates — nothing lands without an explicit user action.

### Trade Tag Suggestions (AI 标签建议, 0.3.4)

Produced by the SAME AI call as execution suggestions (one invocation per check, prompt `0.3.6-suggest-3` since 0.3.6; both blobs share `analyzedAt`), so the trigger surface is unchanged: binding established (UI `createCaseBinding` / REST `spawn_auto_suggestions`, `autoSuggest` gate) plus the shared 重新检查 button. Tags attach to the bound Trade, not the Case — after 1:1 binding they are one thing.

- The prompt receives the user's own tag vocabulary (`tagDefs`) grouped by color with fixed color semantics (红 = 定调整笔交易：定性错误或最高评级；橙 = 顺势/周期；黄 = 市场结构；绿 = 仓位与执行；青 = 复盘状态；蓝 = 情绪；紫 = 特殊标注). The AI may only choose names from the list — never invent tags — ordered by evidence strength, capped at 15.
- Mechanical validation (`ai.rs parse_trade_tags`): name must hit the vocabulary (case/whitespace-insensitive), each suggestion needs a verbatim `quote` from the indexed card (or, with a missing/out-of-range cardIndex, from any card), dedupe by name; tags already on the trade are filtered out in `lib.rs`. Invalid entries drop silently — the tag half never fails the whole check. **Teachable retry relaxation (0.3.6)**: on a retry with a user instruction, a name that does not hit the vocabulary is still accepted when it appears verbatim in the instruction text — the user typing the name is the authorization; the apply path defensively creates the tag def. Regular checks stay strictly vocabulary-bound.
- Teachable retry (0.3.6): the AI 标签建议 panel ships the shared `AiRetryLink` (both expanded and collapsed states — collapsed keeps the entry because "give me more tags" is the typical case after everything is resolved). The instruction is appended as an extra user message together with tag state (tags already on the trade, previously accepted/dismissed suggestions) — with temperature 0 the state block is what makes the retry produce different output; the message asks for different/more suggestions and repeats the no-new-names rule unless the instruction names them.
- Persistence: `TradeCase.aiTagSuggestions` versioned blob, fingerprint = tag name, statuses (`pending`/`accepted`/`dismissed`) carried across re-runs like execution suggestions.
- Review UI (`components/case-tag-suggestions.tsx`, Trade 案例 tab directly under AI 补录建议): pending rows show the colored tag chip (TagBadge), reason, and a quote link that jumps to the evidence card. 应用 adds the tag to the trade via the normal save path (with a defensive tag-def creation), 忽略 removes it from the pool, 全部应用 applies every pending row. The section is hidden before the first check and collapses to one line when everything is resolved.
- Trade grades ride the tag mechanism (评级即标签): `A级交易` already exists as a red tag; `AA级交易`/`AAA级交易` are user-created red tags the AI can then suggest with evidence — no separate grade field.

### Card Re-Split (AI 重拆此卡, 0.3.4; two-step preview since 0.3.6)

Review-time rescue for cards that swallowed multiple bars (production reality: intermediate-phase running commentaries up to 1700 chars). The card `···` menu (shared timeline → both Case page and Trade 案例 tab) offers AI 重拆此卡; since 0.3.6 it is **two-step with a preview**: the AI runs first (`preview_case_card_resplit`) and the segments open in a preview dialog where the user can edit each segment's text and barRef, merge a segment into the previous one, and confirm with 替换为 N 张 (destructive) — the dialog itself is the confirmation, the old pre-AI confirm is gone. Confirming calls `apply_case_card_resplit(cardId, originalText, segments)`: the original card's rawText is re-read and compared against the preview-time text (`originalText` round-tripped from the frontend) — edited or deleted mid-flight aborts the replace. Under 60 chars is rejected up front; fewer than 2 segments cannot be applied (edit text via ✎ instead).

- Degradation policy is the inverse of batch split: no provider, network failure, or failed parse (after one repair round) → explicit error with the specific validation reason, the original card untouched (a destructive replacement must not lose `aiAnalysis`/`rawTextHistory` for nothing). The preview step never persists anything, so a canceled dialog changes nothing.
- Apply path (`run_card_resplit_apply` → `persist_resplit`, same short-lock discipline): the original is soft-deleted (attachments follow, identical to card delete), N new cards are created at `createdAt = original + i` (position preserved; a fresh `rs-` request id per run so upserts never resurrect soft-deleted rows), `entryDecision` and the first segment's `barRef` are inherited, and both suggestion blobs lose entries pointing at the original card. New cards then auto-analyze (`autoAnalyze` gate). The store absorbs the returned cards and prunes dangling suggestions immediately (data-changed event still lands as backup).
- GUI-only Tauri commands (`preview_case_card_resplit` + `apply_case_card_resplit`); failure reasons show inline near the card and in the AI task center (`kind: 'split'`). No REST/widget route.

### Card Text Editing Assist (编辑原文 / AI 重写 / AI 校对, 0.3.7)

The card `···` menu (shared timeline) hosts three text actions; the raw text stays the single source of truth (no rewrite field, no dual text):

- **编辑原文**: the former「修正原文错字」upgraded to a full editor (large textarea, 存档/过期 hint, 恢复原文 when the draft differs; save disabled until the text actually changes). Saving goes through the normal `updateCaseCardText` path — previous wording into `rawTextHistory`, `rawTextEditedAt` stamped, AI analysis marked stale.
- **AI 重写** (`draft_case_card_rewrite`, GUI-only, task kind `rewrite`): generates a cleaned draft (filler/repetition/off-topic removed, first-person voice and every number kept verbatim). Rust validates mechanically — every number token of the original must survive and the length ratio must stay within 30%–110% — with one repair round, erroring otherwise. The draft never persists: the frontend pre-fills it into the 编辑原文 editor and the user edits and saves (the pen stays human).
- **AI 校对** (`proofread_case_card`, GUI-only, task kind `proofread`): returns oldText→newText pairs for likely errors (mis-transcriptions, numbers contradicting the bound Trade's facts — the context block reuses `bound_trade_lines`, out-of-range BARs). `oldText` must be a verbatim substring (invalid pairs drop silently, ≤10). The review dialog (`components/case-card-correction-dialog.tsx`) checks pairs with reasons, supports manual pairs (validated live against the current text), previews the combined result (`lib/case-card-corrections.ts` — sequential application, failures flagged, never silently skipped), and applying is one normal text edit. Empty result toasts 未发现明显错误 without opening anything.

### Case Summary (整单 AI 总结, 0.3.0)

A whole-case narrative summary, generated once when the bound Trade flips to closed (auto, `autoSummary` setting default on — hooked in `updateTrade`/`setTradeStatus` on the open→closed transition) or on demand (生成总结/重新总结, with the shared 带要求重试 pattern). Because metrics and plan-vs-actual live in TypeScript, the context is assembled on the frontend (`buildCaseSummaryContext` in `lib/case-summary.ts`) and Rust is a thin pipeline (`ai_summarize_case` → `build_summary_messages` + `parse_summary`, version `0.3.0-summary-1`).

- Context: case title/status, symbol/period/account, the trade's metrics (entry/exit times+prices, duration, PnL, both R values, initial plan vs final stop), the raw execution timeline, and all cards (digest when fresh + raw text capped at 500 chars). Unbound cases summarize as observation-only records.
- Output stored as `TradeCase.aiSummary` (versioned blob: overview one-liner, 2–4 paragraph narrative, ≤6 highlights, ≤6 missing items). Prompt hard rules: facts and deviations only, no scoring or verdicts (process judgment stays human), nothing beyond the context, numbers win over card narration with conflicts juxtaposed rather than adjudicated. Staleness: if any card was created or edited after `analyzedAt` the card shows an 过期 chip with re-run.
- Emphasis markup (0.3.4, prompt `0.3.4-summary-2`): the narrative may mark key facts with `**加粗**`, problems/deviations with `!!红!!`, and executed-well moments with `==绿==` (restrained, ≤15 in prompt). Rust `sanitize_summary_markup` validates before persisting — unpaired, empty, newline-crossing, nested, or over-budget (>20) markers are stripped while the text is always kept. The frontend (`lib/summary-markup.ts`) parses the same grammar for rendering (bold; red/green 2px colored underline matching card-label highlighting); 填入复盘备注 strips all markers because the review note renders as plain text; older summaries without markers pass through unchanged.
- Display: Trade page 复盘 Tab hosts the full card (top, above 结果事实); the Case page hosts a compact card (overview + first paragraph + highlights) that switches to full when the Case is unbound. A 填入复盘备注 button (only when `trade.note` is empty) inserts the summary as an editable draft, never overwriting an existing note.

### Process Score (Trade 分析)

Display aggregation treats iceberg fills honestly: same-bar same-price same-side fills (one submission split by the exchange) merge into a single display row — `Entry (2)` / `Exit (2)` with summed quantity and weighted price. Data is never merged, only presentation.

Account equity is a derived snapshot: after trades change, the frontend recomputes each Account's `equity` = `initialBalance` + Σ closed-trade PnL and writes it back onto the Account record (unchanged values don't rewrite). The local REST API exposes it with the account payload, and the capture widget shows balance plus 1% / 2% fixed-risk amounts for position sizing. The trades table's PnL% column divides each closed trade's PnL by equity before that trade (`equityBeforeByTrade`, initial balance plus all earlier closed PnLs by close order), making risk-budget violations (e.g. a loss beyond the fixed 2%) visible at a glance.

The Trade tab hosts the ten-point process scorecard (`lib/process-score.ts`, `components/trade-process-score.tsx`). Mechanical items derive live: memo completeness from the bound Case's Entry Card analysis (missing fields count), planned risk-reward from entry/stop/target prices (memo strings, `initialEntryPrice`/`initialStopLoss`/`initialTakeProfit` fallbacks), and stop-only-tightened from the stop Execution sequence (direction-aware). Judgment items (structure valid, entry discipline, exit per plan, unplanned-action count) are human inputs; saved scores snapshot the derivation into `Trade.processScore.computed` so the evaluation stays anchored to decision-time facts. R is displayed beside the score and never contributes to it. Since 0.3.4 the score surfaces outside the 评估 tab too: the trade list filter offers 已评分 next to 未评分 (`flagScored`, mutually exclusive — both checked matches nothing), and the 复盘 sidebar 结果 card shows a one-line 过程分 x / 10 with a 「未评分，去评分」 jump link when absent; the trade list itself gains no column.

## Diagnostics & Logging (0.3.6)

Logs live in `logs/cairn-YYYY-MM-DD.log` under the app data dir — one file per local day, multiple launches the same day append under a startup separator header (version + OS), and startup prunes files older than 14 days. The legacy single `cairn.log` stops being written but stays in place. `src-tauri/src/diagnostics.rs` keeps the current day's file open behind a mutex (no per-line open/close) and switches files automatically at midnight.

- Line format `[timestamp] [level] [target] message` with levels info/warn/error; the frontend's error level is honored (`frontend_log` gained a `level` parameter — previously dropped on the Rust side). Panics write into the current day's file (with the temp file as a pre-init fallback).
- AI requests log in full (see Card AI Analysis): request/response bodies truncated at 16KB, API keys never written.
- Tauri commands: `read_logs(date?)` returns `{files, active, content}` (content tail-capped at 512KB, cut at a line boundary), `clear_logs(date?)` truncates one file, `get_logs_dir` + `open_logs_dir` (opens the OS file manager). The Settings → 日志 tab renders them with a date dropdown, level + keyword filtering (read-side only — the file keeps everything), 2s auto-refresh, copy, clear (behind the app-wide confirm), and open-folder.

## Backup

Cairn exports JSON backups containing a version, timestamp, backup kind, and full hydrated state. Restore replaces the local app state.

Manual backups are written under the app data directory in `backups/`. Automatic backups are written to `backups/auto/`. The app creates one automatic backup the first time local state is loaded each local calendar day, and keeps the latest seven daily automatic backups. Automatic retention does not remove manual exports.

Future backup sync should upload encrypted backup files only; it should not become realtime sync.

## Packaging

The app is built with Tauri 2. Windows bundles are MSI and NSIS. macOS packaging remains a target; Linux can be built when convenient but is not a primary user target.

## Historical References

Legacy V0/backend/mock-data references live under `reference/legacy/`. They are not part of the active app architecture.
