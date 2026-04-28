---
name: sealos-applaunchpad
description: >-
  Use when someone needs to deploy or manage containerized applications on Sealos:
  create, list, update, scale, delete, start, stop, pause, restart apps,
  check status, manage ports, env vars, storage, config maps.
  Triggers on "deploy my app", "create an app on sealos", "scale my app",
  "I need to deploy a container", "stop my app", "show my apps",
  "run a container", "launch a service", "manage my deployment",
  "check my running apps", "update my app's image", "add storage to my app",
  "host my app", "put this on the cloud", "I need a server for my API",
  "spin up a container", "run this image", "set up a service on sealos".
  Also trigger when user asks about running/hosting any containerized workload on Sealos.
---

## Interaction Principle

**NEVER output a question as plain text. ALWAYS use `AskUserQuestion` with `options`.**

Claude Code's text output is non-interactive — if you write a question as plain text, the
user has no clickable options and must guess how to respond. `AskUserQuestion` gives them
clear choices they can click.

- Every question → `AskUserQuestion` with `options`. Keep any preceding text to one short status line.
- `AskUserQuestion` adds an implicit "Other / Type something" option, so users can always type custom input.
- **Free-text matching:** When the user types instead of clicking, match to the closest option by intent.
  "show all apps" → "Show all apps"; "deploy" → Create option; "stop" → Pause option.
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

1. Run `node scripts/sealos-applaunchpad.mjs list`
2. If works → skip Step 1. Greet with context:
   > Connected to Sealos. You have N apps running.
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

After login, run `node scripts/sealos-applaunchpad.mjs list` to verify auth works.

**If auth error (401):** Token may have expired. Re-run `node scripts/sealos-auth.mjs login`.

**If success:** Display:
> Connected to Sealos. You have N apps.

Use the apps list in Step 3 instead of making a separate `list` call.

---

## Step 2: Route

Determine the operation from user intent:

| Intent | Operation |
|--------|-----------|
| "create/deploy/launch an app" | Create |
| "list/show my apps" | List |
| "check status/details" | Get |
| "scale/resize/update/change" | Update |
| "delete/remove app" | Delete |
| "start" | Action (start) |
| **"stop/pause"** | **Action (pause)** — explain: AppLaunchpad uses "pause" (scales to zero) |
| "restart" | Action (restart) |
| "expand storage/add volume" | Storage Update |

If ambiguous, ask one clarifying question.

---

## Step 3: Operations

### Create

**3a. Ask name first**

`AskUserQuestion`:
- header: "Name"
- question: "App name?"
- options: generate 2-3 name suggestions from what the user said (e.g., "deploy redis" → "redis", "redis-cache").
  If a name already exists (from list), avoid it and note the conflict.
- Constraint: `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`, max 63 chars

**3b. Determine image**

- If user provides a specific image name: use it directly
- If user describes their tech stack (e.g., "a Next.js app"): recommend from `references/defaults.md` image table
- If user has source code but no pre-built image: recommend `/sealos-deploy` instead
- This skill deploys **pre-built images** only — do not scan the filesystem for Dockerfiles, docker-compose.yml, or project files

**3c. Show recommended config and confirm**

Read `references/defaults.md` for resource presets and image recommendations.

Auto-resolve config from context:
- User's request (e.g., "deploy my Next.js app" → node:20-slim, port 3000)
- User's stated tech stack
- Scale hints (e.g., "production app" → higher resources)

Display the **recommended config summary**:

```
App config:

  Name:      my-app
  Image:     nginx:alpine
  CPU:       0.2 Core(s)
  Memory:    0.5 GB
  Scaling:   1 replica(s)
  Ports:     80/http (public)
  Env:       0 variable(s)
  Storage:   0 volume(s)
  ConfigMap: 0 file(s)
```

Then `AskUserQuestion`:
- header: "Config"
- question: "Create with this config?"
- options:
  1. "Create now (Recommended)" — accept all, proceed to 3d
  2. "Customize" — go to 3c-customize flow

