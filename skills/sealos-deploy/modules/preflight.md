# Phase 0: Preflight

Detect the user's environment, record what's available, guide them to fix what's missing.

## Step 1: Environment Detection

Run all checks and record results:

```bash
# Required
docker --version 2>/dev/null
git --version 2>/dev/null

# Optional (enables script acceleration)
node --version 2>/dev/null
python3 --version 2>/dev/null

# Always available (system built-in)
curl --version 2>/dev/null | head -1
which jq 2>/dev/null
```

Record the result as `ENV`:
```
ENV.docker    = true/false
ENV.git       = true/false
ENV.node      = true/false   (18+ required)
ENV.python    = true/false
ENV.curl      = true/false
ENV.jq        = true/false
```

### Required — cannot proceed without these

**Docker:**
- Not installed → guide by platform:
  - macOS: `brew install --cask docker` then open Docker Desktop
  - Linux: `curl -fsSL https://get.docker.com | sh`
- Installed but daemon not running (`docker info` fails) → "Please start Docker Desktop (macOS) or `sudo systemctl start docker` (Linux)."

**git:**
- Not installed → `brew install git` (macOS) or `sudo apt install git` (Linux)

### Optional — scripts run faster, but AI can do the same work

**Node.js:**
- If missing, no problem. Pipeline uses fallback mode:
  - `score-model.mjs` → AI reads files and applies scoring rules directly
  - `detect-image.mjs` → AI runs curl commands for Docker Hub / GHCR API
  - `build-push.mjs` → AI runs `docker buildx` commands directly
  - `sealos-auth.mjs` → AI runs curl to exchange token for kubeconfig

**Python:**
- If missing, Sealos template validation (Phase 5) uses AI self-check instead of `quality_gate.py`

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

### Check auth status:

**With Node.js:**
```bash
node "<SKILL_DIR>/scripts/sealos-auth.mjs" check
```
Returns: `{ "authenticated": true/false, "kubeconfig_path": "..." }`

**Without Node.js:**
```bash
test -f ~/.sealos/kubeconfig && echo '{"authenticated":true}' || echo '{"authenticated":false}'
```

### If not authenticated — Device Grant Login:

**With Node.js (recommended):**
```bash
node "<SKILL_DIR>/scripts/sealos-auth.mjs" login [region-url]
```

The script will:
1. `POST <region>/api/auth/oauth2/device` with `client_id=sealos-deploy`
2. Output a verification URL and user code to stderr
3. Auto-open the browser for the user
4. Poll `POST <region>/api/auth/oauth2/token` every 5s until approved
5. Exchange the access token for kubeconfig
6. Save to `~/.sealos/kubeconfig` (mode 0600)

**Important — AI must always show the clickable URL to the user:**
Even though the script attempts to auto-open the browser, it may fail (e.g., headless environment, SSH session, sandbox restrictions).
After running the script, YOU (the AI) must extract the verification URL from stderr output and display it as a clickable link to the user:
```
Please click the link below to authorize:
<verification_uri_complete>
Authorization code: <user_code>
```
This ensures the user can always complete authorization regardless of whether auto-open succeeded.

Stdout outputs JSON result: `{ "kubeconfig_path": "...", "region": "..." }`

**Without Node.js (curl fallback):**

Step 1 — Request device authorization:
```bash
REGION="${REGION:-https://192.168.12.53.nip.io}"
# -k: skip TLS verification (dev environment uses self-signed cert)
DEVICE_RESP=$(curl -ksf -X POST "$REGION/api/auth/oauth2/device" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=sealos-deploy&grant_type=urn:ietf:params:oauth:grant-type:device_code")
```

Extract fields from response:
```bash
DEVICE_CODE=$(echo "$DEVICE_RESP" | grep -o '"device_code":"[^"]*"' | cut -d'"' -f4)
USER_CODE=$(echo "$DEVICE_RESP" | grep -o '"user_code":"[^"]*"' | cut -d'"' -f4)
VERIFY_URL=$(echo "$DEVICE_RESP" | grep -o '"verification_uri_complete":"[^"]*"' | cut -d'"' -f4)
INTERVAL=$(echo "$DEVICE_RESP" | grep -o '"interval":[0-9]*' | cut -d: -f2)
INTERVAL=${INTERVAL:-5}
```

Step 2 — Tell user to open browser:
```
Please open: $VERIFY_URL
Authorization code: $USER_CODE
```

Step 3 — Poll for token:
```bash
while true; do
  sleep "$INTERVAL"
  TOKEN_RESP=$(curl -sf -X POST "$REGION/api/auth/oauth2/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "client_id=sealos-deploy&grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=$DEVICE_CODE")

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

Step 4 — Exchange token for kubeconfig:
```bash
KC_RESP=$(curl -sf -X POST "$REGION/api/auth/getDefaultKubeconfig" \
  -H "Authorization: $ACCESS_TOKEN" \
  -H "Content-Type: application/json")
# Server returns { data: { kubeconfig } }
mkdir -p ~/.sealos
echo "$KC_RESP" | grep -o '"kubeconfig":"[^"]*"' | cut -d'"' -f4 > ~/.sealos/kubeconfig
chmod 600 ~/.sealos/kubeconfig
```

## Ready

Report to user:

```
Project:
  ✓ <PROJECT.repo_name> (<PROJECT.work_dir>)
  ✓ git: <BRANCH> ← <GITHUB_URL or "local only">
  ✓ README: <one-line summary of what the project does>

Environment:
  ✓ Docker <version>
  ✓ git <version>
  ○ Node.js <version>        (or: ✗ Node.js — using AI fallback mode)
  ○ Python <version>          (or: ✗ Python — template validation via AI)

Auth:
  ✓ Sealos Cloud (<region>)
```

Note: Docker Hub login is NOT checked here. It is only required if Phase 2 finds no existing image and we need to build & push (Phase 4).

Record `ENV` and `PROJECT` for subsequent phases → proceed to `modules/pipeline.md`.
