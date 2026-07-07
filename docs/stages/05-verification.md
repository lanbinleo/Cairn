# Stage 05 - Verification

## Final Acceptance

- Tauri 2 + React + Rust app exists.
- No Go backend exists.
- Local SQLite stores all real business data.
- Mock-backed feature behavior has been replaced with durable local data.
- TradingView import is real.
- Backup export/restore exists.
- Ctrl+V image paste exists.
- System tray exists.
- Logo and app icons exist.
- Docs describe the implemented architecture and stage outcomes.
- No command used for final verification reports errors.

## Required Commands

- `pnpm install`
- `pnpm typecheck`
- `pnpm build`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- Relevant Rust tests once they exist.

## Not Required

- macOS runtime verification.
- Playwright or browser validation.