**3c-customize:** Read `references/create-flow.md` and follow the customize flow there.

**3d. Create and wait**

Build JSON body and run `node scripts/sealos-applaunchpad.mjs create-wait '<json>'`.
This creates the app and polls until `running` (timeout 2 minutes).

**3e. Show access URLs and offer integration**

For public http/grpc/ws ports, display access URLs from the response:
- `publicAddress` from each port in the response
- `privateAddress` for internal access

Then `AskUserQuestion`:
- header: "Integration"
- question: "Save access URL to your project?"
- options:
  1. "Add to .env" — append `APP_URL=https://...` (and `APP_PRIVATE_URL=...`) to `.env`
  2. "Skip" — just show the info, don't write anything
- When writing to `.env`, append, don't overwrite existing content.

---

### List

Run `node scripts/sealos-applaunchpad.mjs list`. Format as table:

```
Name            Image           Status    CPU   Mem    Replicas  Ports
my-app          nginx:alpine    running   0.2   0.5GB  1        80/http (public)
api-server      node:20-slim    running   1     2GB    3        3000/http (public)
```

Highlight abnormal statuses (error, waiting, pause).

---

### Get

If no name given, run List first, then `AskUserQuestion` with app names as options
(header: "App", question: "Which app?").

Run `node scripts/sealos-applaunchpad.mjs get {name}`. Display:
- name, image, status, quota (cpu, memory, replicas/hpa, gpu)
- ports with public/private addresses
- env variables, configMap, storage
- resourceType, kind, createdAt, upTime
- Access URLs for public ports

---

### Update

**3a.** If no name given → List, then `AskUserQuestion` to pick which app
(options = app names from list).

**3b.** Run `node scripts/sealos-applaunchpad.mjs get {name}`, show current specs.

**3c.** `AskUserQuestion` (header: "Update", question: "What to change?", multiSelect: true):
- "Image & Command"
- "Resources (CPU, Memory, Scaling)"
- "Networking (Ports)"
- "Advanced (Env, ConfigMap, Storage)"

For each selected field, follow up with `AskUserQuestion` offering allowed values as options.
See `references/api-reference.md` for allowed update values:
- CPU: 0.1, 0.2, 0.5, 1, 2, 3, 4, 8
- Memory: 0.1, 0.5, 1, 2, 4, 8, 16

**3d.** **WARN**: ports, env, configMap, storage are **COMPLETE REPLACEMENT** —
must include ALL items to keep. Items not listed will be deleted.

Show before/after diff, then `AskUserQuestion` (header: "Confirm",
question: "Apply these changes?"):
- "Apply (Recommended)"
- "Edit again"
- "Cancel"

**3e.** Run `node scripts/sealos-applaunchpad.mjs update {name} '{json}'`.

---

### Delete

**This is destructive. Maximum friction.**

**3a.** If no name given → List, then `AskUserQuestion` to pick which app.

**3b.** Run `node scripts/sealos-applaunchpad.mjs get {name}`, show full details.

**3c.** Explain consequences:
- The app and all its resources (pods, services, ingress) will be permanently deleted
- Storage volumes may be lost
- Public URLs will stop working immediately

**3d.** `AskUserQuestion`:
- header: "Confirm Delete"
- question: "Type `{name}` to permanently delete this app"
- options: ["Cancel"] — do NOT include the app name as a clickable option.
  The user must type the exact name via "Type something" to confirm.

If user types the correct name → proceed to 3e.
If user types something else → reply "Name doesn't match" and re-ask.
If user clicks Cancel → abort.

**3e.** Run `node scripts/sealos-applaunchpad.mjs delete {name}`.

---

### Action (Start/Pause/Restart)

**3a.** If no name given → List, then `AskUserQuestion` to pick which app.

**3b.** `AskUserQuestion` to confirm (header: "Action", question: "Confirm {action} on {name}?"):
- "{Action} now"
- "Cancel"

**Important:** "stop" maps to "pause". Explain to the user:
> AppLaunchpad uses "pause" which scales your app to zero replicas. Your configuration is preserved.

