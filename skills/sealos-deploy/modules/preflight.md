# Phase 0: Preflight

Detect the user's environment, record what's available, guide them to fix what's missing.

## Step 1: Environment Detection (cached)

Environment info (tool versions) rarely changes. Cache it in `~/.sealos/env.json` to avoid re-detecting every run.

### 1.1 Check Cache

```bash
cat ~/.sealos/env.json 2>/dev/null
```

If the file exists, check `cached_at` — if less than **24 hours** old, use cached values directly and **skip to Step 1.3** (Docker daemon check).

### 1.2 Detect & Save (only when cache missing or expired)

Run all checks:

```bash
# Required
docker --version 2>/dev/null
git --version 2>/dev/null

# Optional (enables script acceleration)
node --version 2>/dev/null
python3 --version 2>/dev/null

# Optional (enables GHCR push — preferred over Docker Hub)
gh --version 2>/dev/null

# Required (enables in-place updates of deployed apps)
# Check PATH first, then fallback to ~/.agents/bin/
kubectl version --client 2>/dev/null || ~/.agents/bin/kubectl version --client 2>/dev/null

# Always available (system built-in)
curl --version 2>/dev/null | head -1
which jq 2>/dev/null
```

Save results to `~/.sealos/env.json`:
```json
{
  "docker": "28.5.2",
  "git": "2.39.5",
  "node": "20.4.0",
  "python": "3.9.6",
  "kubectl": "1.31.0",
  "gh": "2.65.0",
  "curl": true,
  "jq": true,
  "cached_at": "2026-03-05T14:30:00Z"
}
```

Version strings are present when installed, `null` when missing.

Record as `ENV`:
```
ENV.docker    = true/false
ENV.git       = true/false
ENV.node      = true/false   (18+ required)
ENV.python    = true/false
ENV.kubectl   = true/false   (if false, check ~/.agents/bin/kubectl)
ENV.gh        = true/false   (enables GHCR push — preferred over Docker Hub)
ENV.curl      = true/false
ENV.jq        = true/false
```

### 1.3 Docker Daemon Check (every run)

Even with cached env, the Docker daemon might not be running. Always verify:

```bash
docker info 2>/dev/null
```

- Not installed → guide by platform:
  - macOS: `brew install --cask docker` then open Docker Desktop
  - Linux: `curl -fsSL https://get.docker.com | sh`
- Installed but daemon not running → "Please start Docker Desktop (macOS) or `sudo systemctl start docker` (Linux)."

**git** — if missing (from cache or detection):
- `brew install git` (macOS) or `sudo apt install git` (Linux)

### Optional tools — scripts run faster, but AI can do the same work

**gh CLI (GitHub CLI):**
- If present and authenticated → enables **zero-interaction GHCR push** (preferred over Docker Hub)
- `build-push.mjs` auto-detects `gh auth status` and uses `gh auth token` to login to `ghcr.io`
- If missing → falls back to Docker Hub login (manual `docker login` required)

**Node.js:**
- If missing, no problem. Pipeline uses fallback mode:
  - `score-model.mjs` → AI reads files and applies scoring rules directly
  - `detect-image.mjs` → AI runs curl commands for Docker Hub / GHCR API
  - `build-push.mjs` → AI runs `docker buildx` commands directly
  - `sealos-auth.mjs` → AI runs curl to exchange token for kubeconfig (workspace list/switch not available in fallback mode)

**Python:**
- If missing, Sealos template validation (Phase 5) uses AI self-check instead of `quality_gate.py`

**kubectl (required):**
- Installed automatically by `install.sh` to `~/.agents/bin/kubectl`
- If `kubectl` is not in PATH, use `~/.agents/bin/kubectl` as the absolute path for all kubectl commands
- Enables in-place update of already-deployed apps (`kubectl set image`, `kubectl rollout`)
- If somehow missing, guide user to re-run the installer: `curl -fsSL https://seakills.gzg.sealos.run/install.sh | bash`

## Step 2: Project Context

Determine what we're deploying and gather project information.

### 2.1 Resolve Working Directory

**A) User provided a GitHub URL:**
```bash
WORK_DIR=$(mktemp -d)
git clone --depth 1 "<github-url>" "$WORK_DIR"
GITHUB_URL="<github-url>"
```

**B) User provided a local path:**
```bash
WORK_DIR="<local-path>"
```

