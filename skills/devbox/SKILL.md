---
name: sealos-devbox
description: >-
  Use when someone needs to manage development environments on Sealos: create, list,
  update, scale, delete, start, pause, shutdown, restart devboxes, get SSH connection info,
  manage ports, create releases, deploy to production, or monitor resource usage.
  Triggers on "I need a devbox", "create a Node.js devbox on sealos", "scale my devbox",
  "delete the devbox", "show my devboxes", "deploy my devbox", "get SSH info",
  "pause the devbox", "create a release", "my app needs a dev environment",
  "set up a cloud development environment", "I want to code on a remote server",
  "remote dev machine", "how do I connect to my devbox via SSH",
  "cloud IDE", "cloud workspace", or "spin up a dev environment on Sealos".
---

## Interaction Principle

**NEVER output a question as plain text. ALWAYS use `AskUserQuestion` with `options`.**

Claude Code's text output is non-interactive — if you write a question as plain text, the
user has no clickable options and must guess how to respond. `AskUserQuestion` gives them
clear choices they can click.

- Every question → `AskUserQuestion` with `options`. Keep any preceding text to one short status line.
- `AskUserQuestion` adds an implicit "Other / Type something" option, so users can always type custom input.
- **Free-text matching:** When the user types instead of clicking, match to the closest option by intent.
  "node", "nodejs" → Node.js; "py", "python3" → Python; "next" → Next.js.
  Never re-ask because wording didn't match exactly.

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

1. Run `node scripts/sealos-devbox.mjs list`
2. If works → skip Step 1. Greet with context:
   > Connected to Sealos. You have N devboxes.
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

After login, run `node scripts/sealos-devbox.mjs list` to verify auth works.

**If auth error (401):** Token may have expired. Re-run `node scripts/sealos-auth.mjs login`.

**If success:** Display:
> Connected to Sealos. You have N devboxes.

Use the devboxes list in Step 3 instead of making a separate `list` call.

---

## Step 2: Route

Determine the operation from user intent:

| Intent | Operation |
|--------|-----------|
| "create/set up a devbox/dev environment" | Create |
| "list/show my devboxes" | List |
| "check status/details/SSH info" | Get |
| "scale/resize/update resources/ports" | Update |
| "delete/remove devbox" | Delete |
| "start/pause/shutdown/restart" | Action |
| "SSH/connect/remote access" | SSH Connect |
| "create release/tag/version" | Release |
| "deploy/ship to production" | Deploy |
| "monitor/metrics/CPU/memory usage" | Monitor |
| "autostart/startup command" | Autostart |

If ambiguous, ask one clarifying question.

---

## Step 3: Operations

### Create

**3a. Templates & existing devboxes**

Use devboxes from the `list` response (Step 0 or 1b). Run `node scripts/sealos-devbox.mjs templates`
to get available runtimes. If `templates` fails, tell the user the API is unavailable, offer to
retry, or let them type a runtime name manually (refer to `references/api-reference.md` Available
Runtimes for the known list).

**3b. Ask name first**

`AskUserQuestion`:
- header: "Name"
- question: "Devbox name?"
- options: generate 2-3 name suggestions from project dir + detected runtime
  (see `references/defaults.md` for name suffix rules).
  If a name already exists (from list), avoid it and note the conflict.
- Constraint: `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`, max 63 chars

**3c. Show recommended config and confirm**

Read `references/defaults.md` for runtime recommendation rules and resource presets.

Auto-resolve config from context:
- User's request (e.g., "create a python devbox" → runtime is python)
- Project tech stack (e.g., Next.js → recommend next.js runtime)
- Scale hints (e.g., "production devbox" → higher resources)
- Default port from templates API (e.g., next.js → 3000)

Display the **recommended config summary** (all fields from the create API):

```
Devbox config:

  Name:        my-app-next
  Runtime:     next.js (detected from next.config.mjs)
  CPU:         1 Core
  Memory:      2 GB
  Ports:       3000 (http, public)
```

Then `AskUserQuestion`:
- header: "Config"
- question: "Create with this config?"
- options:
  1. "Create now (Recommended)" — accept all, proceed to 3d
  2. "Customize" — go to 3c-customize flow

**3c-customize: Pick fields to change, then configure only those**

`AskUserQuestion`:
- header: "Customize"
- question: "Which fields do you want to change?"
- multiSelect: true
- options: **(max 4 items)** — group fields into 4:
  - "Runtime — {current_runtime}"
  - "Resources (CPU, Memory) — {cpu}C / {mem}GB"
  - "Ports — {current_ports}"
  - "Env & Autostart"