**3c.** Run `node scripts/sealos-applaunchpad.mjs {action} {name}`.
**3d.** For `start`: poll `node scripts/sealos-applaunchpad.mjs get {name}` until `running`.

---

### Storage Update

**3a.** If no name given → List, then `AskUserQuestion` to pick which app.

**3b.** Run `node scripts/sealos-applaunchpad.mjs get {name}` to verify current storage state.

**3c.** Ask what to add/expand:
- Show current storage volumes
- This is **incremental merge** — only specify new or expanded volumes
- Name is auto-generated from path (don't send name field)

**3d.** **Expand only** — warn if user tries to shrink:
> Storage volumes can only be expanded, never shrunk (Kubernetes limitation).

**3e.** Warn about potential downtime during storage operations.

**3f.** Run `node scripts/sealos-applaunchpad.mjs update-storage {name} '{"storage":[...]}'`.

---

## Scripts

Two entry points in `scripts/` (relative to this skill's directory):
- `sealos-auth.mjs` — OAuth2 Device Grant login (shared across all skills)
- `sealos-applaunchpad.mjs` — App deployment and management operations

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
# Examples use SCRIPT as placeholder — replace with <SKILL_DIR>/scripts/sealos-applaunchpad.mjs

# After login, everything just works — API URL derived from auth.json region
node $SCRIPT list
node $SCRIPT get my-app
node $SCRIPT create '{"name":"my-app","image":{"imageName":"nginx:alpine"},"quota":{"cpu":0.2,"memory":0.5,"replicas":1},"ports":[{"number":80}]}'
node $SCRIPT create-wait '{"name":"my-app","image":{"imageName":"nginx:alpine"},"quota":{"cpu":0.2,"memory":0.5,"replicas":1},"ports":[{"number":80}]}'
node $SCRIPT update my-app '{"quota":{"cpu":1,"memory":2}}'
node $SCRIPT delete my-app
node $SCRIPT start|pause|restart my-app
node $SCRIPT update-storage my-app '{"storage":[{"path":"/var/data","size":"20Gi"}]}'
```

## Reference Files

- `references/api-reference.md` — API endpoints, resource constraints, error formats. Read first.
- `references/defaults.md` — Resource presets, image recommendations, config summary template. Read for create operations.
- `references/create-flow.md` — Create customize flow (Image, Resources, Networking, Advanced). Read when user selects "Customize" during create.
- `references/openapi.json` — Complete OpenAPI spec (~6000 lines). **DO NOT read this file in full.** Use `api-reference.md` instead — it covers all standard operations. Only read specific sections of `openapi.json` (with line-limited reads) if you need schema details not covered by `api-reference.md`.

## Error Handling

**Treat each error independently.** Do NOT chain unrelated errors.

| Scenario | Action |
|----------|--------|
| Kubeconfig not found | Run `node scripts/sealos-auth.mjs login` to authenticate |
| Auth error (401) | Kubeconfig expired. Run `node scripts/sealos-auth.mjs login` to re-authenticate. |
| Name conflict (409) | Suggest alternative name |
| Invalid image | Check image name and registry access |
| Storage shrink | Refuse, K8s limitation |
| Creation timeout (>2 min) | Offer to keep polling or check console |
| "namespace not found" (500) | Cluster admin kubeconfig; need Sealos user kubeconfig |

## Rules

- NEVER ask a question as plain text — ALWAYS use `AskUserQuestion` with options
- NEVER ask user to manually download kubeconfig — always use `scripts/sealos-auth.mjs login`
- NEVER run `test -f` or `ls` on the skill scripts — they are always present, just run them
- NEVER write kubeconfig to `~/.kube/config` — may overwrite user's existing config
- NEVER echo kubeconfig content to output
- NEVER construct HTTP requests inline — always use `scripts/sealos-applaunchpad.mjs`
- NEVER delete without explicit name confirmation
- When writing to `.env`, append, don't overwrite
- Storage can only expand, never shrink
