# CAIRN Development Notes

## Working Language

- Respond to Leo in Chinese unless a technical name is clearer in English.
- Keep implementation notes direct and concrete.

## Current Goal

Build CAIRN as a local-first Tauri 2 desktop app for Windows and macOS, with Linux packaging kept available but not a primary target.

## Non-Negotiables

- Do not rewrite page designs.
- Preserve the existing visual style, layout, text, and current page behavior unless the stage document explicitly names a change.
- Prefer mechanical migration over redesign:
  - keep existing components,
  - keep existing metric helpers,
  - replace framework adapters and mock data only where needed.
- Keep docs current before or alongside implementation changes.
- Use Git commits at stage boundaries.

## Stage Documents

Before working on a stage, read the matching file under `docs/stages/`:

- `docs/stages/00-current-state.md`
- `docs/stages/01-tauri-vite-shell.md`
- `docs/stages/02-local-data-sqlite.md`
- `docs/stages/03-import-backup-clipboard.md`
- `docs/stages/04-tray-logo-packaging.md`
- `docs/stages/05-verification.md`

## Architecture

- Frontend: React + Vite + TypeScript.
- Desktop runtime: Tauri 2.
- Native layer: Rust commands for local database, filesystem, imports, backup, tray, and app metadata.
- Storage: local SQLite database in the app data directory.
- Future cloud: backup/restore service only, not realtime sync.

## Verification

- Required final checks include frontend typecheck/build and Rust/Tauri checks.
- Browser or Playwright verification is not required for this goal.
