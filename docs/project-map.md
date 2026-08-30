# Cairn Project Map

Detailed per-file map of the codebase. AGENTS.md carries only the top-level orientation; this file is the reference for "where does X live".

**Maintenance rule:** when a task adds, removes, or repurposes a file — or changes what a key module owns — update this map in the same branch. A session should be able to answer file-location questions by reading this file instead of launching search agents. If this map and the code disagree, fix the map before anything else.

## Quick Index: "Where do I…"

| Task | Go to |
| --- | --- |
| Bar number ↔ UTC time math | `lib/bar-time.ts` (TS; `resolveCaseCardTimesForTrade` = trade-anchored card resolution) · `src-tauri/src/api.rs` `extract_bar_ref` (Rust twin) |
| PnL / R / equity / drawdown / risk decomposition / PnL% base | `lib/metrics.ts` (incl. `equityBeforeByTrade`) |
| Case auto-close derivation | `lib/case-auto-close.ts` |
| Import Case matching (green/yellow/red; chart-axis barRef + price corroboration) | `lib/case-import-matching.ts` (`analyzeCaseTradeMatch` shared with AI binding prefilter) |
| Trade list advanced filter + presets | `lib/trade-filters.ts` + `components/trade-filter-menu.tsx` |
| Which Executions change position | `lib/executions.ts` (`POSITION_EXECUTION_ACTIONS`, `isPositionExecutionAction`) |
| Card raw-text edit / history enforcement | `src-tauri/src/db.rs` `save_case_card` |
| Card delete (soft) | store `deleteCaseCard` · REST `DELETE /cases/:id/cards/:cardId` (api.rs) · widget ✕ |
| Local REST endpoints & auth | `src-tauri/src/api.rs` (`handle_request`, port 8787, token in `api-config.json`); batch-split dispatch lives in the server loop → `lib.rs batch_split_endpoint` |
| AI provider config / chat / prompts / auto-analysis & retry / AI settings | `src-tauri/src/ai.rs` (analysis/suggestion/summary/binding/split prompts + parsers + `chat_completion_with_retry` + `AiSettings`/`spawn_auto_analysis`/`spawn_auto_suggestions`) |
| AI card-analysis background context assembly | `lib.rs card_context` (symbol + bound-trade actions + previous card digests) |
| AI execution suggestions (说了没记录对账；面板名「AI 补录建议」) | command `suggest_case_executions` (lib.rs, context + dedup, failure logged) · UI `components/case-execution-suggestions.tsx` · blob `TradeCase.aiExecutionSuggestions` |
| AI whole-case summary (streaming) | context `lib/case-summary.ts buildCaseSummaryContext` · command `ai_summarize_case` (stream: true, `cairn://ai-stream` deltas tagged by taskId) · UI `components/case-summary-card.tsx` (live stream block) · blob `TradeCase.aiSummary` |
| AI task center (0.3.1) | registry `store.aiTaskList` (GUI tasks via `beginAiTask`/`completeAiTask`; REST background tasks via `cairn://ai-task` events from `ai.rs emit_task_event` — auto analysis/suggestions + `batch_split_endpoint`) · UI `components/ai-task-center.tsx` (sidebar bottom, badge = unread finished) |
| AI binding suggestions (Case↔Trade 关联推荐) | prefilter+context `lib/binding-suggestions.ts` · command `ai_suggest_bindings` · UI `components/binding-suggestions.tsx` (Trade Case tab / Case page / import step 3) |
| Batch voice split (批量拆卡) | `lib.rs run_batch_split` + `ai.rs build_split_messages`/`parse_card_splits` · widget 「拆卡」勾选 → `POST /cases/:id/cards/batch-split` |
| Case phases, prompts, label colors, memo fields, digest | `lib/cases.ts` (`CASE_PHASE_*`, `CASE_CARD_LABEL_META`, `CASE_MEMO_FIELD_LABEL`, `caseCardDigest`, `isCaseCardAnalysisStale`) |
| Process score derivation | `lib/process-score.ts` (incl. `firstPlausibleNumberIn` magnitude-guarded price extraction) |
| Readable relative time (N 分钟前 / 昨天 / MM-DD) | `components/relative-time.tsx` · `fmtRelativeTime` in `lib/format.ts` |
| Store mutations (create/move/edit/delete cards, barRef & analysis correction, analyze, suggestions, summary, plan prefill) | `lib/store.tsx` |
| Frontend unit tests (vitest) | `lib/bar-time.test.ts`, `lib/execution-display.test.ts`, `lib/process-score.test.ts`, `lib/case-summary.test.ts`, `lib/format.test.ts`, `lib/metrics.test.ts`, `lib/case-import-matching.test.ts` (`pnpm test`) |
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
- `trades/page.tsx`: trade list. `trades/new/page.tsx`: manual creation. `trades/[tradeId]/page.tsx`: trade detail — tabs 复盘/案例/评估 (keys stay `overview`/`case`/`trade`, default 复盘): 复盘 = chart (case markers clickable, 轨迹线/入场线 toggles) + 时间线 + sidebar (标签 / 结果 PnL·R·均价·时长 / 交易备注常显 / 元信息 / Case 单行链接); 案例 = binding panel + `CaseSummaryCard` (generation entry) + AI 补录建议 + shared timeline; 评估 = 结果事实 (+风险网格, R 口径 ⓘ) + 计划 vs 实际 (偏差列) + 过程分.
- `cases/page.tsx`: Case list/filter/create. `cases/[caseId]/page.tsx`: Case detail — Case 概要, AI 总结 (`CaseSummaryCard`, compact when bound), 新增 Card 表单（BAR 可留空自动提取）, 心路历程（含全部识别、AI 拟题、移动 Card、rawText 修正、删除 Card、AI 识别与落款行）, sidebar AI 找 Trade + Trade Binding.
- `data/page.tsx`: chart data import, coverage, candle library.
- `import/page.tsx`: TradingView import flow.
- `notes/page.tsx` + `notes/[noteId]/edit/page.tsx`: Markdown notes with `[[trade:ID]]` / `[[image:…]]` mentions.
- `settings/page.tsx`: tabs — 通用、本地 API（token/端口、浮窗脚本复制 + GitHub 更新检查、端点速查）、网络（出站代理，0.3.2）、AI（providers 多模型 + 思考等级）、日志/诊断/备份。

