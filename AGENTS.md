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
- Native layer: Rust commands for SQLite, filesystem attachments, imports, backups, tray, logs, diagnostics, app metadata, the local REST API, and AI chat.
- Storage: local SQLite in the Tauri app data directory.
- Future cloud: backup/restore only, not realtime multi-device sync.

## Module Map

The detailed per-file map lives in **`docs/project-map.md`** — every page, component, lib module, Rust module, script, the storage-collection layout, and a "where do I…" quick index. Read it before exploring unfamiliar areas instead of launching search agents, and update it in the same branch whenever files are added, removed, or change ownership.

Top-level orientation:

- Frontend: pages under `app/`, components under `components/`, domain logic under `lib/`, routes in `src/App.tsx`.
- Native: `src-tauri/src/` — `lib.rs` (commands/setup), `db.rs` (SQLite), `api.rs` (local REST on 127.0.0.1), `ai.rs` (providers + chat + prompts), `diagnostics.rs` (logs).
- Companion userscript: `scripts/cairn-case-widget.user.js` (+ `scripts/cairn-case-widget.test.html` harness). Distribution is in-app: the script is compiled into the binary (`include_str!`) and Settings → 本地 API → 浮窗脚本 offers copy + a GitHub-main update check (`api.github.com` Contents API, `check_widget_script_update`); network failure degrades to the bundled copy. Bump the script `@version` whenever it changes — version comparison is dot-segment numeric (`version_gt`).

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
- CaseCard raw text is permanent but correctable: typo edits push the previous wording into `rawTextHistory` and stamp `rawTextEditedAt` (enforced by `save_case_card`). AI and mechanical parsing results must never rewrite raw text. On the REST API, idempotent POST replays still reject raw-text changes; deliberate correction is the `PUT /api/v1/cases/{caseId}/cards/{cardId}` route (body `{ rawText, barRef }`, `barRef: null` clears; other fields preserved), which archives history via `save_case_card`.
- AI results on a Card live in `aiAnalysis` as versioned derived data (`schemaVersion`/`promptVersion`/`model`/`analyzedAt`; schema `0.2.1-schema-2`); quotes must be verbatim substrings of the raw text, unknown labels are dropped, and `missingFields` is derived mechanically from the seven-field memo (direction, entryPrice, stopLoss, target, confidence, invalidation, rejectedAlternatives; emotion optional), not trusted from the model.
- AI analysis auto-runs on REST-created Cards (`ai::spawn_auto_analysis`, toggle in Settings → AI, default on; idempotent replays never trigger); every AI call auto-retries once on network-class failures only. Binding a Trade auto-titles Cases that still carry a default placeholder title (`isDefaultCaseTitle` in `lib/cases.ts`).
- Derived data is user-correctable via `updateCaseCardBarRef` / `updateCaseCardAnalysis` (labels, memo values, `staleDismissedAt`): manual edits stamp `userAdjusted` and re-analysis asks first. The shared editable timeline is `components/case-card-timeline.tsx` (Case page + Trade Case tab); cards default to collapsed summary rows.
- AI retry pattern: the card-header Sparkles ghost button runs/re-runs directly; the analysis footer line carries `AiRetryLink` (`components/ai-retry-button.tsx`), a small dotted link opening a popover where the user types a correction instruction appended to the retry request.
- CaseCard membership is repairable: a Card can be moved to another Case from the Case detail page; only `caseId` changes, raw text does not.
- Case card `barRef` is a per-UTC-day index (resets at 00:00) and user-editable (1–1440 or clear). Trade-page resolution (`resolveCaseCardTimesForTrade` in `lib/bar-time.ts`) anchors to the Trade's first position fill day — replay/backtest Card `createdAt` is the recording wall clock, never the chart day. Out-of-range barRefs (e.g. 2265) don't participate and fall back to creation order (flagged invalid); a day-bump that overshoots the chart window falls back to "right after the previous card" (creation order wins over bar arithmetic); cards without a usable barRef inherit previous +1ms. No manual day disambiguation for cross-day Cases.
- Trade plan prices backfill from the bound Case's Entry memo (`firstNumberIn`, empty fields only, one automatic attempt per Trade); closed Trades missing initial stop/target get a first-visit prompt (从 Entry 卡填入 / 手动填写 / 待会儿提醒 / 忽略, localStorage per Trade).
- Iceberg fills: same-bar same-price same-side fills aggregate into one display row (`Entry (2)`/`Exit (2)`, `lib/execution-display.ts`) — display only, data is never merged.
- Account equity is a frontend-recomputed snapshot on the Account record (`equity` = initialBalance + Σ closed PnL); the widget shows balance plus user-configurable risk percentages (up to 3, default 1%/2%, Settings → 仓位提示), and the trades table's PnL% column divides PnL by equity before that trade (`equityBeforeByTrade`).
- The capture widget follows the current-Case session model: the panel header states the destination Case, switching is on demand, and starting a new Case is the primary organizational action. The widget renders in light DOM under a `#cairn-cw-wrap` container (`cw-`-prefixed ids, `#cairn-cw-wrap`-scoped styles injected into `document.head`; no Shadow DOM) so TradingView's own input-focus guard recognizes its inputs, and a window-capture interceptor (`composedPath` check + stopPropagation; preventDefault only for the widget's own submit/save keys) keeps panel keys away from TradingView shortcut listeners — typing, pasting, and IME composition stay normal.
- Widget theming: Settings → 外观, three modes — 跟随 TradingView (default; watches `theme-dark`/`theme-light` on html/body plus `prefers-color-scheme`), 深色, 浅色. Implemented as CSS-variable overrides on `.cw-root.light` plus `color-scheme` so native controls (select popups, carets, scrollbars) follow; `.cw-select` and the Case trigger draw a shared `--chev` SVG arrow (native arrows ignore the theme). `.cw-root` is `user-select: none` — every input/textarea must opt back in with `user-select: text` or Ctrl+A/drag-select silently breaks.
- Widget card correction (0.2.4): each card in the list has an always-visible ✎ that opens an inline editor for `rawText` (typo fix; history is backend-side) and `barRef` (empty = clear). It calls `PUT /api/v1/cases/{caseId}/cards/{cardId}` with `{ rawText, barRef }` (`barRef: null` clears) and expects the updated card back (backend route added in 0.2.2); against older backends the widget detects 404/405/immutable and toasts an upgrade hint while keeping the edit open.
- Trade evaluation keeps process score and R decoupled: the process score uses only decision-time information (design in `docs/case-recording-0.2.0.md` §7.1); R is recorded but never labels a trade.
- Risk decomposition: R = PnL ÷ initial risk (|first entry fill − initialStopLoss| × first-entry qty; scaling in never dilutes it). Actual risk = Σ per entry fill × |fill − stop in effect then| × qty (`lib/metrics.ts`). Both R values display side by side, no judgment.
- Case auto-close (`lib/case-auto-close.ts`): an active Case auto-closes once when its bound Trade is fully closed AND a Closing Card exists, or (no binding) when a Reflection Card exists; manual status edits never re-trigger it.
- TradingView import runs Case matching (`lib/case-import-matching.ts`): exact entry+closing time-window matches auto-bind (`source: 'import'`); partial/overlapping matches are yellow suggestions; no Case is red. Cases/Cards carry no symbol — matching is account + time only.
- Manual trade-management Executions use Move Stop (`stop`) for stop-loss changes, Move Target (`target-moved`) for take-profit changes, and Add / Edit Order (`order-edit`) for ordinary pending-order changes. Move Stop defaults to `stop-loss`; Move Target defaults to `take-profit`; manual trailing behavior is a Reason on Move Stop, not a `trailing-stop` order type by default.

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
