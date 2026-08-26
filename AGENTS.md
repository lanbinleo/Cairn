# CAIRN Development Notes

This file is loaded at the start of Codex sessions. Keep it useful. When the app structure, commands, release flow, or domain model changes, update this file in the same branch as the code change.

## Working With Leo

- Usually respond to Leo in Chinese. Keep technical names such as Tauri, React, SQLite, TradingView, Execution, and ChartData in English when that is clearer.
- Be direct and concrete. Prefer short implementation notes over broad explanations.
- Leo prefers thinking through the work before action. If the request is ambiguous, ask before editing.
- If Leo says "开始干", the task is considered clear enough: say what technology/files you will touch, then make the change.
- If Leo is confident but appears mistaken, point it out clearly with the reason.
- Tell yourself before finishing any meaningful task: do not forget to maintain this document.

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
- Native layer: Rust commands for SQLite, filesystem attachments, imports, backups, tray, logs, diagnostics, and app metadata.
- Storage: local SQLite in the Tauri app data directory.
- Future cloud: backup/restore only, not realtime multi-device sync.

## Module Map

### App Entrypoints

- `src/main.tsx`: React mount point.
- `src/App.tsx`: route table, app shell, sidebar, titlebar, providers, page transitions.
- `app/globals.css`: global Tailwind/CSS theme, layout animation, app-wide styles.
- `index.html`: Vite HTML entry.

### Pages

- `app/page.tsx`: dashboard.
- `app/accounts/page.tsx`: account list.
- `app/accounts/[accountId]/page.tsx`: account detail.
- `app/accounts/[accountId]/periods/[periodId]/page.tsx`: period detail.
- `app/trades/page.tsx`: trade list.
- `app/trades/new/page.tsx`: manual trade creation.
- `app/trades/[tradeId]/page.tsx`: trade detail, chart, timeline, notes, image review.
- `app/cases/page.tsx`: Case list, filtering, creation, and Case Tag access.
- `app/cases/[caseId]/page.tsx`: Case metadata, phased Card recording, tags, and Binding status.
- `app/data/page.tsx`: chart data import, coverage, candle library management.
- `app/import/page.tsx`: TradingView import flow.
- `app/notes/page.tsx`: notes list.
- `app/notes/[noteId]/edit/page.tsx`: note editor.
- `app/settings/page.tsx`: settings, backup, diagnostics.

### UI Components

- `components/app-sidebar.tsx`: primary navigation.
- `components/window-titlebar.tsx`: desktop titlebar behavior.
- `components/page-header.tsx`, `components/stat-card.tsx`, `components/pnl-text.tsx`, `components/sparkline.tsx`: shared page display pieces.
- `components/trades-table.tsx`: reusable trade table.
- `components/trade-chart.tsx`: chart rendering and overlays.
- `components/trade-case-panel.tsx`: Trade Overview Case summary, Case/Card view, and one-to-one Binding actions.
- `components/attachment-image.tsx`: app-data and data URL image rendering.
- `components/backup-card.tsx`: backup/restore UI.
- `components/coverage-timeline.tsx`: chart data coverage visualization.
- Dialog components live under `components/*-dialog.tsx`.
- Base UI primitives live under `components/ui/`.
- Dashboard-only pieces live under `components/dashboard/`.

### Frontend Domain And Data Layer

- `lib/types.ts`: core TypeScript domain types.
- `lib/seed.ts`: initial/empty state shape used by browser development and first app load.
- `lib/store.tsx`: React context store, state hydration, mutations, normalization, migrations, backup calls.
- `lib/local-db.ts`: Tauri `invoke` wrappers and browser-runtime fallbacks.
- `lib/metrics.ts`: PnL, R multiple, equity, win/loss, drawdown, expectancy helpers.
- `lib/executions.ts`: execution classification and position-changing logic.
- `lib/execution-display.ts`: display labels and execution presentation helpers.
- `lib/tradingview-import.ts`: TradingView workbook/CSV parsing and trade grouping.
- `lib/trade-duplicates.ts`: duplicate detection for imported/manual trades.
- `lib/trade-transfer.ts`: transfer helpers between imported and app trade shapes.
- `lib/chart-data.ts`, `lib/chart-datasets.ts`, `lib/chart-timeframes.ts`, `lib/bar-time.ts`: chart candles, coverage, timeframe, and bar-index helpers.
- `lib/tags.ts`: TagDef normalization, uniqueness, rename/delete behavior.
- `lib/cases.ts`: Case phase labels, recording prompts, display rules, and explicit BAR reference extraction.
- `lib/note-mentions.ts`: `[[trade:ID]]` and `[[image:URL_OR_PATH]]` parsing.
- `lib/clipboard-images.ts`: clipboard image handling.
- `lib/frontend-log.ts`: frontend-to-Tauri log forwarding.
- `lib/format.ts`, `lib/utils.ts`: formatting and shared helpers.

### Native Tauri Layer

- `src-tauri/src/lib.rs`: Tauri builder, command registration, tray setup, app metadata commands, attachment file read/write, chart source file save.
- `src-tauri/src/db.rs`: SQLite schema, read/write/delete/restore/backup logic, state hydration.
- `src-tauri/src/paths.rs`: app data path helpers.
- `src-tauri/src/diagnostics.rs`: panic hook, logs, temp diagnostics.
- `src-tauri/src/main.rs`: native entrypoint.
- `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`: Rust package/version/dependencies.
- `src-tauri/tauri.conf.json`: main Tauri config.
- `src-tauri/tauri.local.conf.json`: local build config.
- `src-tauri/tauri.windows.conf.json`: Windows-specific config.
- `src-tauri/capabilities/default.json`: Tauri permissions.
- `src-tauri/icons/`: app icons.

### Docs, Scripts, And References

- `docs/software-design.md`: active product, data, import, metric, chart, backup, and packaging design.
- `docs/development-workflow.md`: release and verification checklist.
- `docs/release-0.1.x.md`: version-specific release notes.
- `docs/future-backup-sync.md`: future backup sync notes.
- `docs/todo-0.1.3-test.md`: historical test notes.
- `reference/legacy/`: historical V0/backend/mock-data references only; not active architecture.
- `scripts/dev-isolated.ps1`: isolated Tauri dev launch.
- `scripts/release.ps1`: release verification helper.
- `package.json`: npm scripts and frontend dependencies.
- `pnpm-lock.yaml`: package lockfile.
- `vite.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `components.json`: frontend tooling/config.

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
- CaseCard raw text is immutable after submission. AI and mechanical parsing results must not rewrite it.
- Each CaseCard maps to one explicit `barRef`; legacy `barRefs` arrays exist only for migration compatibility.
- Case Tags are independent from Trade Tags, although both use the same seven colors.
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
- Frontend build: `pnpm build`.
- Tauri dev: `pnpm tauri:dev`.
- Isolated Tauri dev: `pnpm tauri:dev:isolated`.
- Local Tauri build: `pnpm tauri:build:local`.
- Release check: `pnpm release:check x.y.z`.
- Release executable verification after `pnpm build`: `cargo build --manifest-path src-tauri/Cargo.toml --release --features tauri/custom-protocol`.

## Verification

- Required final checks for code changes usually include frontend typecheck/build and Rust/Tauri checks.
- For release work, follow `docs/development-workflow.md`.
- Use `pnpm tauri:dev:isolated` when local app testing must not touch production app data.
- Browser or Playwright verification is not required by default for this project.
- For docs-only changes, a read-through and `git diff --check` are usually enough.