## UI Components (`components/`)

Shared page pieces: `page-header.tsx`, `stat-card.tsx` (single-line values, `title` tooltip fallback), `pnl-text.tsx` (`PnlText`/`RText`), `sparkline.tsx`, `equity-chart.tsx` (lightweight-charts area/baseline + MA toggle 关 → MA(20 笔) → MA(30 天), shared by dashboard/account/period), `trades-table.tsx` (reusable, exports `DirectionBadge`/`StatusBadge`), `trade-chart.tsx` (chart + overlays + case markers), `attachment-image.tsx`, `backup-card.tsx`, `coverage-timeline.tsx`, `window-titlebar.tsx`, `app-sidebar.tsx` (bottom row: `ai-task-center.tsx` + theme toggle), `info-hint.tsx` (ⓘ tooltip for 计算口径/规则说明 — the standard place for calculation explanations).

Case & AI: `case-card-timeline.tsx` (shared editable 心路历程 timeline for the Case page and Trade Case tab — collapse/expand with digest summary rows, BAR inline edit, AI 识别 re-run, card ops ✎/移动/删除 in a `···` menu, batch 全部识别, target-card highlight), `trade-case-panel.tsx` (Trade→Case binding + AI 找 Case; bound top card is one line 标题+状态+卡片数; renders `CaseSummaryCard` + suggestions + shared timeline; `TradeCaseSummaryCard` = 复盘 sidebar one-line Case link), `case-execution-suggestions.tsx` (AI 补录建议: 直接添加/修改后添加/忽略; collapses to one line when all resolved; busy/error from store `aiTasks`), `case-summary-card.tsx` (整单 AI 总结, full/compact variants, 填入复盘备注/重新填入 confirm-overwrite; busy/error from store `aiTasks`), `binding-suggestions.tsx` (`BindingSuggestForTrade` / `BindingSuggestForCase`), `case-tag-badge.tsx`, `manage-case-tags-dialog.tsx`, `create-case-dialog.tsx`, `case-card-analysis.tsx` (`HighlightedCaseCardText` underline rendering + `EditableHighlightedCaseCardText` label-editing mode + `CaseCardAnalysisView` compact footer, memo popover with correction editor, dismissible 需重新识别 badge), `ai-retry-button.tsx` (`AiRetryLink` instruction-retry popover), `trade-process-score.tsx` (ten-point scorecard, header total when saved, philosophy in ⓘ), `relative-time.tsx` (`RelativeTime` readable relative time, hover shows full UTC), `trade-plan-compare.tsx` (计划 vs 实际 incl. entry price row, 补录/来自卡片 source tags, 偏差 column, sources in ⓘ), `trade-filter-menu.tsx` (trade list advanced filter dropdown + preset dialogs + chips).