**C) No input — deploy current project (most common):**
```bash
WORK_DIR="$(pwd)"
```

### 2.2 Git Repo Detection

```bash
# Is it a git repo?
git -C "$WORK_DIR" rev-parse --is-inside-work-tree 2>/dev/null

# Git metadata
git -C "$WORK_DIR" remote get-url origin 2>/dev/null      # → GITHUB_URL (if github.com)
git -C "$WORK_DIR" branch --show-current 2>/dev/null       # → BRANCH
git -C "$WORK_DIR" log --oneline -1 2>/dev/null            # → latest commit
```

Record:
```
PROJECT.work_dir    = resolved path
PROJECT.is_git      = true/false
PROJECT.github_url  = "https://github.com/owner/repo" or empty
PROJECT.repo_name   = basename of directory or parsed from URL
PROJECT.branch      = current branch
```

If `PROJECT.github_url` exists, parse `owner` and `repo` for Phase 2 image detection.

### 2.3 Read README

README is the single most important file for understanding a project. Read it now.

```bash
# Find README (case-insensitive)
ls "$WORK_DIR"/README* "$WORK_DIR"/readme* 2>/dev/null | head -1
```

Read the README content and extract:
- **Project description** — what does this project do?
- **Tech stack** — language, framework, database
- **Run/build instructions** — how to build, what port it listens on
- **Docker references** — `docker run`, `docker pull`, image names (ghcr.io/..., dockerhub/...)
- **Environment variables** — any `.env` examples or config descriptions

Record key findings in `PROJECT.readme_summary` for use in Phase 1 (assess) and Phase 2 (detect).

This avoids re-reading README in every phase. The AI already has it in context.

## Step 3: Sealos Cloud Auth (OAuth2 Device Grant Flow)

Uses RFC 8628 Device Authorization Grant — no token copy-paste needed.

### 3.0 Region Selection

Before auth, let the user choose which Sealos Cloud region to deploy to.

Read the default region and available regions from config:
```bash
SKILL_CONFIG=$(cat "<SKILL_DIR>/config.json")
DEFAULT_REGION=$(echo "$SKILL_CONFIG" | grep -o '"default_region":"[^"]*"' | cut -d'"' -f4)
```

**Always ask the user to confirm or choose a region.** Present the regions from `config.json` and allow custom input:

```
Which Sealos Cloud region do you want to deploy to?

  1. https://gzg.sealos.run  (default)
  2. https://bja.sealos.run
  3. https://hzh.sealos.run
  4. Enter a custom region URL

Default: https://gzg.sealos.run
```

The region list comes from `config.json` `regions` array. If `regions` is not present, show only `default_region`.

If the user has an existing `~/.sealos/auth.json`, read the previously used region and offer it as an option:
```bash
PREV_REGION=$(cat ~/.sealos/auth.json 2>/dev/null | grep -o '"region":"[^"]*"' | cut -d'"' -f4)
```

If `PREV_REGION` exists and differs from `DEFAULT_REGION`, include it in the choices.

Record the user's choice as `REGION` for use throughout the rest of this step and Phase 6.

**If the user picks a different region than the existing `~/.sealos/auth.json`**, the existing kubeconfig is invalid — force re-authentication.

### 3.1 Check auth status:

**With Node.js:**
```bash
node "<SKILL_DIR>/scripts/sealos-auth.mjs" check
```
Returns: `{ "authenticated": true/false, "kubeconfig_path": "...", "workspace": "ns-xxx" }`

**Without Node.js:**
```bash
test -f ~/.sealos/kubeconfig && echo '{"authenticated":true}' || echo '{"authenticated":false}'
```

### 3.2 If not authenticated — Device Grant Login:

**With Node.js (recommended):**
```bash
node "<SKILL_DIR>/scripts/sealos-auth.mjs" login [region-url]
```

If the script fails with `"error":"fetch failed"` or TLS/certificate error, retry with `--insecure`:
```bash
node "<SKILL_DIR>/scripts/sealos-auth.mjs" login [region-url] --insecure
```

If it still fails, fall back to curl (see below). **Once you switch to curl, use curl for the entire remaining flow** — do NOT mix curl and Node.js mid-flow.