When "Runtime" selected → ask Runtime (step 1).
When "Resources" selected → ask CPU (step 2), Memory (step 3) sequentially.
When "Ports" selected → ask port config (step 4).
When "Env & Autostart" selected → ask env vars and autostart command (step 5).
Fields not selected keep their current values.

**1) Runtime** — First output ALL available runtimes from `templates` as a numbered text list.
Then `AskUserQuestion`:
- header: "Runtime"
- question: "Which runtime?"
- options: **(max 4 items)** — top 4 runtimes for the project context
  (see `references/defaults.md`), mark current with "(current)".
  User can type any other runtime name/number via "Type something".
- After runtime change: auto-update default port from templates API

**2) CPU** → `AskUserQuestion`:
- header: "CPU"
- question: "CPU cores? (0.1-32)"
- options: **(max 4 items)** — `0.5, 1 (current), 2, 4` cores.
  Mark current with "(current)".

**3) Memory** → `AskUserQuestion`:
- header: "Memory"
- question: "Memory? (0.1-32 GB)"
- options: **(max 4 items)** — `1, 2 (current), 4, 8` GB.
  Mark current with "(current)".

**4) Ports** → `AskUserQuestion`:
- header: "Ports"
- question: "Port configuration?"
- options:
  - "Keep default ({port} http public)" — use template default
  - "Add custom port"
  - "No ports"

If "Add custom port": ask for port number, protocol (http/grpc/ws), and isPublic.

**5) Env & Autostart** → Ask for environment variables (name=value pairs) and
autostart command (optional). If user provides env vars, parse them into the array format.
See also: Autostart operation in `references/operations.md` for standalone autostart configuration.

After all fields, re-display the updated config summary and `AskUserQuestion`:
- header: "Config"
- question: "Create with this config?"
- options:
  1. "Create now (Recommended)"
  2. "Customize" — re-run the customize flow

**3d. Create and wait**

Build JSON body:
```json
{"name":"my-devbox","runtime":"next.js","quota":{"cpu":1,"memory":2},"ports":[{"number":3000,"protocol":"http","isPublic":true}]}
```

Run `node scripts/sealos-devbox.mjs create-wait '<json>'`. This single command creates the
devbox and polls until `running` (timeout 2 minutes). The response includes SSH info.

**3e. Show SSH info and offer integration**

Display SSH connection details (host, port, username, key path).

Then `AskUserQuestion`:
- header: "Integration"
- question: "Set up SSH access for this devbox?"
- options:
  1. "Write SSH config (Recommended)" — append Host block to `~/.ssh/config`
  2. "Show SSH command only" — display `ssh -i key -p port user@host`
  3. "Open in VS Code" — show VS Code Remote SSH instructions
  4. "Skip" — just show the info, don't write anything
- When writing SSH config, append, don't overwrite.

---

### List

Run `node scripts/sealos-devbox.mjs list`. Format as table:

```
Name            Runtime     Status    CPU  Memory
my-app-next     next.js     Running   1    2GB
api-server      go          Stopped   2    4GB
```

Highlight abnormal statuses (Error, Stopped).

---

### Get

If no name given, run List first, then `AskUserQuestion` with devbox names as options
(header: "Devbox", question: "Which devbox?").

Run `node scripts/sealos-devbox.mjs get {name}`. Display: name, runtime, status, quota,
SSH info, ports, env, pods.

---

### Update

**3a.** If no name given → List, then `AskUserQuestion` to pick which devbox
(options = devbox names from list).

**3b.** Run `node scripts/sealos-devbox.mjs get {name}`, show current specs.

**3c.** `AskUserQuestion` (header: "Update", question: "What to change?", multiSelect: true):
- "CPU & Memory"
- "Ports"

**For CPU & Memory:** Follow up with `AskUserQuestion` for each field offering allowed values.
See `references/api-reference.md` for allowed ranges.

**For Ports:** Show current ports. Then `AskUserQuestion`:
- "Add a port"
- "Remove a port" (list existing ports as sub-options)
- "Toggle public access" (list existing ports)
- "Replace all ports" (specify new port list)

**3c-ports.** When ports are changing, display a clear before/after:

```
Ports (before → after):

  ✓ 3000 http public     (keeping)
  - 8080 http public     (removing)
  + 9090 grpc private    (adding)
```

Warn if any existing ports will be removed. Require explicit confirmation for port removals.

