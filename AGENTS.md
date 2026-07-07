# CAIRN Development Notes

## Working Language

- Respond to Leo in Chinese unless a technical name is clearer in English.
- Keep implementation notes direct and concrete.

## Current Goal

Build CAIRN as a local-first Tauri 2 desktop app for Windows and macOS, with Linux packaging kept available but not a primary target.

## Non-Negotiables

- Do not rewrite page designs.
- Preserve the existing visual style, layout, text, and current page behavior unless the current task explicitly names a change.
- Prefer mechanical migration over redesign:
  - keep existing components,
  - keep existing metric helpers,
  - replace framework adapters and mock data only where needed.
- Keep docs current before or alongside implementation changes.
- Use Git commits at stage boundaries.

## Product Document

Use `docs/software-design.md` as the current source of truth. Historical migration notes live under `reference/legacy/`.

## Branching and Releases

- Release work should happen on `dev/x.y.z`, for example `dev/0.1.1`.
- Use Conventional Commits and keep commits grouped by intent.
- Update version surfaces together:
  - `package.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/Cargo.lock`
  - `src-tauri/tauri.conf.json`
  - `docs/release-x.y.z.md`
- Use `docs/development-workflow.md` as the release process checklist.
- Prefer `pnpm release:check x.y.z` for release verification.

## Architecture

- Frontend: React + Vite + TypeScript.
- Desktop runtime: Tauri 2.
- Native layer: Rust commands for local database, filesystem, imports, backup, tray, and app metadata.
- Storage: local SQLite database in the app data directory.
- Future cloud: backup/restore service only, not realtime sync.

## Verification

- Required final checks include frontend typecheck/build and Rust/Tauri checks.
- Release executable verification uses `cargo build --manifest-path src-tauri/Cargo.toml --release --features tauri/custom-protocol` after `pnpm build`.
- Use `pnpm tauri:dev:isolated` for local app testing when production data must not be touched.
- Browser or Playwright verification is not required for this goal.
