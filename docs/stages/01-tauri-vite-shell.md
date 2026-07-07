# Stage 01 - Tauri 2 + Vite Shell

## Goal

Move the app from Next.js to a Tauri 2 desktop shell using Vite + React, without changing the existing screens.

## Allowed Changes

- Replace Next.js entry files with Vite entry files.
- Convert `app/*/page.tsx` files into ordinary React route components.
- Replace `next/link` with router links.
- Replace `next/navigation` not-found handling with route-safe fallbacks.
- Replace `next/image` with `img`.
- Remove `next/font` and Vercel Analytics.
- Add `src-tauri/` and Tauri configuration.

## Files To Prefer Preserving

- `components/`
- `lib/metrics.ts`
- `lib/format.ts`
- `lib/bar-time.ts`
- `app/globals.css` content, moved only if needed.

## Verification

- `pnpm install`
- `pnpm typecheck`
- `pnpm build`
- `cargo check` in `src-tauri`

## Result

- Next.js runtime has been replaced by Vite + React Router.
- Existing pages remain in `app/` and are rendered through `src/App.tsx`.
- Existing layout structure is preserved in the Vite root shell.
- Tauri 2 Rust shell exists under `src-tauri/`.
- Initial Cairn SVG logo and Tauri Windows icon assets exist so the native shell can compile.
- Vite uses relative asset paths (`base: './'`) so release builds load bundled JS/CSS correctly inside Tauri.
