# CAIRN 0.1.3

## Scope

- Rework Settings into categorized tabs: General, Data, Logs, and About.
- Add Tauri updater integration for GitHub Releases.
- Add in-app log viewing and readable local log timestamps.
- Create a pre-migration JSON backup before upgrading existing local databases to schema version 2.
- Store new image attachments as files under the app data directory, with database records holding relative paths.
- Keep note image mentions as short attachment references instead of inline base64.
- Improve the trades table with tooltips, compact symbol labels, single-line tags, and pagination.
- Add a visual baseline to equity charts so values above/below initial capital are easier to read.
- Add a dedicated manual Trade creation page with editable executions.
- Add Trade JSON copy and paste-import preview.
- Add duplicate detection and per-trade checkboxes to the TradingView import preview.
- Add an in-app data format documentation tab under Settings.
- Use exact duplicate detection only: position executions must match by action, UTC time, and quantity.
- Use primary-blue solid app icons for clearer taskbar/tray rendering.
- Add `pnpm tauri:build:local` for local installer builds without updater artifact signing.

## Verification

- Passed: `pnpm typecheck`
- Passed: `pnpm build`
- Passed: `cargo check --manifest-path src-tauri/Cargo.toml`
- Passed: `pnpm tauri:build:local`
- Built local installers:
  - `src-tauri/target/release/bundle/nsis/Cairn_0.1.3_x64-setup.exe`
  - `src-tauri/target/release/bundle/msi/Cairn_0.1.3_x64_en-US.msi`
