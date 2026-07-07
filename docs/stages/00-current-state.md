# Stage 00 - Current State

## Source

The original v0 export is committed as the first Git commit. The app is currently a Next.js project with App Router pages and mock data.

## Important Files

- `app/` - current page files.
- `components/` - reusable UI and feature components. Preserve these as much as possible.
- `lib/types.ts` - current TypeScript domain model.
- `lib/store.tsx` - mock-backed client store to replace with local data.
- `lib/mock-data.ts` - seed/demo data and helper lookups.
- `lib/metrics.ts` - frontend metric formulas; keep behavior compatible.
- `docs/backend-design.md` - original backend design, to be superseded by local app design while preserving useful model notes.

## Constraints

- Do not change visual styling while migrating.
- Do not redesign workflows.
- Keep the mock behavior available long enough to verify migration before replacing it with SQLite-backed data.

## Verification

- Git history contains the original import.
- Later stages should be able to compare against this baseline.