Dialogs live under `components/*-dialog.tsx` (edit-trade, manage-tags, create-symbol, ai-provider-dialog with preset logos + multi-model list with per-model thinking levels since 0.3.2…). Dashboard-only pieces under `components/dashboard/`. Base primitives under `components/ui/` (dialog, select, popover (base-ui Positioner pattern), dropdown-menu, tabs, switch, tooltip, table, …).

## Frontend Domain & Data Layer (`lib/`)

- `types.ts`: all domain types incl. `CaseCard` (with `rawTextHistory`/`rawTextEditedAt`/`aiAnalysis`), `CaseCardAnalysis`, `TradeProcessScore`, `Execution`, `Trade`.
- `seed.ts`: empty/initial state shape (browser dev + first load).
- `store.tsx`: context store — hydration (`loadLocalState → normalizeSnapshot`), mutations (`createCaseCard` (nullable barRef), `moveCaseCard`, `updateCaseCardText`, `updateCaseCardBarRef`, `deleteCaseCard`, `updateCaseCardAnalysis`, `analyzeCaseCard`, `refreshCaseExecutionSuggestions` + status updates, `summarizeCase`, bindings, imports…), `aiTasks` (store-level busy/error for manual 总结/补录建议检查 — survives tab navigation), binding-time auto-title + auto execution-suggestions + open→closed auto-summary (`stateRef` freshness), Entry-memo plan prefill effects, account equity snapshot effect, `cairn://data-changed` debounce refresh.
- `local-db.ts`: Tauri invoke wrappers + browser fallbacks (`isTauriRuntime()`, `analyzeCaseCard`, `suggestCaseExecutions`, `summarizeCase`, `suggestBindings`, `draftCaseTitle`, `getAiSettings`/`saveAiSettings`, `getNetworkSettings`/`saveNetworkSettings` (0.3.2 代理), API status, AI providers incl. `AiModelConfig` multi-model list + `AiThinkingLevel`).
- `cases.ts`: phase options/prompts/labels, display rules (`displayPhaseForCaseCard`), `extractExplicitBarRef`, `isDefaultCaseTitle`, `deriveMissingFields`, digest helpers (`caseCardDigest`, `isCaseCardAnalysisStale`), AI label & memo metadata.
- `case-summary.ts`: `buildCaseSummaryContext` (pure — metrics/plan/execution timeline + card digests fed to `ai_summarize_case`).
- `binding-suggestions.ts`: mechanical prefilter (same account, unbound, strong-match-first + chart-axis distance via `case-import-matching.ts candidateRank`) + both-direction AI contexts + `zipBindingSuggestions`.
- `process-score.ts`: `deriveProcessFacts` (memo completeness, planned RR with `PROCESS_RR_THRESHOLD = 2`, stop-only-tightened), `firstNumberIn`, `firstPlausibleNumberIn` (magnitude-guarded vs reference price), `savedProcessScoreTotal` (saved-score total from computed snapshot).
- `case-auto-close.ts`: auto-close derivation + `isTradeFullyClosed`.
- `case-import-matching.ts`: import-time Case↔Trade matching (0.3.3 rewrite) — chart axis (`resolveCaseCardTimesLoose`: barRef anchored to the trade's first-fill day, timeframe scan 1–60m, ≤30min backtracks clamp in-place), clock-axis fallback, price corroboration (memo stop/target/entry vs trade facts, 0.2%), direction mismatch demotes; `analyzeCaseTradeMatch` exported for the AI binding prefilter; greedy unique assignment for auto-binds (exact ties stay manual).
- `trade-filters.ts`: advanced filter conditions, matcher, chips summary, localStorage presets.
- `metrics.ts`, `executions.ts`, `execution-display.ts`: metric helpers (`equityBeforeByTrade` for PnL%, `computeEquityMaByTrades`/`computeEquityMaByDays` MA overlays), execution classification, display aggregation (iceberg: same-bar same-price same-side fills merge into one row, entries and exits).
- `tradingview-import.ts`, `trade-duplicates.ts`, `trade-transfer.ts`: import/grouping, dedupe, shape transfer.
- `chart-data.ts`, `chart-datasets.ts`, `chart-timeframes.ts`, `bar-time.ts`: candles, coverage, timeframe, bar↔time.
- `tags.ts`: tag normalization/uniqueness/color order.
- `note-mentions.ts`, `clipboard-images.ts`, `frontend-log.ts`, `format.ts` (incl. `fmtCompactMoney` K/M/B for stat cards), `utils.ts`.

## Native Tauri Layer (`src-tauri/src/`)

- `lib.rs`: builder, command registration (incl. `analyze_case_card`, `suggest_case_executions`, `ai_summarize_case`, `ai_suggest_bindings`, `draft_case_title`, `get_ai_settings`/`save_ai_settings`, `fetch_ai_models`, API config commands, widget script commands `get_widget_script`/`check_widget_script_update` — bundled via `include_str!` + GitHub main check through the Contents API), `run_card_analysis` + `card_context` (background context assembly) shared by manual command and REST auto-analysis, `run_execution_suggestions` (context + mechanical dedup + fingerprint status merge), `run_batch_split` + `batch_split_endpoint` (voice batch split; endpoint dispatched at the api server loop so `handle_request` stays GUI-free and test-linkable), attachment file IO, setup hook (starts api server thread, daily auto-backup).
- `db.rs`: SQLite schema/migrations, `save_record_in_tx` dispatcher (per-collection validators; `save_case_card` auto-versions rawText history), soft deletes, read helpers (`read_case_cards_for_case`, `read_record_by_id`, `read_trade_with_children`), backup/restore, state hydration.
- `api.rs`: local REST — `handle_request` routes (`/api/v1/…`: health, cases, cards incl. `PUT cases/{id}/cards/{cardId}` correction + `DELETE` soft delete, bindings, case-tags, accounts), Bearer token, idempotent create, `extract_bar_ref`, CORS + OPTIONS, emits `cairn://data-changed`; new-card POSTs trigger `ai::spawn_auto_analysis`, binding POSTs trigger `ai::spawn_auto_suggestions` (background, settings-gated).
- `ai.rs`: provider CRUD (`ai-providers.json`; multi-model `models` + legacy backfill since 0.3.2; `set_default` since 0.3.3 — list-level default switching, `save` preserves `is_default` on edit), `apply_thinking_param` (统一思考等级 → per-preset 原生参数映射; GLM-5.3* cannot disable thinking — `off` degrades to enabled+`reasoning_effort:low`), `NetworkSettings` (`network-settings.json`, 0.3.3 modes system/manual/off + legacy `proxyEnabled` migration) + `http_client()`/`refresh_proxy`/`effective_proxy_url` (出站代理: `sysproxy` OS detection, process-global `PROXY_STATE`; updater plugin gets the resolved URL from the frontend via `check({proxy})`), `fetch_models`, `chat_completion` + `chat_completion_with_retry` (one auto retry on network-class errors), `chat_completion_stream`(+`_with_retry`) — SSE via `response.chunk()` (no extra reqwest feature; connect 15s + read 30s instead of total 90s; falls back to full-body when the provider ignores `stream`; post-content interruption is not retried), `describe_request_error`/`join_source_chain`/`http_error_message` (中文网络错误详情：超时/连接/DNS 分类 + 401/404/429 提示), `AiSettings` (`ai-settings.json`, `autoAnalyze`/`autoSuggest`/`autoSummary`), `spawn_auto_analysis`/`spawn_auto_suggestions` (emit `AI_TASK_EVENT` start/succeeded/failed + `DATA_CHANGED_EVENT`), `emit_task_event`/`next_task_id` (`cairn://ai-task` payload with target+error), analysis prompt v3 (digest + context rules) + `parse_analysis`, suggestion prompt + `parse_execution_suggestions`, summary prompt + `parse_summary`, binding prompt + `parse_binding_matches`, split prompt + `parse_card_splits`, title prompt + `parse_title`; env-gated e2e tests incl. `ai_chat_e2e_stream` (`CAIRN_AI_E2E=1`).
- `paths.rs`, `diagnostics.rs`, `main.rs`: app-data paths, panic hook/logs, entrypoint.
- Config: `tauri.conf.json` (+ windows/local variants), `capabilities/default.json`, `Cargo.toml`.

## Scripts & Docs

- `scripts/dev-isolated.ps1`: isolated dev data dir (`CAIRN_DATA_DIR` → `%LOCALAPPDATA%/Cairn/dev-profile`). `release.ps1`: release helper.
- `scripts/cairn-case-widget.user.js`: Tampermonkey widget (light DOM under `#cairn-cw-wrap` with scoped styles, GM_xmlhttpRequest, current-Case session header, balance + user-configurable risk-percent strip (up to 3 tiers, Settings → 仓位提示), per-phase checklist hint 「这张卡可以覆盖：…」, window-capture key isolation so TradingView shortcuts never fire while typing in the panel, theme modes 跟随 TradingView/深色/浅色 (`color-scheme` + `.cw-root.light` variable overrides), inline card correction via ✎ on each card (`PUT /cases/{id}/cards/{cardId}`, degrades to an upgrade hint on pre-0.2.2 backends), card delete via ✕ (`DELETE`, pre-0.3.0 hint), batch voice split via the explicit 「拆卡」 checkbox (no anchor pre-detection since 0.3.1 — checking disables the BAR input, split anchors come from the card text; sticky across submits, 200s timeout, auto-falls back to single-card POST on pre-0.3.0 backends), entry-card missing-fields AI polling that upgrades the regex completeness hint). `cairn-case-widget.test.html`: GM-shim harness with a 「模拟 TradingView 深色」 toggle for theme-auto testing (serve it and the API from one port — e.g. a tiny local mock — then point the widget port at it).
- `docs/software-design.md`: product/data/API/AI design. `docs/copy-style.md`: 文案与术语规范 (terminology + copy rules — read before writing UI copy). `docs/development-plan-0.2.0.md`, `docs/development-plan-0.2.1.md`, `docs/case-recording-0.2.0.md` (§13 = 0.2.1 addendum): plan + feature design. `docs/development-workflow.md`: release checklist. `docs/user-guide.md`: end-user tutorial (setup, widget install, workflow). `docs/release-0.1.x.md`/`docs/release-0.2.x.md`, `docs/mock/` (widget mock), `reference/legacy/` (historical only).

## Storage Collections (SQLite ↔ store keys)

| Collection | Table | Notes |
| --- | --- | --- |
| accounts / periods / symbols / trades / notes / tagDefs / caseTagDefs |同名 snake_case | soft delete `deleted_at` |
| cases | cases | `status`, `provenance`, `tagIds` |
| caseCards | case_cards | `raw_text` column + full JSON in `data`; history/editedAt enforced in `save_case_card` |
| caseBindings | case_bindings | one-to-one enforced in api + store |
| importBatches / chartImports / chartCandles / attachments | … | import & chart domain |
