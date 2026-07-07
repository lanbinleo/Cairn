# Future Backup Sync

## Scope

Future cloud support is optional account-based backup and restore. It is not realtime sync and not multi-user collaboration.

## Intended Flow

1. User keeps working against local SQLite.
2. User signs in when they want backup.
3. App uploads an encrypted/versioned backup bundle.
4. Another device can restore the latest backup.

## Conflict Policy

Version 1 can avoid automatic merge. Restoring a cloud backup should be an explicit user action with clear replacement or import behavior.
