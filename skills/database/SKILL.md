---
name: sealos-db
description: >-
  Use when someone needs to manage databases on Sealos: create, list, update, scale,
  delete, start, stop, restart, check status, get connection info, enable/disable
  public access, backup/restore databases, or view database logs. Triggers on
  "I need a database", "create a PostgreSQL on sealos", "scale my database",
  "delete the database", "show my databases", "backup my database",
  "restore from backup", "show database logs", or "my app needs a database connection".
---

## Interaction Principle

**NEVER output a question as plain text. ALWAYS use `AskUserQuestion` with `options`.**

Claude Code's text output is non-interactive — if you write a question as plain text, the
user has no clickable options and must guess how to respond. `AskUserQuestion` gives them
clear choices they can click.

- Every question → `AskUserQuestion` with `options`. Keep any preceding text to one short status line.
- `AskUserQuestion` adds an implicit "Other / Type something" option, so users can always type custom input.
- **Free-text matching:** When the user types instead of clicking, match to the closest option by intent.
  "pg" → PostgreSQL; "mongo" → MongoDB. Never re-ask because wording didn't match exactly.

## Fixed Execution Order

**ALWAYS follow these steps in this exact order. No skipping, no reordering.**

```
Step 0: Check Auth         (try existing config from previous session)
Step 1: Authenticate        (only if Step 0 fails)
Step 2: Route               (determine which operation the user wants)
Step 3: Execute operation   (follow the operation-specific steps below)
```

---

## Step 0: Check Auth

The script auto-derives its API URL from `~/.sealos/auth.json` (saved by login)
and reads credentials from `~/.sealos/kubeconfig`. No separate config file needed.

1. Run `node scripts/sealos-db.mjs list`
2. If works → skip Step 1. Greet with context:
   > Connected to Sealos. You have N databases.
3. If fails (not authenticated, 401, connection error) → proceed to Step 1

---

## Step 1: Authenticate

Run this step only if Step 0 failed.

### 1a. OAuth2 Login

