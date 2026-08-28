# Cairn Project Map

Detailed per-file map of the codebase. AGENTS.md carries only the top-level orientation; this file is the reference for "where does X live".

**Maintenance rule:** when a task adds, removes, or repurposes a file — or changes what a key module owns — update this map in the same branch. A session should be able to answer file-location questions by reading this file instead of launching search agents. If this map and the code disagree, fix the map before anything else.

## Quick Index: "Where do I…"

| Task | Go to |
| --- | --- |
| Bar number ↔ UTC time math | `lib/bar-time.ts` (TS; `resolveCaseCardTimesForTrade` = trade-anchored card resolution) · `src-tauri/src/api.rs` `extract_bar_ref` (Rust twin) |
| PnL / R / equity / drawdown / risk decomposition / PnL% base | `lib/metrics.ts` (incl. `equityBeforeByTrade`) |
| Case auto-close derivation | `lib/case-auto-close.ts` |
| Import Case matching (green/yellow/red) | `lib/case-import-matching.ts` |
| Trade list advanced filter + presets | `lib/trade-filters.ts` + `components/trade-filter-menu.tsx` |
| Which Executions change position | `lib/executions.ts` (`POSITION_EXECUTION_ACTIONS`, `isPositionExecutionAction`) |
| Card raw-text edit / history enforcement | `src-tauri/src/db.rs` `save_case_card` |
| Local REST endpoints & auth | `src-tauri/src/api.rs` (`handle_request`, port 8787, token in `api-config.json`) |
| AI provider config / chat / prompts / auto-analysis & retry / AI settings | `src-tauri/src/ai.rs` (prompts + `parse_analysis`/`parse_title` + `chat_completion_with_retry` + `AiSettings`/`spawn_auto_analysis`) |
| Case phases, prompts, label colors, memo fields | `lib/cases.ts` (`CASE_PHASE_*`, `CASE_CARD_LABEL_META`, `CASE_MEMO_FIELD_LABEL`) |
| Process score derivation | `lib/process-score.ts` |
| Readable relative time (N 分钟前 / 昨天 / MM-DD) | `components/relative-time.tsx` · `fmtRelativeTime` in `lib/format.ts` |
| Store mutations (create/move/edit cards, barRef & analysis correction, analyze, plan prefill) | `lib/store.tsx` |
| Frontend unit tests (vitest) | `lib/bar-time.test.ts`, `lib/execution-display.test.ts` (`pnpm test`) |
| TradingView import parsing | `lib/tradingview-import.ts`, page `app/import/page.tsx` |
| The floating TradingView widget | `scripts/cairn-case-widget.user.js` + `scripts/cairn-case-widget.test.html` |

## App Entrypoints

- `src/main.tsx`: React mount.
- `src/App.tsx`: route table (`createHashRouter`), app shell, sidebar, titlebar, providers, page transitions.
- `app/globals.css`: Tailwind theme, dark scrollbar adaptation, layout animation, app-wide styles.
- `index.html`: Vite HTML entry.

## Pages (`app/`)

- `page.tsx`: dashboard.
- `accounts/page.tsx`: account list. `accounts/[accountId]/page.tsx`: account detail. `accounts/[accountId]/periods/[periodId]/page.tsx`: period detail.
- `trades/page.tsx`: trade list. `trades/new/page.tsx`: manual creation. `trades/[tradeId]/page.tsx`: trade detail — tabs `Overview` (chart + timeline + notes), `Case` (binding panel), `Trade` (结果事实 + 过程分 `TradeProcessScoreCard`).
- `cases/page.tsx`: Case list/filter/create. `cases/[caseId]/page.tsx`: Case detail — 新增 Card 表单、心路历程（含全部 AI 整理、AI 拟题、移动 Card、rawText 修正、AI 整理与落款行）。
- `data/page.tsx`: chart data import, coverage, candle library.
- `import/page.tsx`: TradingView import flow.
- `notes/page.tsx` + `notes/[noteId]/edit/page.tsx`: Markdown notes with `[[trade:ID]]` / `[[image:…]]` mentions.
- `settings/page.tsx`: tabs — 通用、本地 API（token/端口、浮窗脚本复制 + GitHub 更新检查、端点速查）、AI（providers）、日志/诊断/备份。

## UI Components (`components/`)

