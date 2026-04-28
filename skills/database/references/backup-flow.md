# Backup Operations

## List backups

Run `node scripts/sealos-db.mjs list-backups {name}`. Format as table:

```
Name                              Status      Created
my-db-backup-20240115             completed   2024-01-15T02:00:00Z
my-db-backup-20240120             completed   2024-01-20T02:00:00Z
```

Highlight non-completed statuses (inprogress, failed).

## Create backup

`AskUserQuestion` (header: "Backup Description", question: "Optional description? (max 31 chars)"):
- "Skip (no description)"
- "Pre-migration backup"
- "Manual snapshot"

Run `node scripts/sealos-db.mjs create-backup {name} '{"description":"..."}'` (omit body if skipped).
Confirm success.

## Delete backup

Run `node scripts/sealos-db.mjs list-backups {name}` first to show available backups.
`AskUserQuestion` with backup names as options (header: "Delete Backup", question: "Which backup to delete?").
Then confirm:
`AskUserQuestion` (header: "Confirm", question: "Delete backup '{backupName}'?"):
- "Delete"
- "Cancel"

Run `node scripts/sealos-db.mjs delete-backup {name} {backupName}`.

## Restore from backup

Run `node scripts/sealos-db.mjs list-backups {name}` first to show available backups.
`AskUserQuestion` with backup names (status=completed only) as options
(header: "Restore", question: "Which backup to restore from?").

Then `AskUserQuestion` (header: "Restore Config", question: "Restore with defaults?"):
- "Restore now (auto-name, same replicas)" — proceed with empty body
- "Customize name & replicas"

If customize: ask for new database name and replica count via `AskUserQuestion`.

Warn that restore creates a **new** database instance:
> This will create a new database from the backup. The original database is not affected.

`AskUserQuestion` (header: "Confirm Restore", question: "Restore from '{backupName}'?"):
- "Restore now"
- "Cancel"

Run `node scripts/sealos-db.mjs restore-backup {name} {backupName} '{"name":"...","replicas":N}'`.
