# Create Customize Flow

When user selects "Customize" in step 3d, follow this flow.

## Pick fields to change, then configure only those

`AskUserQuestion`:
- header: "Customize"
- question: "Which fields do you want to change?"
- multiSelect: true
- options: **(max 4 items)** — group the 7 fields into 4:
  - "Type & Version — {current_type} {current_version}"
  - "Resources (CPU, Memory, Storage) — {cpu}C / {mem}GB / {storage}GB"
  - "Replicas — {current_replicas}"
  - "Termination — {current_policy}"

When "Type & Version" selected → ask Type (step 1), then Version (step 2).
When "Resources" selected → ask CPU (step 3), Memory (step 4), Storage (step 5) sequentially.
Fields not selected keep their current values.

**1) Type** — First output ALL available types from `list-versions` as a numbered text list.
Then `AskUserQuestion`:
- header: "Type"
- question: "Database type?"
- options: **(max 4 items)** — top 4 types for the project context
  (see `references/defaults.md`), mark current with "(current)".
  User can type any other type name/number via "Type something".
- Example options array (for a Next.js project where current is postgresql):
  ```
  ["PostgreSQL (current)",
   "MongoDB",
   "Redis",
   "MySQL"]
  ```
- After type change: auto-update version to latest for new type

**2) Version** — First output ALL available versions for the chosen type as a numbered text list.
Then `AskUserQuestion`:
- header: "Version"
- question: "Which version?"
- options: **(max 4 items)** — latest 4 versions for the chosen type from `list-versions`,
  mark latest with "(latest)".
  User can type any other version via "Type something".
- Example options array:
  ```
  ["postgresql-16.4.0 (latest)",
   "postgresql-15.7.0",
   "postgresql-14.12.0",
   "postgresql-13.15.0"]
  ```

**3) CPU** → `AskUserQuestion`:
- header: "CPU"
- question: "CPU cores? (1-8)"
- options: **(max 4 items)** — `1 (current), 2, 4, 8` cores.
  Mark current with "(current)".

**4) Memory** → `AskUserQuestion`:
- header: "Memory"
- question: "Memory? (0.1-32 GB)"
- options: **(max 4 items)** — `1 (current), 2, 4, 8` GB.
  Mark current with "(current)".

**5) Storage** → `AskUserQuestion`:
- header: "Storage"
- question: "Storage? (1-300 GB)"
- options: **(max 4 items)** — `3 (current), 10, 20, 50` GB.
  Mark current with "(current)".

**6) Replicas** → `AskUserQuestion`:
- header: "Replicas"
- question: "Replicas? (1-20)"
- options: **(max 4 items)** — `1 (current), 2, 3, 5`.
  Mark current with "(current)".

**7) Termination policy** → `AskUserQuestion`:
- header: "Termination"
- question: "Termination policy? (cannot be changed after creation)"
- options:
  1. "delete (Recommended)" — description: "Cluster removed, data volumes (PVC) kept"
  2. "wipeout" — description: "Everything removed including data, irreversible"

After all fields, re-display the updated config summary and `AskUserQuestion`:
- header: "Config"
- question: "Create with this config?"
- options:
  1. "Create now (Recommended)"
  2. "Customize" — re-run the customize flow

Constraints:
- MySQL type is `apecloud-mysql`, not `mysql`
- Termination policy is set at creation and **cannot be changed later**
- `multiSelect: true` works with up to 4 options — the implicit "Type something" option is always appended by the tool