Shared page pieces: `page-header.tsx`, `stat-card.tsx`, `pnl-text.tsx` (`PnlText`/`RText`), `sparkline.tsx`, `trades-table.tsx` (reusable, exports `DirectionBadge`/`StatusBadge`), `trade-chart.tsx` (chart + overlays + case markers), `attachment-image.tsx`, `backup-card.tsx`, `coverage-timeline.tsx`, `window-titlebar.tsx`, `app-sidebar.tsx`.

Case & AI: `case-card-timeline.tsx` (shared editable 心路历程 timeline for the Case page and Trade Case tab — collapse/expand, raw-text typo fix, BAR inline edit, AI re-run, move-to-Case, batch analyze, target-card highlight), `trade-case-panel.tsx` (Trade→Case binding + summary; Case tab renders the shared timeline), `case-tag-badge.tsx`, `manage-case-tags-dialog.tsx`, `create-case-dialog.tsx`, `case-card-analysis.tsx` (`HighlightedCaseCardText` underline rendering + `EditableHighlightedCaseCardText` label-organizing mode + `CaseCardAnalysisView` compact footer, memo popover with correction editor, dismissible stale badge), `ai-retry-button.tsx` (`AiRetryLink` instruction-retry popover), `trade-process-score.tsx` (ten-point scorecard, header total when saved), `relative-time.tsx` (`RelativeTime` readable relative time, hover shows full UTC), `trade-plan-compare.tsx` (计划 vs 实际 incl. entry price row + 录/卡 source markers), `trade-filter-menu.tsx` (trade list advanced filter dropdown + preset dialogs + chips).

Dialogs live under `components/*-dialog.tsx` (edit-trade, manage-tags, create-symbol, ai-provider-dialog with preset logos…). Dashboard-only pieces under `components/dashboard/`. Base primitives under `components/ui/` (dialog, select, popover (base-ui Positioner pattern), dropdown-menu, tabs, switch, tooltip, table, …).

## Frontend Domain & Data Layer (`lib/`)

- `types.ts`: all domain types incl. `CaseCard` (with `rawTextHistory`/`rawTextEditedAt`/`aiAnalysis`), `CaseCardAnalysis`, `TradeProcessScore`, `Execution`, `Trade`.
- `seed.ts`: empty/initial state shape (browser dev + first load).
- `store.tsx`: context store — hydration (`loadLocalState → normalizeSnapshot`), mutations (`createCaseCard`, `moveCaseCard`, `updateCaseCardText`, `updateCaseCardBarRef`, `updateCaseCardAnalysis`, `analyzeCaseCard`, bindings, imports…), binding-time auto-title + Entry-memo plan prefill effects, account equity snapshot effect, `cairn://data-changed` debounce refresh.
- `local-db.ts`: Tauri invoke wrappers + browser fallbacks (`isTauriRuntime()`, `analyzeCaseCard`, `draftCaseTitle`, `getAiSettings`/`saveAiSettings`, API status, AI providers).
- `cases.ts`: phase options/prompts/labels, display rules (`displayPhaseForCaseCard`), `extractExplicitBarRef`, `isDefaultCaseTitle`, `deriveMissingFields`, AI label & memo metadata.
- `process-score.ts`: `deriveProcessFacts` (memo completeness, planned RR with `PROCESS_RR_THRESHOLD = 2`, stop-only-tightened), `firstNumberIn`, `savedProcessScoreTotal` (saved-score total from computed snapshot).
- `case-auto-close.ts`: auto-close derivation + `isTradeFullyClosed`.
- `case-import-matching.ts`: import-time Case↔Trade matching (exact auto-bind / suggest / none).
- `trade-filters.ts`: advanced filter conditions, matcher, chips summary, localStorage presets.
- `metrics.ts`, `executions.ts`, `execution-display.ts`: metric helpers (`equityBeforeByTrade` for PnL%), execution classification, display aggregation (iceberg: same-bar same-price same-side fills merge into one row, entries and exits).
- `tradingview-import.ts`, `trade-duplicates.ts`, `trade-transfer.ts`: import/grouping, dedupe, shape transfer.
- `chart-data.ts`, `chart-datasets.ts`, `chart-timeframes.ts`, `bar-time.ts`: candles, coverage, timeframe, bar↔time.
- `tags.ts`: tag normalization/uniqueness/color order.
- `note-mentions.ts`, `clipboard-images.ts`, `frontend-log.ts`, `format.ts`, `utils.ts`.