**3d.** Show before/after diff, then `AskUserQuestion` (header: "Confirm",
question: "Apply these changes?"):
- "Apply (Recommended)"
- "Edit again"
- "Cancel"

**3e.** Run `node scripts/sealos-devbox.mjs update {name} '{json}'`.

**Important:** When updating ports, the `ports` array in the update body is a **full replacement**.
Include all existing ports you want to keep (with their `portName`), plus any new ports.
Existing ports omitted from the array will be deleted.

---

### Delete

**This is destructive. Maximum friction.**

**3a.** If no name given → List, then `AskUserQuestion` to pick which devbox.

**3b.** Run `node scripts/sealos-devbox.mjs get {name}`, show full details.

**3c.** Explain consequences:
> Deleting a devbox permanently removes the environment, all files inside it, SSH keys,
> and port configurations. This cannot be undone.

**3d.** `AskUserQuestion`:
- header: "Confirm Delete"
- question: "Type `{name}` to permanently delete this devbox"
- options: ["Cancel"] — do NOT include the devbox name as a clickable option.
  The user must type the exact name via "Type something" to confirm.

If user types the correct name → proceed to 3e.
If user types something else → reply "Name doesn't match" and re-ask.
If user clicks Cancel → abort.

**3e.** Run `node scripts/sealos-devbox.mjs delete {name}`.

---

### Action (Start/Pause/Shutdown/Restart)

**3a.** If no name given → List, then `AskUserQuestion` to pick which devbox.

**3b.** For pause and shutdown, explain the difference:

> **Pause** — Quick suspend. The pod is paused but resources stay allocated. Fast resume (~seconds).
> Use when you're stepping away briefly.
>
> **Shutdown** — Full stop. Resources are released. Slower resume (~30s-1min) as the pod must restart.
> Use when you're done for the day or want to save costs.

**3c.** `AskUserQuestion` to confirm (header: "Action", question: "Confirm {action} on {name}?"):
- "{Action} now"
- "Cancel"

**3d.** Run `node scripts/sealos-devbox.mjs {action} {name}`.
**3e.** For `start`: poll `node scripts/sealos-devbox.mjs get {name}` until `running`.

---

### SSH Connect

**3a.** If no name given → List, then `AskUserQuestion` to pick which devbox.

**3b.** Run `node scripts/sealos-devbox.mjs get {name}`. Extract SSH info.

**3c.** Check if SSH key exists at `~/.config/sealos-devbox/keys/{name}.pem`.

**3d.** Display SSH connection info:

```
SSH Connection:

  Host:        {ssh.host}
  Port:        {ssh.port}
  User:        {ssh.user}
  Key:         ~/.config/sealos-devbox/keys/{name}.pem
  Working Dir: {ssh.workingDir}

  Command: ssh -i ~/.config/sealos-devbox/keys/{name}.pem -p {ssh.port} {ssh.user}@{ssh.host}
```

**3e.** `AskUserQuestion`:
- header: "SSH Setup"
- question: "How would you like to connect?"
- options:
  1. "Write SSH config" — append Host block to `~/.ssh/config`
  2. "Copy SSH command" — just show the command
  3. "VS Code Remote SSH" — show instructions for VS Code Remote-SSH extension
  4. "Done"

---

### Release

**3a.** If no name given → List, then `AskUserQuestion` to pick which devbox.

**3b.** `AskUserQuestion` (header: "Release", question: "What would you like to do?"):
- "Create a release"
- "List releases"
- "Delete a release"

**Create release:**
`AskUserQuestion` (header: "Release Tag", question: "Tag for this release?"):
- Suggest tags like "v1.0.0", "v0.1.0", or based on existing releases
- Ask for optional description

Build body: `{"tag":"v1.0.0","releaseDescription":"...","startDevboxAfterRelease":true}`

Run `node scripts/sealos-devbox.mjs create-release {name} '<json>'`.
Show status (202 Accepted = async). Suggest checking `list-releases` for progress.

**List releases:**
Run `node scripts/sealos-devbox.mjs list-releases {name}`. Format as table:

```
Tag       Description          Created              Image
v1.0.0    First release        2024-01-15 10:00     ghcr.io/...
v0.1.0    Beta                 2024-01-10 08:00     ghcr.io/...
```

**Delete release:**
Run `node scripts/sealos-devbox.mjs list-releases {name}` first. `AskUserQuestion` with
tags as options (header: "Delete Release", question: "Which release to delete?").
Confirm before deleting.