The script will:
1. `POST <region>/api/auth/oauth2/device` with the `client_id` from `config.json`
2. Output a verification URL and user code to stderr
3. Auto-open the browser for the user
4. Poll `POST <region>/api/auth/oauth2/token` every 5s until approved
5. Exchange access_token for regional token via `POST <region>/api/auth/regionToken`
6. Save kubeconfig to `~/.sealos/kubeconfig` (mode 0600)
7. Save access_token, regional_token, and current_workspace to `~/.sealos/auth.json`

**Important — AI must always show the clickable URL to the user:**
Even though the script attempts to auto-open the browser, it may fail (e.g., headless environment, SSH session, sandbox restrictions).
After running the script, YOU (the AI) must extract the verification URL from stderr output and display it as a clickable link to the user:
```
Please click the link below to authorize:
<verification_uri_complete>
Authorization code: <user_code>
```
This ensures the user can always complete authorization regardless of whether auto-open succeeded.

Stdout outputs JSON result: `{ "kubeconfig_path": "...", "region": "...", "workspace": "ns-xxx" }`

**Without Node.js (curl fallback):**

**Important: once you enter the curl path, complete ALL steps with curl. Do NOT switch to Node.js or Python mid-flow.**

First, read constants from `<SKILL_DIR>/config.json`:
```bash
# Read skill constants (client_id, default_region)
SKILL_CONFIG=$(cat "<SKILL_DIR>/config.json")
CLIENT_ID=$(echo "$SKILL_CONFIG" | grep -o '"client_id":"[^"]*"' | cut -d'"' -f4)
DEFAULT_REGION=$(echo "$SKILL_CONFIG" | grep -o '"default_region":"[^"]*"' | cut -d'"' -f4)
```

Step 1 — Request device authorization:
```bash
REGION="${REGION:-$DEFAULT_REGION}"
DEVICE_RESP=$(curl -ksf -X POST "$REGION/api/auth/oauth2/device" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=${CLIENT_ID}&grant_type=urn:ietf:params:oauth:grant-type:device_code")
```
Note: `-k` skips TLS verification for self-signed certificates.

Extract fields from response:
```bash
DEVICE_CODE=$(echo "$DEVICE_RESP" | grep -o '"device_code":"[^"]*"' | cut -d'"' -f4)
USER_CODE=$(echo "$DEVICE_RESP" | grep -o '"user_code":"[^"]*"' | cut -d'"' -f4)
VERIFY_URL=$(echo "$DEVICE_RESP" | grep -o '"verification_uri_complete":"[^"]*"' | cut -d'"' -f4)
INTERVAL=$(echo "$DEVICE_RESP" | grep -o '"interval":[0-9]*' | cut -d: -f2)
INTERVAL=${INTERVAL:-5}
```

Step 2 — Show the authorization link to user:
```
Please click the link below to authorize:
$VERIFY_URL
Authorization code: $USER_CODE
```
If `VERIFY_URL` is empty, use `verification_uri` instead and show the user code separately.

Step 3 — Poll for token:
```bash
while true; do
  sleep "$INTERVAL"
  TOKEN_RESP=$(curl -ksf -X POST "$REGION/api/auth/oauth2/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "client_id=${CLIENT_ID}&grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=$DEVICE_CODE")

  # Check for access_token in response
  ACCESS_TOKEN=$(echo "$TOKEN_RESP" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
  if [ -n "$ACCESS_TOKEN" ]; then
    break
  fi

  # Check for terminal errors
  ERROR=$(echo "$TOKEN_RESP" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
  case "$ERROR" in
    authorization_pending) continue ;;
    slow_down) INTERVAL=$((INTERVAL + 5)) ;;
    access_denied) echo "User denied authorization"; exit 1 ;;
    expired_token) echo "Device code expired"; exit 1 ;;
    *) echo "Error: $ERROR"; exit 1 ;;
  esac
done
```

Step 4 — Exchange token for regional token + kubeconfig (still curl):
```bash
REGION_RESP=$(curl -ksf -X POST "$REGION/api/auth/regionToken" \
  -H "Authorization: $ACCESS_TOKEN" \
  -H "Content-Type: application/json")
# Server returns { data: { token, kubeconfig } }
REGIONAL_TOKEN=$(echo "$REGION_RESP" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
# Extract kubeconfig — it's a multi-line YAML value inside JSON
mkdir -p ~/.sealos
node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); process.stdout.write(d.data.kubeconfig)" <<< "$REGION_RESP" > ~/.sealos/kubeconfig 2>/dev/null \
  || python3 -c "import sys,json; print(json.load(sys.stdin)['data']['kubeconfig'])" <<< "$REGION_RESP" > ~/.sealos/kubeconfig
chmod 600 ~/.sealos/kubeconfig
```
Note: kubeconfig is multi-line YAML embedded in JSON — simple grep won't work. Use node/python one-liner to extract it. Save auth metadata with tokens:
```bash
cat > ~/.sealos/auth.json << EOF
{"region":"$REGION","access_token":"$ACCESS_TOKEN","regional_token":"$REGIONAL_TOKEN","authenticated_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","auth_method":"oauth2_device_grant"}
EOF
chmod 600 ~/.sealos/auth.json
```

