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
