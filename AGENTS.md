# CAIRN Development Notes

This file is loaded at the start of Codex sessions. Keep it useful. When the app structure, commands, release flow, or domain model changes, update this file in the same branch as the code change.

## Working With Leo

- Usually respond to Leo in Chinese. Keep technical names such as Tauri, React, SQLite, TradingView, Execution, and ChartData in English when that is clearer.
- Be direct and concrete. Prefer short implementation notes over broad explanations.
- Leo prefers thinking through the work before action. If the request is ambiguous, ask before editing.
- If Leo says "开始干", the task is considered clear enough: say what technology/files you will touch, then make the change.
- If Leo is confident but appears mistaken, point it out clearly with the reason.
- Tell yourself before finishing any meaningful task: do not forget to maintain this document and `docs/project-map.md`.

## Product Snapshot

Cairn is a local-first Tauri 2 desktop app for personal trade journaling and review. The primary targets are Windows and macOS; Linux packaging can remain available but is not a priority.

Core workflow:

1. Create Account, Period, and Symbol records.
2. Import TradingView trade exports, optional chart CSV/Excel data, and reference images.
3. Review grouped Trades, Executions, timeline events, chart overlays, tags, and notes.
4. Analyze account, period, and trade performance.
5. Manage imported chart data and coverage.
6. Write Markdown notes that can mention trades and trade images.
7. Back up and restore local data.

Current source of truth: `docs/software-design.md`.

## Start-Of-Session Checklist

- Check branch and dirty state: `git status --short --branch`.
- If development work starts on `main`, create or switch to a version branch. If Leo did not name a version, increment the patch version and use `dev/x.y.z`.
- Read this file before broad project exploration.
- For file locations and module ownership, read `docs/project-map.md` instead of spawning search agents.
- For product behavior or data rules, read `docs/software-design.md`.
- For UI copy and terminology, read `docs/copy-style.md` and follow it whenever writing or changing any user-visible string.
- For release steps, read `docs/development-workflow.md`.
- For version-specific release notes, read `docs/release-x.y.z.md`.
- Do not rewrite page designs unless Leo explicitly asks for a design change.

## Non-Negotiables

- Preserve the existing visual style, layout, text, and page behavior unless the task explicitly names a change.
- Prefer mechanical migration over redesign:
  - keep existing components,
  - keep existing metric helpers,
  - replace framework adapters and mock data only where needed.
- Keep docs current before or alongside implementation changes.
- Use Conventional Commits and keep commits grouped by intent when commits are requested or expected for a stage.
- Touch only files connected to the current request. Mention unrelated issues instead of editing them.

## Architecture

- Frontend: React 19 + Vite + TypeScript.
- Routing: `react-router-dom` configured in `src/App.tsx`.
- Desktop runtime: Tauri 2.
- Native layer: Rust commands for SQLite, filesystem attachments, imports, backups, tray, logs, diagnostics, app metadata, the local REST API, and the AI pipelines (card analysis, execution suggestions, case summaries, binding suggestions, voice batch split). There is no conversational AI chat feature.
- Storage: local SQLite in the Tauri app data directory.
- Future cloud: backup/restore only, not realtime multi-device sync.

## Module Map

The detailed per-file map lives in **`docs/project-map.md`** — every page, component, lib module, Rust module, script, the storage-collection layout, and a "where do I…" quick index. Read it before exploring unfamiliar areas instead of launching search agents, and update it in the same branch whenever files are added, removed, or change ownership.

Top-level orientation:

- Frontend: pages under `app/`, components under `components/`, domain logic under `lib/`, routes in `src/App.tsx`.
- Native: `src-tauri/src/` — `lib.rs` (commands/setup + AI context assembly), `db.rs` (SQLite), `api.rs` (local REST on 127.0.0.1), `ai.rs` (providers + chat completion + all prompts/parsers), `diagnostics.rs` (logs). Batch-split is dispatched at the api server loop (`lib.rs batch_split_endpoint`) so `handle_request` stays GUI-dependency-free and the test binary links cleanly.
- Companion userscript: `scripts/cairn-case-widget.user.js` (+ `scripts/cairn-case-widget.test.html` harness). Distribution is in-app: the script is compiled into the binary (`include_str!`) and Settings → 本地 API → 浮窗脚本 offers copy + a GitHub-main update check (`api.github.com` Contents API, `check_widget_script_update`); network failure degrades to the bundled copy. Bump the script `@version` whenever it changes — version comparison is dot-segment numeric (`version_gt`). 0.3.0 added batch voice split, card delete (✕), and entry-card missing-fields AI polling; 0.3.1 replaced the multi-anchor split precheck with an explicit 「拆卡」 checkbox (checking disables the BAR input — split anchors come from the card text; sticky across submits within a session).

## Domain Rules To Remember