Run `node scripts/sealos-devbox.mjs delete-release {name} {tag}`.

---

### Deploy

**3a.** If no name given → List, then `AskUserQuestion` to pick which devbox.

**3b.** Run `node scripts/sealos-devbox.mjs list-releases {name}`. If no releases,
guide user to create one first.

**3c.** `AskUserQuestion` (header: "Deploy", question: "Which release to deploy?"):
- List available release tags as options

**3d.** `AskUserQuestion` to confirm (header: "Confirm Deploy",
question: "Deploy `{tag}` of `{name}` to AppLaunchpad?"):
- "Deploy now"
- "Cancel"

**3e.** Run `node scripts/sealos-devbox.mjs deploy {name} {tag}`.

**3f.** Show deployment status. Run `node scripts/sealos-devbox.mjs list-deployments {name}`
to verify.

---

### Monitor

Read `references/operations.md` → Monitor section and follow the steps there.

---

### Autostart

Read `references/operations.md` → Autostart section and follow the steps there.

---

## Scripts

Two entry points in `scripts/` (relative to this skill's directory):
- `sealos-auth.mjs` — OAuth2 Device Grant login (shared across all skills)
- `sealos-devbox.mjs` — Devbox operations

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
# Examples use SCRIPT as placeholder — replace with <SKILL_DIR>/scripts/sealos-devbox.mjs

# After login, everything just works — API URL derived from auth.json region
node $SCRIPT templates
node $SCRIPT list
node $SCRIPT get my-devbox
node $SCRIPT create-wait '{"name":"my-devbox","runtime":"node.js","quota":{"cpu":1,"memory":2},"ports":[{"number":3000}]}'
node $SCRIPT update my-devbox '{"quota":{"cpu":2,"memory":4}}'
node $SCRIPT update my-devbox '{"ports":[{"portName":"existing-port","isPublic":false},{"number":8080}]}'
node $SCRIPT delete my-devbox
node $SCRIPT start|pause|shutdown|restart my-devbox
node $SCRIPT autostart my-devbox '{"execCommand":"npm start"}'
node $SCRIPT list-releases my-devbox
node $SCRIPT create-release my-devbox '{"tag":"v1.0.0","releaseDescription":"First release"}'
node $SCRIPT delete-release my-devbox v1.0.0
node $SCRIPT deploy my-devbox v1.0.0
node $SCRIPT list-deployments my-devbox
node $SCRIPT monitor my-devbox [start] [end] [step]
```

## Reference Files

- `references/api-reference.md` — API endpoints, resource constraints, error formats. Read first.
- `references/defaults.md` — Resource presets, runtime recommendations, config templates. Read for create operations.
- `references/openapi.json` — Complete OpenAPI spec. Read only for edge cases.

## Error Handling

**Treat each error independently.** Do NOT chain unrelated errors.

| Scenario | Action |
|----------|--------|
| Kubeconfig not found | Run `node scripts/sealos-auth.mjs login` to authenticate |
| Auth error (401) | Kubeconfig expired. Run `node scripts/sealos-auth.mjs login` to re-authenticate. |
| Name conflict (409) | Suggest alternative name |
| Invalid specs | Explain constraint, suggest valid value |
| Creation timeout (>2 min) | Offer to keep polling, or direct user to the console URL from the response (`consoleUrl` field) |
| Release 202 (async) | Explain it's building, suggest polling releases list |
| Templates API failure | Show error, offer to retry or enter runtime manually (use api-reference.md runtime list as fallback) |
| "namespace not found" (500) | Cluster admin kubeconfig; need Sealos user kubeconfig |

## Rules

- NEVER ask a question as plain text — ALWAYS use `AskUserQuestion` with options
- NEVER ask user to manually download kubeconfig — always use `scripts/sealos-auth.mjs login`
- NEVER run `test -f` or `ls` on the skill scripts — they are always present, just run them
- NEVER write kubeconfig to `~/.kube/config` — may overwrite user's existing config
- NEVER echo kubeconfig content to output
- NEVER delete without explicit name confirmation
- NEVER construct HTTP requests inline — always use `scripts/sealos-devbox.mjs`
- When writing to `~/.ssh/config`, append, don't overwrite
- Runtime must come from `node scripts/sealos-devbox.mjs templates`
- SSH keys are auto-saved on create — do not ask the user to manually save them
- When updating ports, remember the array is a full replacement — include all ports to keep
- Explain pause vs shutdown difference when the user asks for either action