Read `config.json` (in this skill's directory) for available regions and the default.
Ask the user which region to connect to using `AskUserQuestion` with the regions as options.

Run `node scripts/sealos-auth.mjs login {region_url}` (omit region_url for default).

This command:
1. Opens the user's browser to the Sealos authorization page
2. Displays a user code and verification URL in stderr
3. Polls until the user approves (max 10 minutes)
4. Exchanges the token for a kubeconfig
5. Saves to `~/.sealos/kubeconfig` and `~/.sealos/auth.json` (with region)

Display while waiting:
> Opening browser for Sealos login... Approve the request in your browser.

**If TLS error**: Retry with `node scripts/sealos-auth.mjs login --insecure`

**If other error**:
`AskUserQuestion`:
- header: "Login Failed"
- question: "Browser login failed. Try again?"
- options: ["Try again", "Cancel"]

### 1b. Verify connection

After login, run `node scripts/sealos-db.mjs list` to verify auth works.

**If auth error (401):** Token may have expired. Re-run `node scripts/sealos-auth.mjs login`.

**If success:** Display:
> Connected to Sealos. You have N databases.

Use the databases list in Step 3 instead of making a separate `list` call.

---

## Step 2: Route

Determine the operation from user intent:

| Intent | Operation |
|--------|-----------|
| "create/deploy/set up a database" | Create |
| "list/show my databases" | List |
| "check status/connection info" | Get |
| "scale/resize/update resources" | Update |
| "delete/remove database" | Delete |
| "start/stop/restart/public access" | Action |
| "backup/restore/list backups" | Backup |
| "show logs/check errors/slow queries" | Logs |

If ambiguous, ask one clarifying question.

---

## Step 3: Operations

### Create

**3a. Versions & existing databases**

Use databases from the `list` response (Step 0 or 1b). Run `node scripts/sealos-db.mjs list-versions`
to get available versions.

**3b. Ask name first**

`AskUserQuestion`:
- header: "Name"
- question: "Database name?"
- options: generate 2-3 name suggestions from project dir + detected type
  (see `references/defaults.md` for name suffix rules).
  If a name already exists (from list), avoid it and note the conflict.
- Constraint: `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`, max 63 chars

**3c. Show recommended config and confirm**

Read `references/defaults.md` for type recommendation rules, resource presets,
and termination policy defaults.

Auto-resolve config from context:
- User's request (e.g., "create a pg" → type is postgresql)
- Project tech stack (e.g., Next.js → recommend postgresql)
- Scale hints (e.g., "production database" → higher resources)

Display the **recommended config summary** (all fields from the create API):

```
Database config:

  Name:        my-app-pg
  Type:        PostgreSQL (recommended for web apps)
  Version:     postgresql-16.4.0 (latest)
  CPU:         1 Core
  Memory:      1 GB
  Storage:     3 GB
  Replicas:    3
  Termination: delete (data volumes kept)
```

Then `AskUserQuestion`:
- header: "Config"
- question: "Create with this config?"
- options:
  1. "Create now (Recommended)" — accept all, proceed to 3d
  2. "Customize" — go to 3c-customize flow

**3c-customize:** Read `references/create-flow.md` and follow the customize flow there.
It walks through field selection (Type & Version, Resources, Replicas, Termination)
with `AskUserQuestion` for each selected group. After all changes, re-display the
updated config summary and confirm.

**3d. Create and wait**

Build JSON body:
```json
{"name":"my-db","type":"postgresql","version":"postgresql-16.4.0","quota":{"cpu":1,"memory":1,"storage":3,"replicas":3},"terminationPolicy":"delete"}
```

Run `node scripts/sealos-db.mjs create-wait '<json>'`. This single command creates the
database and polls until `running` (timeout 2 minutes). The response includes connection info.

**3e. Show connection info and offer integration**

Display connection details (host, port, username, password, connection string).

Then `AskUserQuestion`:
- header: "Integration"
- question: "Write connection info to your project?"
- options:
  1. "Add to .env (Recommended)" — append to .env file
  2. "Add to docker-compose.yml" — add service/env vars
  3. "Auto-detect framework config" — detect and write to framework-specific config
  4. "Skip" — just show the info, don't write anything
- When writing to `.env`, append, don't overwrite.

---

### List

Run `node scripts/sealos-db.mjs list`. Format as table:

```
Name            Type        Version             Status    CPU  Mem  Storage  Replicas
my-app-db       postgresql  postgresql-14.8.0   Running   1    2GB  5GB      1
cache           redis       redis-7.0.6         Running   1    1GB  3GB      1
```

Highlight abnormal statuses (Failed, Stopped).

---

### Get

If no name given, run List first, then `AskUserQuestion` with database names as options
(header: "Database", question: "Which database?").

Run `node scripts/sealos-db.mjs get {name}`. Display: name, type, version, status, quota, connection info.

---

### Update

**3a.** If no name given → List, then `AskUserQuestion` to pick which database
(options = database names from list).

**3b.** Run `node scripts/sealos-db.mjs get {name}`, show current specs.

**3c.** `AskUserQuestion` (header: "Update", question: "What to change?", multiSelect: true):
- "CPU" / "Memory" / "Storage" / "Replicas"
- For each selected field, follow up with `AskUserQuestion` offering allowed values as options.
  See `references/api-reference.md` for allowed values per field.

**3d.** Show before/after diff, then `AskUserQuestion` (header: "Confirm",
question: "Apply these changes?"):
- "Apply (Recommended)"
- "Edit again"
- "Cancel"

**3e.** Run `node scripts/sealos-db.mjs update {name} '{json}'`.

---

### Delete

**This is destructive. Maximum friction.**

**3a.** If no name given → List, then `AskUserQuestion` to pick which database.

**3b.** Run `node scripts/sealos-db.mjs get {name}`, show full details + termination policy.

**3c.** Explain consequences:
- `delete` policy: cluster removed, data volumes kept
- `wipeout` policy: everything removed, irreversible

**3d.** `AskUserQuestion`:
- header: "Confirm Delete"
- question: "Type `{name}` to permanently delete this database"
- options: ["Cancel"] — do NOT include the database name as a clickable option.
  The user must type the exact name via "Type something" to confirm.

If user types the correct name → proceed to 3e.
If user types something else → reply "Name doesn't match" and re-ask.
If user clicks Cancel → abort.

**3e.** Run `node scripts/sealos-db.mjs delete {name}`.

---

### Action (Start/Pause/Restart/Public Access)

**3a.** If no name given → List, then `AskUserQuestion` to pick which database.

**3b.** `AskUserQuestion` to confirm (header: "Action", question: "Confirm {action} on {name}?"):
- "{Action} now"
- "Cancel"
- For `enable-public`, add description warning about internet exposure.

**3c.** Run `node scripts/sealos-db.mjs {action} {name}`.
**3d.** For `start`: poll `node scripts/sealos-db.mjs get {name}` until `running`.
For `enable-public`: re-fetch and display `publicConnection`.

---

### Backup

**3a.** If no database name given → List, then `AskUserQuestion` to pick which database
(options = database names from list).

**3b.** `AskUserQuestion` (header: "Backup", question: "What would you like to do?"):
- "List backups"
- "Create backup"
- "Restore from backup"
- "Delete backup"

**3c.** Read `references/backup-flow.md` and follow the sub-operation steps there.

---

### Logs

**3a.** If no database name given → List, then `AskUserQuestion` to pick which database
(options = database names from list).

**3b.** Get database details: run `node scripts/sealos-db.mjs get {name}` to determine
the database type. Map the type to log dbType parameter:
- `postgresql` → `postgresql`
- `apecloud-mysql` → `mysql`
- `mongodb` → `mongodb`
- `redis` → `redis`
- Other types → inform user that logs are only supported for mysql, mongodb, redis, postgresql

**3c.** `AskUserQuestion` (header: "Log Type", question: "Which logs?"):
- "Runtime logs" — logType: `runtimeLog`
- "Slow queries" — logType: `slowQuery`
- "Error logs" — logType: `errorLog`

**3d.** List log files: run `node scripts/sealos-db.mjs log-files {podName} {dbType} {logType}`.

The `podName` is constructed as `{name}-{type}-0` where `{name}` is the database name
and `{type}` is the database type from the `get` response (e.g., `my-db-postgresql-0`).
For MySQL, use the API type: `my-db-apecloud-mysql-0`.

Display available log files. If multiple files, `AskUserQuestion` with file paths as options
(header: "Log File", question: "Which log file?"). If only one, use it directly.

**3e.** Fetch logs: run `node scripts/sealos-db.mjs logs {podName} {dbType} {logType} {logPath}`.

Display log entries in a readable format:
```
[2024-01-15 02:00:00] [LOG]   checkpoint starting: xlog
[2024-01-15 02:00:01] [ERROR] connection reset by peer
```

If `hasMore` is true in the response metadata, offer to fetch more:
`AskUserQuestion` (header: "More Logs", question: "Load more log entries?"):
- "Next page"
- "Done"

---

## Scripts

Two entry points in `scripts/` (relative to this skill's directory):
- `sealos-auth.mjs` — OAuth2 Device Grant login (shared across all skills)
- `sealos-db.mjs` — Database operations

**Auth commands:**
```bash
node $SCRIPTS/sealos-auth.mjs check              # Check if authenticated
node $SCRIPTS/sealos-auth.mjs login               # Start OAuth2 login
node $SCRIPTS/sealos-auth.mjs login --insecure    # Skip TLS verification
node $SCRIPTS/sealos-auth.mjs info                # Show auth details
```

Zero external dependencies (Node.js only). TLS verification is disabled for self-signed certs.

**The scripts are bundled with this skill — do NOT check if they exist. Just run them.**

**Path resolution:** Scripts are in this skill's `scripts/` directory. The full path is
listed in the system environment's "Additional working directories" — use it directly.

**Config resolution:** The script reads `~/.sealos/auth.json` (region) and `~/.sealos/kubeconfig`
(credentials) — both created by `sealos-auth.mjs login`.

```bash
# Examples use SCRIPT as placeholder — replace with <SKILL_DIR>/scripts/sealos-db.mjs

# After login, everything just works — API URL derived from auth.json region
node $SCRIPT list-versions
node $SCRIPT list
node $SCRIPT get my-db
node $SCRIPT create-wait '{"name":"my-db","type":"postgresql","version":"postgresql-16.4.0","quota":{"cpu":1,"memory":1,"storage":3,"replicas":3},"terminationPolicy":"delete"}'
node $SCRIPT update my-db '{"quota":{"cpu":2,"memory":4}}'
node $SCRIPT delete my-db
node $SCRIPT start|pause|restart my-db
node $SCRIPT enable-public|disable-public my-db
node $SCRIPT list-backups|create-backup|delete-backup|restore-backup my-db [args]
node $SCRIPT log-files|logs my-db-postgresql-0 postgresql runtimeLog [logPath] [page] [pageSize]
```

## Reference Files

- `references/api-reference.md` — API endpoints, resource constraints, error formats. Read first.
- `references/defaults.md` — Tier presets, type recommendations, config card templates, termination policy. Read for create operations.
- `references/create-flow.md` — Create customize flow (Type, Version, Resources, Replicas, Termination). Read when user selects "Customize" during create.
- `references/backup-flow.md` — Backup sub-operations (list, create, delete, restore). Read for backup operations.
- `references/openapi.json` — Complete OpenAPI spec. Read only for edge cases.

## Error Handling

**Treat each error independently.** Do NOT chain unrelated errors.

| Scenario | Action |
|----------|--------|
| Kubeconfig not found | Run `node scripts/sealos-auth.mjs login` to authenticate |
| Auth error (401) | Kubeconfig expired. Run `node scripts/sealos-auth.mjs login` to re-authenticate. |
| Name conflict (409) | Suggest alternative name |
| Invalid specs | Explain constraint, suggest valid value |
| Storage shrink | Refuse, K8s limitation |
| Creation timeout (>2 min) | Offer to keep polling or check console |
| "Unsupported version" (500) | Retry WITHOUT version field |
| "namespace not found" (500) | Cluster admin kubeconfig; need Sealos user kubeconfig |

## Rules

- NEVER ask a question as plain text — ALWAYS use `AskUserQuestion` with options
- NEVER ask user to manually download kubeconfig — always use `scripts/sealos-auth.mjs login`
- NEVER run `test -f` or `ls` on the skill scripts — they are always present, just run them
- NEVER write kubeconfig to `~/.kube/config` — may overwrite user's existing config
- NEVER echo kubeconfig content to output
- NEVER delete without explicit name confirmation
- NEVER construct HTTP requests inline — always use `scripts/sealos-db.mjs`
- When writing to `.env`, append, don't overwrite
- Version must come from `node scripts/sealos-db.mjs list-versions`. If rejected, retry without version field
- MySQL type is `apecloud-mysql`, not `mysql`
- Storage can only expand, never shrink
