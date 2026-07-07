# Stage 04 - Tray, Logo, Packaging

## Goal

Add desktop polish and cross-platform packaging configuration.

## Logo

- Create a simple CAIRN SVG logo.
- Use it as the in-app brand mark where the current app already has a brand mark location.
- Generate required app icon assets for Tauri.

## Tray

- Add system tray integration.
- Tray should support opening/showing the app and quitting.

## Packaging

- Primary: Windows and macOS.
- Secondary: Linux package config may exist but does not need manual verification.

## Verification

- Tauri config validates.
- Icon files exist.
- `cargo check` passes for tray setup code.
