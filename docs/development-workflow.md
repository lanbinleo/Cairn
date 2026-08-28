# Development Workflow

This document records the development and release flow for Cairn.

## Branch Model

Use `master` as the current stable branch unless the repository is later renamed to `main`.

Version work should happen on a version branch:

```powershell
git switch master
git pull
git switch -c dev/0.1.1
```

Focused branches can be created from the active version branch:

```powershell
git switch dev/0.1.1
git switch -c feat/auto-backup
git switch -c docs/release-process
```

Merge focused branches back into `dev/x.y.z`, then open a pull request from `dev/x.y.z` into `master` for the release.

## Commit Style

Use Conventional Commits:

- `feat:` user-facing behavior
- `fix:` bug fixes
- `docs:` documentation-only changes
- `style:` visual or formatting-only changes
- `refactor:` code restructuring without behavior changes
- `test:` tests and verification helpers
- `chore:` tooling, build, metadata, or release maintenance
- `perf:` performance work

Keep commits grouped by intent, such as visual assets, native storage behavior, documentation, and release metadata.

## Local Data

Production app data is stored under the Tauri app data directory. On Windows this normally resolves under the current user's roaming app data directory for the app identifier:

```text
%APPDATA%\app.cairn.desktop
```

Important files and folders:

- `cairn.sqlite3`
- `cairn.sqlite3-wal`
- `cairn.sqlite3-shm`
- `cairn-startup.log`
- `backups/*.json`
- `backups/auto/cairn-auto-backup-YYYY-MM-DD.json`
- `attachments/chart-data/*`

Imported chart source files are copied into `attachments/chart-data/`. The database stores import metadata and normalized candles, while the copied source file remains available for audit and re-parse checks.

Codex-launched development builds can resolve the same Tauri app data directory through the Codex app container. Do not copy or delete production user data while the app is running.

For isolated development, use:

```powershell
pnpm tauri:dev:isolated
```

This sets `CAIRN_DATA_DIR` to:

```text
%LOCALAPPDATA%\Cairn\dev-profile
```

Use `powershell -ExecutionPolicy Bypass -File scripts/dev-isolated.ps1 -Reset` when the isolated profile should be cleared before launch.

## Automatic Backups

Cairn creates one automatic backup the first time local state is loaded each local calendar day. Automatic backups are JSON snapshots stored in:

```text
backups/auto/
```

The app keeps the latest seven daily automatic backups and removes older automatic backups. Manual exports remain in `backups/` and are not pruned by the automatic retention task.

## Version Surfaces

When preparing a release, update these together:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`
- `docs/release-x.y.z.md`

Cairn uses `pnpm-lock.yaml`, but the package version is not duplicated in the current lockfile format.

## Verification

Run checks based on what changed.

Frontend:

```powershell
pnpm build
```

Rust/native:

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Local release executable:

```powershell
pnpm build
cargo build --manifest-path src-tauri/Cargo.toml --release --features tauri/custom-protocol
```

Release check script:

```powershell
pnpm release:check 0.1.1
```

Installer verification, when needed:

```powershell
pnpm release:check 0.1.1 -BuildInstaller
```

## In-App Updater (Tauri updater)

The app ships with the Tauri updater: Settings → 关于 → 检查更新 pulls `releases/latest/download/latest.json` and installs passive-NSIS updates.

- Signing keypair lives on the release machine at `%USERPROFILE%\.tauri\cairn-updater.key` (passwordless, generated 2026-07-08). Its public key is baked into `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) and therefore into every shipped binary since v0.1.3.
- `pnpm release:check x.y.z -BuildInstaller` sets `TAURI_SIGNING_PRIVATE_KEY_PATH`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from that key, builds installers with the main config (`createUpdaterArtifacts: true` → `.sig` files), and generates `bundle/latest.json` pointing at the GitHub release asset URL.
- Release upload must include: NSIS setup.exe, MSI, and `latest.json` (asset name exactly `latest.json`). The endpoint is `releases/latest/download/latest.json`, so the newest release's manifest is always what clients check.
- A build made through `pnpm tauri:build:local` (local config) skips updater artifacts — use it only for throwaway local installers.
- Regenerating the keypair would break every already-shipped binary (they verify against the old public key); only do it deliberately and accept that old versions must update manually.

## Release Process

1. Confirm branch and workspace status. Release work should happen from `dev/x.y.z`.
2. Update all version surfaces.
3. Write `docs/release-x.y.z.md`.
4. Run `pnpm release:check x.y.z`.
5. For installer verification, run `pnpm release:check x.y.z -BuildInstaller`.
6. Confirm release artifacts:
   - `src-tauri/target/release/cairn.exe`
   - `src-tauri/target/release/bundle/nsis/Cairn_x.y.z_x64-setup.exe` (+ `.sig`) when installer build is requested
   - `src-tauri/target/release/bundle/msi/Cairn_x.y.z_x64_en-US.msi` (+ `.sig`) when installer build is requested
   - `src-tauri/target/release/bundle/latest.json` when installer build is requested (upload with the release for in-app updates)
7. Review the final diff.
8. Commit release changes with a Conventional Commits message.
9. Push the version branch and open a pull request into `master`.
10. After merge, create an annotated tag from `master`, for example `v0.1.1`.

## Definition of Done

- Requested behavior is implemented.
- Existing local data remains safe.
- Documentation is updated when behavior, storage, release, or packaging changes.
- Relevant verification commands pass.
- Release artifacts are generated for release work.
- Git history is grouped into clear Conventional Commits.
