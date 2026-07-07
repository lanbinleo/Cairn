# Cairn Docs

Cairn is a local-first desktop app for personal trade journaling and review. It stores data locally, imports TradingView exports, groups executions into trades, and supports manual review, notes, tags, charts, metrics, backup, and restore.

## Document Map

| Document | Purpose |
| --- | --- |
| [Software Design](./software-design.md) | Product scope, architecture, domain model, storage, import rules, metrics, backup, and packaging |
| [Development Workflow](./development-workflow.md) | Branching, commits, verification, version surfaces, local data paths, and release process |
| [0.1.1 Release Notes](./release-0.1.1.md) | Logo refresh, automatic local backups, release metadata, and operational notes |
| [Future Backup Sync](./future-backup-sync.md) | Future account-based backup and restore direction |

## Maintenance Rules

- Keep product and architecture decisions in `docs/software-design.md`.
- Keep release process and verification commands in `docs/development-workflow.md`.
- Add one `docs/release-x.y.z.md` file per release.
- Keep historical migration notes under `reference/legacy/`.
- Update docs before or alongside behavior, storage, release, or packaging changes.