## Native Tauri Layer (`src-tauri/src/`)

- `lib.rs`: builder, command registration (incl. `analyze_case_card`, `draft_case_title`, `get_ai_settings`/`save_ai_settings`, `fetch_ai_models`, API config commands, widget script commands `get_widget_script`/`check_widget_script_update` — bundled via `include_str!` + GitHub main check through the Contents API), `run_card_analysis` shared by manual command and REST auto-analysis, attachment file IO, setup hook (starts api server thread, daily auto-backup).
- `db.rs`: SQLite schema/migrations, `save_record_in_tx` dispatcher (per-collection validators; `save_case_card` auto-versions rawText history), soft deletes, read helpers (`read_case_cards_for_case`, `read_record_by_id`), backup/restore, state hydration.
- `api.rs`: local REST — `handle_request` routes (`/api/v1/…`: health, cases, cards incl. `PUT cases/{id}/cards/{cardId}` card correction, bindings, case-tags, accounts), Bearer token, idempotent create, `extract_bar_ref`, CORS + OPTIONS (PUT allowed), emits `cairn://data-changed`; new-card POSTs trigger `ai::spawn_auto_analysis` (background, settings-gated).
- `ai.rs`: provider CRUD (`ai-providers.json`), `fetch_models`, `chat_completion` (POST /chat/completions, temperature 0) + `chat_completion_with_retry` (one auto retry on network-class errors), `AiSettings` (`ai-settings.json`, `autoAnalyze`), `spawn_auto_analysis`, analysis prompt v2 + `parse_analysis` (seven-field memo incl. `entryPrice`, verbatim-quote validation, mechanical `missingFields`), title prompt + `parse_title`; env-gated e2e tests (`CAIRN_AI_E2E=1`).
- `paths.rs`, `diagnostics.rs`, `main.rs`: app-data paths, panic hook/logs, entrypoint.
- Config: `tauri.conf.json` (+ windows/local variants), `capabilities/default.json`, `Cargo.toml`.

## Scripts & Docs

- `scripts/dev-isolated.ps1`: isolated dev data dir (`CAIRN_DATA_DIR` → `%LOCALAPPDATA%/Cairn/dev-profile`). `release.ps1`: release helper.
- `scripts/cairn-case-widget.user.js`: Tampermonkey widget (light DOM under `#cairn-cw-wrap` with scoped styles, GM_xmlhttpRequest, current-Case session header, balance + user-configurable risk-percent strip (up to 3 tiers, Settings → 仓位提示), per-phase checklist hint 「这张卡可以覆盖：…」, window-capture key isolation so TradingView shortcuts never fire while typing in the panel, theme modes 跟随 TradingView/深色/浅色 (`color-scheme` + `.cw-root.light` variable overrides), inline card correction via ✎ on each card (`PUT /cases/{id}/cards/{cardId}`, degrades to an upgrade hint on pre-0.2.2 backends)). `cairn-case-widget.test.html`: GM-shim harness with a 「模拟 TradingView 深色」 toggle for theme-auto testing (serve it and the API from one port — e.g. a tiny local mock — then point the widget port at it).
- `docs/software-design.md`: product/data/API/AI design. `docs/development-plan-0.2.0.md`, `docs/development-plan-0.2.1.md`, `docs/case-recording-0.2.0.md` (§13 = 0.2.1 addendum): plan + feature design. `docs/development-workflow.md`: release checklist. `docs/user-guide.md`: end-user tutorial (setup, widget install, workflow). `docs/release-0.1.x.md`/`docs/release-0.2.x.md`, `docs/mock/` (widget mock), `reference/legacy/` (historical only).

## Storage Collections (SQLite ↔ store keys)

| Collection | Table | Notes |
| --- | --- | --- |
| accounts / periods / symbols / trades / notes / tagDefs / caseTagDefs |同名 snake_case | soft delete `deleted_at` |
| cases | cases | `status`, `provenance`, `tagIds` |
| caseCards | case_cards | `raw_text` column + full JSON in `data`; history/editedAt enforced in `save_case_card` |
| caseBindings | case_bindings | one-to-one enforced in api + store |
| importBatches / chartImports / chartCandles / attachments | … | import & chart domain |