- Time is UTC epoch milliseconds. Bar index is only a UI helper.
- Execution is the trade action timeline. Position-changing Executions are the only fill source for PnL, average prices, realized quantity, duration, and equity.
- Trade-management Executions (`stop`, `target-set`, `target-moved`, `order-edit`) are review/chart events, not fill quantity sources.
- `TradeEvent` remains for imported chart annotations and legacy compatibility.
- Backtest and live trading share the same model; `Account.kind` distinguishes them.
- Imports must not overwrite existing trades. Preserve imported row identity through `sourceRef`.
- Long and short positions are tracked independently during import.
- Normal deletes are soft deletes through `deleted_at`. Full restore and clear-data operations may replace database contents.
- Attachments should move toward app-data relative paths. Existing reference image strings may still be rendered.
- Chart data is normalized by symbol, timeframe, and bar time. Duplicate imports should not duplicate candles.
- Metrics should derive from position-changing Executions, even when `Trade.status` is used for workflow.
- Tag names are trimmed, whitespace-normalized, and unique by case-insensitive comparison.
- Trade tag color is categorical. Display Trade tag groups in red-to-purple color order, then by name within the same color.
- Notes are Markdown with encoded mentions: `[[trade:ID]]` and `[[image:URL_OR_PATH]]`.
- Case can exist before Trade import. Active CaseTradeBinding is one-to-one for both Case and Trade.
- CaseCard raw text is permanent but correctable: typo edits push the previous wording into `rawTextHistory` and stamp `rawTextEditedAt` (enforced by `save_case_card`). AI and mechanical parsing results must never rewrite raw text — that rule binds the AI, not the user: users can also delete a Card outright (soft delete via Case page / widget ✕ / `DELETE /api/v1/cases/{caseId}/cards/{cardId}`; backups restore). On the REST API, idempotent POST replays still reject raw-text changes; deliberate correction is the `PUT /api/v1/cases/{caseId}/cards/{cardId}` route (body `{ rawText, barRef }`, `barRef: null` clears; other fields preserved), which archives history via `save_case_card`.
- AI results on a Card live in `aiAnalysis` as versioned derived data (`schemaVersion`/`promptVersion`/`model`/`analyzedAt`; schema `0.3.0-schema-3` since 0.3.0): `digest` (one-line gist shown on collapsed rows, `caseCardDigest` falls back to raw text), `barRef`, `labels`, entry-phase memo. Quotes must be verbatim substrings of the raw text, unknown labels are dropped, and `missingFields` is derived mechanically from the seven-field memo (direction, entryPrice, stopLoss, target, confidence, invalidation, rejectedAlternatives; emotion optional), not trusted from the model. Analysis carries a background context block (`card_context` in `lib.rs`: symbol, bound-trade execution/event one-liners, ≤6 earlier card digests) that informs but never leaks into quotes/digest. Memo price fields prefer pure-number values; TS extraction uses `firstPlausibleNumberIn` (magnitude-checked vs actual avg entry) instead of raw `firstNumberIn` so K-line numbers / R-multiples never become plan prices.
- AI analysis auto-runs on REST-created Cards (`ai::spawn_auto_analysis`, toggle in Settings → AI, default on; idempotent replays never trigger); every AI call auto-retries once on network-class failures only. Binding a Trade auto-titles Cases that still carry a default placeholder title (`isDefaultCaseTitle` in `lib/cases.ts`).
- Derived data is user-correctable via `updateCaseCardBarRef` / `updateCaseCardAnalysis` (labels, memo values, `staleDismissedAt`): manual edits stamp `userAdjusted` and re-analysis asks first. The shared editable timeline is `components/case-card-timeline.tsx` (Case page + Trade Case tab); cards default to collapsed summary rows.
- AI retry pattern: the card-header Sparkles ghost button runs/re-runs directly; the analysis footer line carries `AiRetryLink` (`components/ai-retry-button.tsx`), a small dotted link opening a popover where the user types a correction instruction appended to the retry request.
- CaseCard membership is repairable: a Card can be moved to another Case from the Case detail page; only `caseId` changes, raw text does not.
- Case card `barRef` is a per-UTC-day index (resets at 00:00) and user-editable (1–1440 or clear). Trade-page resolution (`resolveCaseCardTimesForTrade` in `lib/bar-time.ts`) anchors to the Trade's first position fill day — replay/backtest Card `createdAt` is the recording wall clock, never the chart day. Out-of-range barRefs (e.g. 2265) don't participate and fall back to creation order (flagged invalid); a day-bump that overshoots the chart window falls back to "right after the previous card" (creation order wins over bar arithmetic); cards without a usable barRef inherit previous +1ms. No manual day disambiguation for cross-day Cases.
- Trade plan prices backfill from the bound Case's Entry memo (`firstNumberIn`, empty fields only, one automatic attempt per Trade); closed Trades missing initial stop/target get a first-visit prompt (从 Entry 卡填入 / 手动填写 / 待会儿提醒 / 忽略, localStorage per Trade).
- Iceberg fills: same-bar same-price same-side fills aggregate into one display row (`Entry (2)`/`Exit (2)`, `lib/execution-display.ts`) — display only, data is never merged.
- Account equity is a frontend-recomputed snapshot on the Account record (`equity` = initialBalance + Σ closed PnL); the widget shows balance plus user-configurable risk percentages (up to 3, default 1%/2%, Settings → 仓位提示), and the trades table's PnL% column divides PnL by equity before that trade (`equityBeforeByTrade`). Every equity curve (`components/equity-chart.tsx`, shared by dashboard/account/period) has a built-in MA toggle cycling 关 → MA(20 笔) → MA(30 天) (`computeEquityMaByTrades` / `computeEquityMaByDays` in `lib/metrics.ts`). Stat cards stay single-line: large money values use `fmtCompactMoney` with the full value in the hover title.
- The capture widget follows the current-Case session model: the panel header states the destination Case, switching is on demand, and starting a new Case is the primary organizational action. The widget renders in light DOM under a `#cairn-cw-wrap` container (`cw-`-prefixed ids, `#cairn-cw-wrap`-scoped styles injected into `document.head`; no Shadow DOM) so TradingView's own input-focus guard recognizes its inputs, and a window-capture interceptor (`composedPath` check + stopPropagation; preventDefault only for the widget's own submit/save keys) keeps panel keys away from TradingView shortcut listeners — typing, pasting, and IME composition stay normal.
- Widget theming: Settings → 外观, three modes — 跟随 TradingView (default; watches `theme-dark`/`theme-light` on html/body plus `prefers-color-scheme`), 深色, 浅色. Implemented as CSS-variable overrides on `.cw-root.light` plus `color-scheme` so native controls (select popups, carets, scrollbars) follow; `.cw-select` and the Case trigger draw a shared `--chev` SVG arrow (native arrows ignore the theme). `.cw-root` is `user-select: none` — every input/textarea must opt back in with `user-select: text` or Ctrl+A/drag-select silently breaks.
- Widget card correction (0.2.4): each card in the list has an always-visible ✎ that opens an inline editor for `rawText` (typo fix; history is backend-side) and `barRef` (empty = clear). It calls `PUT /api/v1/cases/{caseId}/cards/{cardId}` with `{ rawText, barRef }` (`barRef: null` clears) and expects the updated card back (backend route added in 0.2.2); against older backends the widget detects 404/405/immutable and toasts an upgrade hint while keeping the edit open.
- Trade evaluation keeps process score and R decoupled: the process score uses only decision-time information (design in `docs/case-recording-0.2.0.md` §7.1); R is recorded but never labels a trade.
- Risk decomposition: R = PnL ÷ initial risk (|first entry fill − initialStopLoss| × first-entry qty; scaling in never dilutes it). Actual risk = Σ per entry fill × |fill − stop in effect then| × qty (`lib/metrics.ts`). Both R values display side by side, no judgment.
- Case auto-close (`lib/case-auto-close.ts`): an active Case auto-closes once when its bound Trade is fully closed AND a Closing Card exists, or (no binding) when a Reflection Card exists; manual status edits never re-trigger it.
- TradingView import runs Case matching (`lib/case-import-matching.ts`, rewritten 0.3.3 from production binding samples): two time axes + price corroboration. **Chart axis (primary)**: Entry/Closing card `barRef` resolved onto the trade's first-fill UTC day (loose variant of `resolveCaseCardTimesForTrade` — small backtracks ≤30min from voice-order slips clamp in-place instead of day-bumping, which once poisoned every later card) and compared with fill times across timeframes 1/5/15/30/60 (cards carry no timeframe); an Entry card may lead the fill by up to 30min (stop orders). **Price corroboration**: Entry memo stop/target/entry numbers vs trade facts at 0.2% relative tolerance (`firstPlausibleNumberIn` guards against bar numbers). **Clock axis (fallback)**: live recording where card `createdAt` ≈ fill time keeps the old ±15min windows. Direction mismatch (memo vs trade) demotes to suggestion, never auto-binds. Exact (auto-bind) = entry time hit AND (closing time hit OR price hit); multiple strong pairs are greedily assigned by quality (closing > price > chart distance), exact ties stay manual. Production replay: all 6 manual bindings auto-matched, 16 unrelated trades zero false exacts. Cases/Cards carry no symbol — matching is account + time + price only.
- Manual trade-management Executions use Move Stop (`stop`) for stop-loss changes, Move Target (`target-moved`) for take-profit changes, and Add / Edit Order (`order-edit`) for ordinary pending-order changes. Move Stop defaults to `stop-loss`; Move Target defaults to `take-profit`; manual trailing behavior is a Reason on Move Stop, not a `trailing-stop` order type by default.
- AI execution suggestions (0.3.0, `TradeCase.aiExecutionSuggestions`; panel name since 0.3.1: 「AI 补录建议」, collapses to one line when everything is resolved): management-only (stop/target-moved/order-edit — never position fills); triggered when a binding is established (the workflow is Case-first, so cards predate the trade) plus a manual 重新检查. One AI call per Case; Rust mechanically validates (verbatim quotes, whitelist actions, ≤8) and dedups against existing executions/events/initial stop-target (0.02% relative tolerance). Suggestions are always candidates: 直接添加 (normal save path, quote in note) / 修改后添加 (EditTradeDialog `prefill` draft) / 忽略; re-runs carry accepted/dismissed forward by fingerprint (cardId|action|quote|price).
- AI trade tag suggestions (0.3.4, `TradeCase.aiTagSuggestions`, panel 「AI 标签建议」 directly under AI 补录建议 in the Trade 案例 tab): SAME AI call as execution suggestions (one invocation, `0.3.4-suggest-2` prompt, both blobs share `analyzedAt`; REST auto path included). Tags go on the bound Trade, never the Case. Vocabulary = the user's own `tagDefs`, passed into the prompt grouped by color with fixed color semantics (红=定调整笔交易：定性错误或最高评级；橙=顺势/周期；黄=市场结构；绿=仓位与执行；青=复盘状态；蓝=情绪；紫=特殊标注 — `tag_vocabulary_block` in lib.rs). Parser (`ai.rs parse_trade_tags`): name must hit the vocabulary (case/whitespace-insensitive), quote must be a verbatim substring of the indexed card (or, cardIndex missing/wrong, any card), dedupe by name, ≤15, tags already on the trade filtered out. Fingerprint = tag name; re-runs carry accepted/dismissed. UI: per-tag 应用 (`updateTrade` + defensive `createTag`) / 忽略 / 全部应用; hidden until a first check exists; collapses to one line when all resolved. A/AA/AAA grades ride this mechanism deliberately (评级即标签): `A级交易` is already a red tag, `AA级交易`/`AAA级交易` are user-created red tags the AI can then suggest.
- AI case summary (0.3.0, `TradeCase.aiSummary`): auto on trade open→closed (autoSummary toggle) or manual; context assembled in TS (`lib/case-summary.ts` — metrics live in TS), Rust is a thin pipe. Facts and deviations only, never scores; 填入复盘备注 can also 重新填入 over an existing note (confirm dialog replaces it wholesale). Cards created/edited after `analyzedAt` mark the summary stale. Since 0.3.1 the manual summary + AI 补录建议 check expose store-level busy/error (`store.aiTasks`) so navigating away and back still shows 生成中/失败原因; Rust commands log failures via `log_provider_event`. The summary card lives at the top of the Trade detail 案例 tab (tabs renamed 复盘/案例/评估, keys unchanged, default 复盘; the 复盘 sidebar keeps PnL/R/过程分/均价/持仓时长 + always-visible 交易备注).
- Summary emphasis markup (0.3.4, `0.3.4-summary-2`): narrative may carry three restricted markers — `**加粗**` (key fact), `!!红!!` (问题/偏差), `==绿==` (执行到位/亮点). Rust `sanitize_summary_markup` (in `parse_summary`) strips unbalanced/empty/newline-crossing/nested/over-budget (>20) markers but never drops text; frontend `lib/summary-markup.ts` mirrors the semantics for rendering (bold = `font-semibold`, red/green = 2px colored underline like card-label highlighting) and `fillNote` strips all markers because trade.note renders as plain text. Old summaries without markers pass through unchanged.
- AI binding suggestions (0.3.0): mechanical prefilter (same account, unbound, time distance ≤6) then AI ranks + explains; binding itself is always user-confirmed. Surfaces: Trade Case tab (AI 找 Case), Case page binding card (AI 找 Trade), import step-3 unmatched rows.
- Batch voice split (0.3.0; 0.3.1 made the trigger explicit; 0.3.4 re-tuned granularity): the widget's 「拆卡」 checkbox decides batch vs single card (no anchor pre-detection — checking disables the BAR input because split anchors come from the card text; sticky across submits within a session; same-text retries reuse the clientRequestId, 200s timeout) → `POST /cases/:id/cards/batch-split` splits directly into cards (no preview — fluency first; mistakes are cleaned with edit/delete). Rust validates segments as ordered verbatim substrings with monotonic barRefs **and ≥85% character coverage — a dropped sentence fails the parse**; any failure degrades to one whole-text card (never lose the speech); idempotent per `clientRequestId` (same id + different rawText → 409). Lock discipline: `run_batch_split` holds the DB mutex only in short phases (validate/replay → AI unlocked → persist) and the route is dispatched before the server loop takes the mutex — AI-duration lock holding would freeze all GUI Tauri commands. **0.3.4 split prompt v2** (`0.3.4-split-2`, driven by production data: 35/79 live cards were intermediate-phase running commentaries up to 1700 chars, and even `bs-` split results under-split): granularity = one independent mental event per card — bar-by-bar commentary splits per observation, consecutive sentences about the same bar/idea stay on one card, no hard sentence splitting.
- Card re-split (0.3.4, 「AI 重拆此卡」 in the card `···` menu — Case page and Trade 案例 tab share `case-card-timeline.tsx`): re-runs the split AI on an EXISTING card and replaces it. Same prompt/parser as batch split, **opposite degradation policy** — AI unavailable, parse failed, or only one segment → error, original card untouched (a destructive replacement must never "degrade" into losing aiAnalysis/rawTextHistory for nothing); cards <60 chars are rejected up front; a card edited/deleted during the AI call aborts. Success (`lib.rs run_card_resplit` → `persist_resplit`, same 3-phase short-lock discipline): original soft-deleted (attachments follow, same as delete), N new cards at `createdAt = original + i` (keeps position; fresh `rs-` rid each run so upserts never resurrect soft-deleted rows), `entryDecision` and first-segment `barRef` inherited, both suggestion blobs pruned of entries pointing at the original card (same rule as frontend card delete). New cards auto-analyze via `spawn_auto_analysis`. GUI-only Tauri command `resplit_case_card` (no REST/widget route yet); task registered frontend-side (`kind: 'split'`, failure reason shows inline near the card + in the task center).
- Trade process score surfacing (0.3.4): trade list filter gains 已评分 alongside 未评分 (`flagScored` in `lib/trade-filters.ts`, mutually exclusive — both checked matches nothing); the 复盘 sidebar 结果 card shows a single-line 过程分 x / 10 (`savedProcessScoreTotal`), unscored shows a 「未评分，去评分」 link that switches to the 评估 tab. Trade list gains no new column (11 already).
- AI settings (0.3.0): `autoAnalyze` / `autoSuggest` / `autoSummary` in Settings → AI, all default on.
- AI task center (0.3.1): every AI call is a task in `store.aiTaskList` (last 50, kind/label/target/error/streamText/unread) — GUI tasks register via `beginAiTask`/`completeAiTask` (summary incl. auto-on-close, suggestions incl. auto-on-binding, single-card analysis, batch 全部识别 as ONE task with per-card suppressed, AI 拟题, AI 找 Case/Trade); REST background tasks (auto analysis, auto suggestions, batch split) publish `cairn://ai-task` events from Rust (`ai.rs emit_task_event`, `batch_split_endpoint`) that the store merges. The sidebar-bottom `ai-task-center.tsx` shows running (spinner) / succeeded (check) / failed (alert, expandable error detail), badge = unread finished, click-through jumps to the target (card → its Case). 「需重试」counts as still running — only the post-retry final status lands. Since 0.3.3 a confirmed failure can be dismissed (row ✕ or 知道了 in the expanded error) via `dismissAiTask` — acknowledged failures leave the list instead of nagging the sidebar icon forever.
- Streaming (0.3.1): whole-case summary is streamed — `ai_summarize_case` takes `taskId`, Rust `chat_completion_stream` (SSE via `chunk()`, connect 15s + read 30s instead of total 90s, full-body fallback when the provider ignores `stream: true`, no retry after content started) emits `cairn://ai-stream` `{taskId, delta}` in ~80ms batches; accumulated text feeds the unchanged parsers (prompts untouched). The summary card shows the raw stream live; the task center shows a 2-line preview.
- AI error copy (0.3.1): network failures must surface WHY — `describe_request_error` walks the reqwest source chain (≤3 levels) and classifies timeout/connect/DNS in Chinese; HTTP non-2xx adds 401/404/429 hints; `is_retryable_error` matches the `request failed:` / `read response failed:` / `模型服务返回 5` prefixes.
- Provider models & thinking & concurrency: `AiProvider.models` (0.3.2, `Vec<AiModelConfig {id, thinking?}>`) holds multiple models with per-model thinking overrides; `default_model` must be one of them, and legacy files without `models` are backfilled from `default_model` in `normalize`. Thinking is a unified level (`auto` = send nothing / `on` / `off` / `low` / `medium` / `high`), resolved per call as model-level ?? provider-level ?? auto, and translated per preset by `apply_thinking_param` in `ai.rs`: openrouter → `reasoning.effort` (on→high, off→none), openai → `reasoning_effort` (off sends nothing), zhipu → `thinking.type` enabled/disabled plus `reasoning_effort` low/high since GLM-5.2 — **GLM-5.3/5.3-FLASH cannot disable thinking (official docs + live 400), so `off` on a `glm-5.3*` model degrades to enabled+low and the dialog hides 关闭思考 for those models** (`isAlwaysThinkingModel` in `components/ai-provider-dialog.tsx`), qwen → `enable_thinking` + `thinking_budget` (low 2048 / medium 8192), siliconflow → `enable_thinking`. Unknown presets (deepseek/gemini/groq/moonshot/anthropic/ollama/custom) send NOTHING — strict endpoints 4xx on unknown fields. UI option lists per preset come from `thinkingLevelsForPreset`/`thinkingLevelsForModel` in `components/ai-provider-dialog.tsx`. `AiProvider.concurrency` (default 10, cap 32) drives both the frontend 全部识别 worker count (`getDefaultAiConcurrency` → `default_ai_concurrency`) and a Rust global gate (`ACTIVE_AUTO_ANALYSIS` counter, 150ms polling) throttling REST auto-analysis bursts. Streaming reasoning text is never forwarded to the UI — only progress (thinking ms, output chars/tokens) via the `cairn://ai-stream` `progress` payload; usage tokens are parsed opportunistically from the provider's final SSE frame (no `include_usage` request opt-in).
- Outbound proxy (0.3.2 → reworked 0.3.3): Settings → 网络, `NetworkSettings {mode: system|manual|off, proxyUrl}` in `app_data_dir/network-settings.json` (not backed up). **system is the default** — `sysproxy` crate detects the OS proxy at refresh time (Windows registry / macOS scutil / Linux); a disabled OS proxy resolves to direct (`system_proxy_url` ignores `enable=false` — Windows keeps stale `ProxyServer` values in the registry after the toggle is off, which would route every request to a dead proxy); manual validates an `http(s)://` URL; off forces direct (`.no_proxy()`). Legacy 0.3.2 files (`{proxyEnabled, proxyUrl}`) migrate on read: enabled → manual, else system; the resolved mode is written back on next save. All Rust outbound HTTP (the three ai.rs clients + the GitHub widget check in `lib.rs`) is built through `ai::http_client()` reading a process-global `PROXY_STATE` (`ai::refresh_proxy` at setup and on save — so AppHandle-less paths like `fetch_models` proxy too); an invalid URL degrades to direct connection. The in-app updater plugin builds its own HTTP client, so the frontend passes the resolved proxy to `check({proxy})` (`ai::effective_proxy_url`, exposed via `get_network_settings` → `effectiveProxyUrl`; the Update object carries it into download too). Our reqwest also enables the `system-proxy` feature as an env-var fallback when detection comes up empty. Default provider selection is a list-level action: clicking a provider card in Settings → AI calls `set_default_ai_provider` (`ai::set_default`, ring highlight on the selected card); `ai::save` preserves `is_default` on edit so merely opening another provider can never displace the default.