### 3.3 Workspace Selection (every deploy)

After auth is confirmed, **always** let the user choose which workspace to deploy to. The last-used workspace is the default.

**With Node.js:**
```bash
node "<SKILL_DIR>/scripts/sealos-auth.mjs" list
```
Returns:
```json
{
  "current": "ns-abc",
  "workspaces": [
    { "uid": "...", "id": "ns-abc", "teamName": "My Team", "role": 0, "nstype": 1 },
    { "uid": "...", "id": "ns-def", "teamName": "Dev Team", "role": 0, "nstype": 0 },
    { "uid": "...", "id": "ns-ghi", "teamName": "Staging", "role": 2, "nstype": 0 }
  ]
}
```

Present the workspace list to the user. **Put the `current` workspace first**, mark it as last used:

```
Which workspace do you want to deploy to?

  1. ns-abc — My Team ← current
  2. ns-def — Dev Team
  3. ns-ghi — Staging

Default: ns-abc (My Team)
```

Display format is `id — teamName`. The `current` field from the JSON indicates the last-used workspace — always list it first.

- If the user picks the same workspace as `current` → no action needed, kubeconfig is already valid.
- If the user picks a different workspace → switch:

```bash
node "<SKILL_DIR>/scripts/sealos-auth.mjs" switch <ns-id>
```

This updates `~/.sealos/kubeconfig` and records the new workspace as `current_workspace` in `auth.json` for next time.

**Without Node.js (curl fallback):**

List workspaces:
```bash
NS_RESP=$(curl -ksf "$REGION/api/auth/namespace/list" \
  -H "Authorization: $REGIONAL_TOKEN")
```

Parse and present options to user. If the user picks a different workspace:
```bash
SWITCH_RESP=$(curl -ksf -X POST "$REGION/api/auth/namespace/switch" \
  -H "Authorization: $REGIONAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"ns_uid\":\"$TARGET_UID\"}")
NEW_TOKEN=$(echo "$SWITCH_RESP" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)

# Get new kubeconfig
KC_RESP=$(curl -ksf "$REGION/api/auth/getKubeconfig" \
  -H "Authorization: $NEW_TOKEN")
node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); process.stdout.write(d.data.kubeconfig)" <<< "$KC_RESP" > ~/.sealos/kubeconfig 2>/dev/null \
  || python3 -c "import sys,json; print(json.load(sys.stdin)['data']['kubeconfig'])" <<< "$KC_RESP" > ~/.sealos/kubeconfig
chmod 600 ~/.sealos/kubeconfig

# Update auth.json with new token
REGIONAL_TOKEN="$NEW_TOKEN"
```

**If only one workspace exists**, skip the selection prompt and use it directly.

## Ready

Report to user:

```
Project:
  ✓ <PROJECT.repo_name> (<PROJECT.work_dir>)
  ✓ git: <BRANCH> ← <GITHUB_URL or "local only">
  ✓ README: <one-line summary of what the project does>

Environment:                      (cached / refreshed)
  ✓ Docker <version>
  ✓ git <version>
  ○ Node.js <version>        (or: ✗ Node.js — using AI fallback mode)
  ○ Python <version>          (or: ✗ Python — template validation via AI)
  ✓ kubectl <version>
  ○ gh <version>              (or: ✗ gh CLI — will use Docker Hub for push)

Auth:
  ✓ Sealos Cloud (<region>)
  ✓ Workspace: <ns-id> (<teamName>)
```

Note: Container registry login is NOT checked here. It is only required if Phase 2 finds no existing image and we need to build & push (Phase 4). If `gh` CLI is authenticated, GHCR login happens automatically — no user interaction needed.

Record `ENV` and `PROJECT` for subsequent phases → proceed to `modules/pipeline.md`.