## Branching And Releases

- Release work should happen on `dev/x.y.z`, for example `dev/0.1.5`.
- If current branch is `main`, create or switch to a version branch before editing.
- Update version surfaces together when doing a release:
  - `package.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/Cargo.lock`
  - `src-tauri/tauri.conf.json`
  - `docs/release-x.y.z.md`
- Prefer `pnpm release:check x.y.z` for release verification.
- Keep commits grouped by intent and use Conventional Commits.

## Commands

- Install dependencies: `pnpm install`.
- Frontend dev server: `pnpm dev`.
- Frontend typecheck: `pnpm typecheck`.
- Frontend unit tests (vitest): `pnpm test`.
- Frontend build: `pnpm build`.
- Tauri dev: `pnpm tauri:dev`.
- Isolated Tauri dev: `pnpm tauri:dev:isolated`.
- Local Tauri build: `pnpm tauri:build:local`.
- Release check: `pnpm release:check x.y.z`.
- AI real-provider e2e (uses the configured provider, one real call per test): `CAIRN_AI_E2E=1 cargo test --manifest-path src-tauri/Cargo.toml ai_chat_e2e -- --ignored --nocapture`.
- Release executable verification after `pnpm build`: `cargo build --manifest-path src-tauri/Cargo.toml --release --features tauri/custom-protocol`.

## Verification

- Required final checks for code changes usually include frontend typecheck/build and Rust/Tauri checks.
- For release work, follow `docs/development-workflow.md`.
- Use `pnpm tauri:dev:isolated` when local app testing must not touch production app data.
- Browser or Playwright verification is not required by default for this project.
- For docs-only changes, a read-through and `git diff --check` are usually enough.
