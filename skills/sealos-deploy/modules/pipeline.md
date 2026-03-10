# Deployment Pipeline

After preflight passes, execute Phase 1–6 in order.

`SKILL_DIR` refers to the directory containing this skill's SKILL.md. Sibling skills are at `<SKILL_DIR>/../`.

Use `ENV` from preflight to choose between script mode (Node.js available) and fallback mode (AI-native).

## Artifact Directory

All pipeline outputs are written under `deploy-out/` in `WORK_DIR`:

```
<WORK_DIR>/deploy-out/
├── context.json                  ← pipeline state (shared across all phases)
├── docker-build/
│   └── build-result.json         ← Phase 4 build metadata
└── template/
    └── <app-name>/
        └── index.yaml            ← Phase 5 Sealos template
```

**Note:** When reading dockerfile-skill modules (analyze.md, generate.md, build-fix.md), they reference `docker-build/` as their default output path. In this pipeline, always write to `deploy-out/docker-build/` instead. Similarly, template output goes to `deploy-out/template/` instead of `template/`.

At the very start of the pipeline (before Phase 1), create the artifact directory and initialize the context file:

```bash
mkdir -p "$WORK_DIR/deploy-out"
```

Write `deploy-out/context.json` with the initial project section:
```json
{
  "version": "1.0",
  "created_at": "<ISO timestamp>",
  "updated_at": "<ISO timestamp>",
  "project": {
    "github_url": "<GITHUB_URL>",
    "work_dir": "<WORK_DIR>",
    "repo_name": "<REPO_NAME>",
    "branch": "<BRANCH or null>",
    "is_git": true
  }
}
```

## Deployment Mode Detection

After preflight, determine whether this is a **first deploy** or an **update** of an existing deployment.

### Step 1: Check for previous deployment state

Read `deploy-out/context.json` in `WORK_DIR`. If it exists and contains a `deployed` key with `app_name`, proceed to Step 2.

If no `deployed` key → proceed to **Step 1.5** (attempt discovery from cluster).

### Step 1.5: Discover existing deployment from cluster (migration)

Projects deployed by an older version of the skill may have no `deployed` section in context.json (or no context.json at all). If `ENV.kubectl` is true and `~/.sealos/kubeconfig` exists, attempt to discover an existing deployment by project name:

```bash
# Derive the namespace from the sealos kubeconfig
NAMESPACE=$(KUBECONFIG=~/.sealos/kubeconfig kubectl --insecure-skip-tls-verify \
  config view --minify -o jsonpath='{.contexts[0].context.namespace}' 2>/dev/null)

# Search for a deployment whose name starts with the repo name
KUBECONFIG=~/.sealos/kubeconfig kubectl --insecure-skip-tls-verify \
  get deploy -n "$NAMESPACE" \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.template.spec.containers[0].image}{"\n"}{end}' 2>/dev/null \
  | grep -i "^$REPO_NAME"
```

**If a match is found** (e.g., `evershop-uvbp0n0n	zhujingyang/evershop:20260309`):

1. Query the full details to reconstruct the `deployed` state:
```bash
# Get the ingress host
KUBECONFIG=~/.sealos/kubeconfig kubectl --insecure-skip-tls-verify \
  get ingress/<app_name> -n "$NAMESPACE" \
  -o jsonpath='{.spec.rules[0].host}' 2>/dev/null
```

2. Present to user for confirmation:
```
Found an existing deployment that appears to match this project:

  App:       evershop-uvbp0n0n
  Image:     zhujingyang/evershop:20260309
  URL:       https://evershop-4ha6b4mh.gzg.sealos.run
  Namespace: ns-qiqovyrm

  Is this the deployment you want to update? (y/n)
```

3. If user confirms → write the reconstructed `deployed` section to `deploy-out/context.json` (create file if needed), then proceed to Step 2.

4. If user says no, or no match found → **DEPLOY mode** (skip to Resume Detection below).

### Step 2: Verify deployment is still running (requires kubectl)

If `ENV.kubectl` is false:
- Inform user: `"Found previous deployment record for {app_name}, but kubectl is not available. Will create a new instance instead."`
- → **DEPLOY mode**

If `ENV.kubectl` is true, query the cluster:
```bash
KUBECONFIG=~/.sealos/kubeconfig kubectl --insecure-skip-tls-verify \
  get deployment/<app_name> -n <namespace> \
  -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null
```

- Command fails (deployment deleted or kubeconfig expired) → **DEPLOY mode** (clear `deployed` from context.json)
- Command returns current image → proceed to Step 3

### Step 3: Ask user

Present the detected state and let the user choose:

```
Detected existing deployment:
  App:   <app_name>
  Image: <current_image>
  URL:   <url>

  1. Update this deployment (rebuild & push new image)
  2. Deploy as a new instance

Default: Update
```

- User picks **Update** → **UPDATE mode** (jump to Update Path below)
- User picks **New instance** → **DEPLOY mode** (rename context.json to context.json.bak)

---

## Resume Detection

**Only applies in DEPLOY mode.** If `deploy-out/context.json` exists but has no `deployed` key (incomplete previous deploy):

1. If exists, read it and report to user:
   `"Found previous deployment context. Completed phases: {list phases with completed_at}."`
2. Ask user: `"Resume from Phase {next incomplete phase}? Or restart from Phase 1?"`
3. If resume → skip completed phases, use saved context values
4. If restart → rename old file to `context.json.bak`, create fresh

---

## Phase 1: Assess

`WORK_DIR`, `GITHUB_URL`, `REPO_NAME`, and README context are already resolved in preflight (Step 2).
Use those directly — no need to re-derive.

### 1.2 Deterministic Scoring

**If Node.js available:**
```bash
node "<SKILL_DIR>/scripts/score-model.mjs" "$WORK_DIR"
```
Output: `{ "score": N, "verdict": "...", "dimensions": {...}, "signals": {...} }`

**If Node.js not available (fallback):**
Perform the scoring yourself by reading project files and applying these rules:

1. Detect language: `package.json` → Node.js, `go.mod` → Go, `requirements.txt` → Python, `pom.xml` → Java, `Cargo.toml` → Rust
2. Detect framework: read dependency files for known frameworks (Next.js, Express, FastAPI, Gin, Spring Boot, etc.)
3. Check HTTP server: does the project listen on a port?
4. Check state: external DB (PostgreSQL/MySQL/MongoDB) vs local state (SQLite)?
5. Check config: `.env.example` exists?
6. Check Docker: `Dockerfile` or `docker-compose.yml` exists?

Score 6 dimensions (0-2 each, max 12). For detailed criteria, read:
`<SKILL_DIR>/../cloud-native-readiness/knowledge/scoring-criteria.md`

**Decision:**
- `score < 4` → STOP. Tell user: "This project scored {N}/12 ({verdict}). Not suitable for containerized deployment because: {dimension_details for 0-score dimensions}."
- `score >= 4` → CONTINUE.

### 1.3 AI Quick Assessment

Based on the score result and your own analysis of the project, assess:

1. Read key files: `README.md`, `package.json`/`go.mod`/`requirements.txt`, `Dockerfile` (if exists)
2. Check: Is this a web service, API, or worker with network interface?
3. Determine: ports, required env vars, database dependencies, special concerns

If the score is borderline (4-6), also read:
- `<SKILL_DIR>/../cloud-native-readiness/knowledge/scoring-criteria.md` — detailed rubrics
- `<SKILL_DIR>/../cloud-native-readiness/knowledge/anti-patterns.md` — disqualifying patterns

**STOP conditions:**
- Desktop/GUI application (Electron without server, Qt, GTK)
- Mobile app without backend
- CLI tool / library / SDK (no network service)
- No identifiable entry point or build system

Record for later phases: `language`, `framework`, `ports`, `env_vars`, `databases`, `has_dockerfile`

**Env var classification** (for Phase 5.5 interactive configuration):
When recording `env_vars`, also classify each one:
- `auto` — can be auto-generated (random secrets, internal URLs, DB connections)
- `required` — user must provide (external API keys, admin email, SMTP, OAuth)
- `optional` — has sensible default, user may customize (log level, feature flags)

Sources for env var detection:
- `.env.example` or `.env.sample` — most reliable source of required env vars
- `docker-compose.yml` `environment:` section
- README sections about configuration/environment
- Source code imports of `process.env.*` or `os.environ[]`

### Checkpoint: assess

Read `deploy-out/context.json`, merge the following into the `assess` key, then write back:

| Field | Source |
|-------|--------|
| `completed_at` | Current ISO timestamp |
| `score` | Score model output `.score` |
| `verdict` | Score model output `.verdict` |
| `language` | Detected language |
| `framework` | Detected framework |
| `ports` | Array of detected ports |
| `databases` | Array of detected database types |
| `has_dockerfile` | Boolean |
| `env_vars` | Dict of `{ name: { class, source, default? } }` |

Also update `updated_at` in the root.

---

## Phase 2: Detect Existing Image

**If Node.js available:**
```bash
# With GitHub URL:
node "<SKILL_DIR>/scripts/detect-image.mjs" "$GITHUB_URL" "$WORK_DIR"
# Local project without GitHub URL:
node "<SKILL_DIR>/scripts/detect-image.mjs" "$WORK_DIR"
```
The script auto-detects GitHub URL from `git remote` if only a directory is given.

Output: `{ "found": true, "image": "...", "tag": "...", ... }` or `{ "found": false }`

**If Node.js not available (fallback — use curl):**

1. Parse owner/repo from `GITHUB_URL` (if empty, try `git -C "$WORK_DIR" remote get-url origin`)
2. If still no GitHub URL, skip Docker Hub / GHCR checks and only scan project files for image references
3. Docker Hub check (try `<owner>/<repo>`, then `<repo>/<repo>` if different):
```bash
curl -sf "https://hub.docker.com/v2/namespaces/<owner>/repositories/<repo>/tags?page_size=10"
# If not found and owner != repo:
curl -sf "https://hub.docker.com/v2/namespaces/<repo>/repositories/<repo>/tags?page_size=10"
```
4. GHCR check:
```bash
TOKEN=$(curl -sf "https://ghcr.io/token?scope=repository:<owner>/<repo>:pull" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
curl -sf -H "Authorization: Bearer $TOKEN" "https://ghcr.io/v2/<owner>/<repo>/tags/list"
```
5. **docker-compose.yml scan** — AI reads `docker-compose.yml` / `docker-compose.yaml` (already in Phase 1 context) and extracts `image:` fields. Exclude infrastructure images (postgres, mysql, redis, mongo, etc.). For each candidate, verify with curl against Docker Hub or GHCR.
6. **CI workflow scan** — AI reads `.github/workflows/*.yml` and extracts `docker push` targets, `images:` fields, and `tags:` references. Verify each candidate.
7. Search `README.md` for `ghcr.io/` references, `docker run/pull` commands, and `hub.docker.com/r/<ns>/<repo>` URLs
8. **Docker Hub search API** (catch-all) — if nothing found above:
```bash
curl -sf "https://hub.docker.com/v2/search/repositories/?query=<repo>&page_size=5"
# For each result, fetch detail and check if full_description mentions github.com/<owner>/<repo>
curl -sf "https://hub.docker.com/v2/repositories/<ns>/<repo>/"
```
9. For any candidate, verify amd64: `docker manifest inspect <image>:<tag>`

Prefer versioned tags (`v1.2.3`) over `latest`.

### Phase 2 Post-Verification (AI)

After Phase 2 produces a result, the AI should cross-validate:

1. **If `source` is `dockerhub` or `ghcr`** (direct owner/repo match) — high confidence, no extra validation needed.
2. **If `source` is `compose`, `ci-workflow`, `dockerhub-readme`, or `dockerhub-search`** — cross-check with project context:
   - Does the README mention this image or its namespace?
   - Does `docker-compose.yml` reference it?
   - Does the Docker Hub repo description link back to this GitHub project?
   - If multiple signals agree → high confidence. If only one signal → note as medium confidence in your assessment.
3. **If `found: false`** — the AI should use its Phase 1 analysis context to attempt one more check: if Phase 1 identified a Docker image name from project docs or code that the script didn't find, try verifying it manually with curl.

### Checkpoint: detect

Read `deploy-out/context.json`, merge the following into the `detect` key, then write back:

| Field | Source |
|-------|--------|
| `completed_at` | Current ISO timestamp |
| `found` | Boolean from script output |
| `image` | Image name (if found) |
| `tag` | Tag (if found) |
| `source` | Detection source: `dockerhub`, `ghcr`, `compose`, `ci-workflow`, `dockerhub-search`, etc. |
| `platforms` | Array of platforms (if found) |
| `confidence` | `high` for direct match, `medium` for indirect |

If found, also set the top-level `image_ref` field to `{image}:{tag}`.

**Decision:**
- Found amd64 image → record `IMAGE_REF = {image}:{tag}`, **skip to Phase 5**
- Not found → continue to Phase 3

---

## Phase 3: Dockerfile

### 3.1 Check Existing Dockerfile

If `WORK_DIR/Dockerfile` exists:
1. Read it and assess quality
2. Reasonable (multi-stage or appropriate for language) → use directly, go to Phase 4
3. Problematic (uses `:latest`, runs as root, missing essential deps) → fix, then Phase 4

### 3.2 Generate Dockerfile

If no Dockerfile exists, generate one.

**Load the appropriate template from the internal dockerfile-skill:**
```
<SKILL_DIR>/../dockerfile-skill/templates/golang.dockerfile
<SKILL_DIR>/../dockerfile-skill/templates/nodejs-express.dockerfile
<SKILL_DIR>/../dockerfile-skill/templates/nodejs-nextjs.dockerfile
<SKILL_DIR>/../dockerfile-skill/templates/python-fastapi.dockerfile
<SKILL_DIR>/../dockerfile-skill/templates/python-django.dockerfile
<SKILL_DIR>/../dockerfile-skill/templates/java-springboot.dockerfile
```

Read the template matching the detected language/framework, then adapt it:
- Replace placeholder ports with detected ports
- Adjust build commands based on actual package manager (npm/yarn/pnpm/bun)
- Add system dependencies if needed
- Set correct entry point

**For detailed analysis guidance, read:**
```
<SKILL_DIR>/../dockerfile-skill/modules/analyze.md    — 17-step analysis process
<SKILL_DIR>/../dockerfile-skill/modules/generate.md   — generation rules and best practices
```

**Key Dockerfile principles:**
- Multi-stage build (builder + runtime)
- Pin base image versions (never `:latest`)
- Run as non-root user (USER 1001)
- Proper `.dockerignore`

Also generate `.dockerignore`:
```
.git
node_modules
__pycache__
.env
.env.local
*.md
.vscode
.idea
deploy-out
```

### Checkpoint: dockerfile

Read `deploy-out/context.json`, merge the following into the `dockerfile` key, then write back:

| Field | Source |
|-------|--------|
| `completed_at` | Current ISO timestamp |
| `skipped` | Boolean — true if skipped (existing image in Phase 2) |
| `reason` | Why skipped (if skipped) |
| `action` | `existing`, `generated`, or `fixed` (if not skipped) |
| `dockerfile_path` | Relative path to Dockerfile (if not skipped) |

---

## Phase 4: Build & Push

### 4.0 Docker Hub Login (lazy — only checked here)

Docker Hub login is deferred to this phase because it's only needed when building.
If Phase 2 found an existing image, this phase is skipped entirely.

```bash
docker info 2>/dev/null | grep "Username:"
```

If not logged in:
1. Ask user for Docker Hub username
2. Guide user to run in their terminal: `docker login -u <username>`
3. Record `DOCKER_HUB_USER`

If user doesn't have a Docker Hub account → guide to https://hub.docker.com/signup

### 4.1 Build & Push

Tag format: `<DOCKER_HUB_USER>/<repo-name>:YYYYMMDD-HHMMSS` (e.g., `zhujingyang/kite:20260304-143022`). The timestamp ensures same-day rebuilds never collide.

**If Node.js available:**
```bash
node "<SKILL_DIR>/scripts/build-push.mjs" "$WORK_DIR" "<DOCKER_HUB_USER>" "<repo-name>"
```
Output: `{ "success": true, "image": "..." }` or `{ "success": false, "error": "..." }`

**If Node.js not available (fallback — run docker directly):**
```bash
TAG=$(date +%Y%m%d-%H%M%S)
IMAGE="<DOCKER_HUB_USER>/<repo-name>:$TAG"
docker buildx build --platform linux/amd64 -t "$IMAGE" --push -f Dockerfile "$WORK_DIR"
```

### 4.2 Error Handling

If build fails:
1. Read the error output
2. Load error patterns from internal skill:
   ```
   <SKILL_DIR>/../dockerfile-skill/knowledge/error-patterns.md
   ```
3. Match the error → apply fix to Dockerfile → retry
4. Also consult if needed:
   ```
   <SKILL_DIR>/../dockerfile-skill/knowledge/system-deps.md
   <SKILL_DIR>/../dockerfile-skill/knowledge/best-practices.md
   ```
5. Max 3 retry attempts
6. If still failing → inform user with the specific error and suggest manual review

### 4.3 Record Result

On success, record `IMAGE_REF` from the build output. The build result file is at `deploy-out/docker-build/build-result.json`.

### Checkpoint: build

Read `deploy-out/context.json`, merge the following into the `build` key, then write back:

| Field | Source |
|-------|--------|
| `completed_at` | Current ISO timestamp |
| `skipped` | Boolean — true if skipped (existing image in Phase 2) |
| `reason` | Why skipped (if skipped) |
| `image` | Full image reference including tag (if built) |
| `build_result` | `deploy-out/docker-build/build-result.json` (if built) |

Also set the top-level `image_ref` field to the built image reference.

---

## Phase 5: Generate Sealos Template

### 5.1 Load Sealos Rules

Read the internal skill's specifications:
```
<SKILL_DIR>/../docker-to-sealos/SKILL.md                       — 7-step workflow + MUST rules
<SKILL_DIR>/../docker-to-sealos/references/sealos-specs.md     — Sealos ordering, labels, conventions
<SKILL_DIR>/../docker-to-sealos/references/conversion-mappings.md — field-level Docker→Sealos mappings
```

If the project uses databases, also read:
```
<SKILL_DIR>/../docker-to-sealos/references/database-templates.md
```

### 5.2 Generate Template

Read `deploy-out/context.json` and use `image_ref`, `assess.ports`, `assess.databases`, and `assess.env_vars` as inputs.

Generate the template at `deploy-out/template/<app-name>/index.yaml` (overrides the default `template/` path from docker-to-sealos skill).

**Public URL detection:**
After generating the base template, check if the app needs its public URL configured:

1. Search source code for common URL config patterns:
   - Env vars: `BASE_URL`, `SITE_URL`, `APP_URL`, `NEXTAUTH_URL`, `PUBLIC_URL`, `EXTERNAL_URL`
   - Config files: `getConfig(.*[Uu]rl`, `homeUrl`, `baseUrl`, `siteUrl` in config patterns
   - Docker Compose env vars referencing `localhost` or placeholder URLs

2. If public URL is needed via env var:
   - Add the appropriate env var to the Deployment with value `https://${{ defaults.app_host }}.${{ SEALOS_CLOUD_DOMAIN }}`

3. If public URL is needed via config file (e.g., node-config):
   - Create a ConfigMap with the minimal config file
   - Add volumeMount and volume to the Deployment
   - Follow ConfigMap MUST rules (labels, naming, ordering before Deployment)

**Critical MUST rules (always apply):**
- `metadata.name`: hardcoded lowercase, no variables
- Image tag: exact version, **never `:latest`**
- PVC requests: `<= 1Gi`
- Container defaults: `cpu: 200m/20m`, `memory: 256Mi/25Mi`
- `imagePullPolicy: IfNotPresent`
- `revisionHistoryLimit: 1`
- `automountServiceAccountToken: false`
- **App CRD** (last resource): only `spec.data.url`, `spec.displayType`, `spec.icon`, `spec.name`, `spec.type` — no other fields (no `menuData`, `nameColor`, `template`, etc.)

### 5.3 Validate

Run validation if Python is available:
```bash
python "<SKILL_DIR>/../docker-to-sealos/scripts/quality_gate.py" 2>/dev/null
```

If Python is not available, validate manually by checking the MUST rules above against the generated YAML.

### Checkpoint: template

Read `deploy-out/context.json`, merge the following into the `template` key, then write back:

| Field | Source |
|-------|--------|
| `completed_at` | Current ISO timestamp |
| `path` | `deploy-out/template/<app-name>/index.yaml` |
| `resources` | Array of K8s resource kinds generated (e.g., `["Deployment", "Service", "Ingress", "App"]`) |
| `databases_provisioned` | Array of database types (e.g., `["postgresql"]`) |

---

## Phase 5.5: Interactive Configuration

After generating the template, guide the user through application configuration before deployment.
This is a **critical** step — most applications need user-specific configuration to function properly.

### 5.5.1 Extract Configuration from Template

Parse the generated template YAML and categorize all environment variables and inputs:

**Category A — Auto-managed (no user action needed):**
- `defaults.*` values: `app_name`, `app_host`, random passwords/keys (`${{ random(N) }}`)
- Database connections via `secretKeyRef`: host, port, username, password from Kubeblocks secrets
- Object storage credentials via `secretKeyRef`
- Composed URLs that reference auto-managed vars (e.g., `DATABASE_URL` built from `$(DB_HOST):$(DB_PORT)`)
- Internal service FQDNs (`*.${{ SEALOS_NAMESPACE }}.svc.cluster.local`)

**Category B — User-required inputs:**
- Template `inputs` with `required: true` and no sensible default
- Env vars with empty or placeholder values that the app cannot function without
- Common examples: admin email, external API keys (OpenAI, SMTP credentials, OAuth client ID/secret)

**Category C — Optional with defaults:**
- Template `inputs` with `required: false` and reasonable defaults
- Env vars user might want to customize but app works without changes
- Common examples: log level, feature toggles, upload size limits, signup enabled/disabled

**Category D — Fixed values (informational):**
- Hardcoded env vars like `NODE_ENV=production`
- Port numbers, internal paths

### 5.5.2 Present Configuration Summary

Display a structured summary to the user. Example:

```
Configuration for <app-name>:

  Auto-configured (no action needed):
    - APP_NAME: unique generated name
    - DB credentials: from PostgreSQL service (auto-provisioned)
    - SECRET_KEY: auto-generated 32-char random string
    - REDIS_URL: auto-composed from service credentials

  Requires your input:
    1. ADMIN_EMAIL — Administrator email address (required)
    2. OPENAI_API_KEY — OpenAI API key for AI features (required)
    3. SMTP_HOST — SMTP server for sending emails (required if email needed)

  Optional (defaults shown, customize if needed):
    - LOG_LEVEL: "info"
    - MAX_UPLOAD_SIZE: "10M"
    - ENABLE_SIGNUP: "true"
```

### 5.5.3 Collect User Input

**For required inputs:**
1. Ask the user for each value
2. If user doesn't have a value, explain what it's used for and how to obtain it
   - Example: "OPENAI_API_KEY is needed for AI features. Get one at https://platform.openai.com/api-keys"
3. If user wants to skip a feature-gating input (e.g., SMTP), explain which features will be unavailable and set an empty value

**For optional inputs:**
1. Show the default values
2. Ask: "Do you want to change any of these? (press Enter to keep defaults)"
3. Only update values the user explicitly wants to change

**For unfamiliar env vars:**
If the AI is unsure what a variable does, read the project README, `.env.example`, or source code to explain it to the user before asking for a value.

### 5.5.4 Apply Configuration to Template

Update the template's `inputs` section with user-provided values:

```yaml
# Before (generated)
inputs:
  ADMIN_EMAIL:
    description: 'Administrator email address'
    type: string
    default: ''
    required: true

# After (user configured)
inputs:
  ADMIN_EMAIL:
    description: 'Administrator email address'
    type: string
    default: 'admin@example.com'
    required: true
```

Write the updated template back to `deploy-out/template/<app-name>/index.yaml`.

Record all user choices as `CONFIG` for use in Phase 6:
```
CONFIG.args = { ADMIN_EMAIL: "admin@example.com", OPENAI_API_KEY: "sk-..." }
```
These `args` will be passed to the Template API's `args` field (Phase 6.2), which overrides or supplies `spec.inputs` in the template.

### 5.5.5 Deployment Confirmation

Before proceeding to Phase 6, present a final summary and ask for confirmation:

```
Ready to deploy <app-name> to Sealos Cloud:

  Image:    zhujingyang/app:20260309
  Region:   https://cloud.sealos.io
  Database: PostgreSQL 16 (auto-provisioned)
  Config:   3 required inputs configured, 2 optional defaults kept

  Proceed with deployment? (y/n)
```

Wait for user confirmation before continuing to Phase 6.

### Checkpoint: config

Read `deploy-out/context.json`, merge the following into the `config` key, then write back:

| Field | Source |
|-------|--------|
| `completed_at` | Current ISO timestamp |
| `auto_managed` | Array of auto-configured env var names |
| `user_provided` | Dict of user-provided values `{ name: value }` |
| `defaults_kept` | Dict of optional values kept at defaults `{ name: default_value }` |

---

## Phase 6: Deploy to Sealos Cloud

### 6.1 Construct Deploy URL

The template deploy API uses a fixed `template.` subdomain prefix on the region domain:

```
Region:     https://<region-domain>
Deploy URL: https://template.<region-domain>/api/v2alpha/templates/raw
```

Extract the region from `~/.sealos/auth.json` (saved during preflight auth):
```bash
REGION=$(cat ~/.sealos/auth.json | grep -o '"region":"[^"]*"' | cut -d'"' -f4)
REGION_DOMAIN=$(echo "$REGION" | sed 's|https://||')
DEPLOY_URL="https://template.${REGION_DOMAIN}/api/v2alpha/templates/raw"
```

### 6.2 Deploy Template

Read kubeconfig, **encode it with `encodeURIComponent`**, and send as `Authorization` header.

Request body fields:
- `yaml` (required) — the full template YAML string
- `args` (optional) — template variable key-value pairs that override or supply `spec.inputs` fields. Values from Phase 5.5 `CONFIG.args`.
- `dryRun` (optional, boolean) — if true, validates resources against K8s API without creating anything. Returns 200 with preview.

**With Node.js:**
```bash
node -e "
const fs = require('fs');
const os = require('os');
const kc = fs.readFileSync(os.homedir() + '/.sealos/kubeconfig', 'utf-8');
const yaml = fs.readFileSync('deploy-out/template/<app-name>/index.yaml', 'utf-8');
// CONFIG.args from Phase 5.5
const args = { ADMIN_EMAIL: 'user@example.com' };
fetch('$DEPLOY_URL', {
  method: 'POST',
  headers: {
    'Authorization': encodeURIComponent(kc),
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ yaml, args })
})
.then(r => { console.log('Status:', r.status); return r.json(); })
.then(d => console.log(JSON.stringify(d, null, 2)))
.catch(e => console.error(e));
"
```

**Without Node.js (curl fallback):**
```bash
# encodeURIComponent via Python (almost always available)
KUBECONFIG_ENCODED=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.stdin.read(), safe=''))" < ~/.sealos/kubeconfig)

# Build JSON body with args — use jq if available
TEMPLATE_YAML=$(cat deploy-out/template/<app-name>/index.yaml)
jq -n --arg yaml "$TEMPLATE_YAML" \
  --argjson args '{"ADMIN_EMAIL":"user@example.com"}' \
  '{yaml: $yaml, args: $args}' | \
  curl -sf -X POST "$DEPLOY_URL" \
    -H "Authorization: $KUBECONFIG_ENCODED" \
    -H "Content-Type: application/json" \
    -d @-
```

**Without jq:**
The AI should read the template YAML (already in context), construct the JSON body directly, write it to a temp file, and curl it:
```bash
# AI writes properly escaped JSON to temp file including args from Phase 5.5
cat > /tmp/sealos-deploy-body.json << 'DEPLOY_EOF'
{"yaml": "<AI inserts JSON-escaped template YAML here>", "args": {"ADMIN_EMAIL": "user@example.com"}}
DEPLOY_EOF

curl -sf -X POST "$DEPLOY_URL" \
  -H "Authorization: $KUBECONFIG_ENCODED" \
  -H "Content-Type: application/json" \
  -d @/tmp/sealos-deploy-body.json

rm -f /tmp/sealos-deploy-body.json
```

### 6.3 Handle Response

All error responses use a unified format:
```json
{ "error": { "type": "...", "code": "...", "message": "...", "details": ... } }
```

| Status | Meaning | Action |
|--------|---------|--------|
| 201 | Deployed successfully | Extract instance name and resources from response |
| 200 | Dry-run preview (`dryRun: true`) | Show resource preview and quota |
| 400 | Validation error — `INVALID_PARAMETER` (missing yaml/name) or `INVALID_VALUE` (bad YAML, missing required args) | Read `error.message`, fix template or provide missing `args`, retry |
| 401 | `AUTHENTICATION_REQUIRED` — missing or invalid kubeconfig | Re-run auth: `node sealos-auth.mjs login` |
| 403 | `FORBIDDEN` — insufficient permissions | Inform user, check kubeconfig namespace permissions |
| 409 | `ALREADY_EXISTS` — instance already exists | Inform user, suggest different app name |
| 422 | `RESOURCE_ERROR` — K8s rejected resource spec | Read `error.details` for K8s rejection reason, fix template |
| 503 | `SERVICE_UNAVAILABLE` — K8s cluster unreachable | **Fall back to kubectl (6.4)** |

On 201 success, the response contains:
```json
{
  "name": "myapp-abcdefgh",
  "uid": "...",
  "resourceType": "instance",
  "displayName": "...",
  "createdAt": "...",
  "args": { ... },
  "resources": [
    { "name": "myapp-abcdefgh", "uid": "...", "resourceType": "deployment", "quota": { "cpu": 0.1, "memory": 0.25, "storage": 0, "replicas": 1 } }
  ]
}
```
Extract the instance name and present to user.

### 6.4 Fallback: kubectl apply (when Template API is unavailable)

If the Template API returns 503/500 or is unreachable, deploy directly via kubectl using the local kubeconfig.

**Step 1 — Gather cluster context:**
```bash
# User namespace
NAMESPACE=$(KUBECONFIG=~/.sealos/kubeconfig kubectl --insecure-skip-tls-verify config view --minify -o jsonpath='{.contexts[0].context.namespace}')

# Cluster domain (from region URL)
CLOUD_DOMAIN=$(cat ~/.sealos/auth.json | grep -o '"region":"[^"]*"' | cut -d'"' -f4 | sed 's|https://||')

# TLS secret name (from existing ingress, or default)
CERT_SECRET=$(KUBECONFIG=~/.sealos/kubeconfig kubectl --insecure-skip-tls-verify get ingress -n "$NAMESPACE" -o jsonpath='{.items[0].spec.tls[0].secretName}' 2>/dev/null || echo "wildcard-cert")
```

**Step 2 — Render template variables:**

The template YAML from Phase 5 contains `${{ }}` variables. The AI must replace them with actual values:

| Variable | Value |
|----------|-------|
| `${{ defaults.app_name }}` | Generate: `<app>-<random8>` (e.g., `edict-xn22k4ie`) |
| `${{ defaults.app_host }}` | Generate: `<app>-<random8>` (e.g., `edict-2v4jryz1`) |
| `${{ defaults.<key> }}` | Other defaults: generate per their `value` pattern |
| `${{ inputs.<key> }}` | User-provided values from Phase 5.5 `CONFIG.args` |
| `${{ random(N) }}` | Random alphanumeric string of length N |
| `${{ SEALOS_CLOUD_DOMAIN }}` | `CLOUD_DOMAIN` from Step 1 |
| `${{ SEALOS_CERT_SECRET_NAME }}` | `CERT_SECRET` from Step 1 |
| `${{ SEALOS_NAMESPACE }}` | `NAMESPACE` from Step 1 |

**Important:** `${{ inputs.xxx }}` values come from the user in Phase 5.5. If any required input was not provided, the AI must ask the user now before proceeding.

The AI reads the template YAML, performs all variable substitutions, and produces rendered K8s resource documents.

**Step 3 — Split and apply:**

The rendered YAML is a multi-document file (separated by `---`). Split it into individual resources:

1. **Skip** the first document (`kind: Template`) — this is the Sealos template metadata, not a K8s resource
2. **Apply** the remaining documents (Deployment, Service, Ingress, App, etc.) via kubectl:

```bash
# AI writes the rendered resources (without the Template CR) to a temp file
cat > /tmp/sealos-deploy-rendered.yaml << 'EOF'
<rendered Deployment + Service + Ingress + App YAML>
EOF

KUBECONFIG=~/.sealos/kubeconfig kubectl --insecure-skip-tls-verify apply -f /tmp/sealos-deploy-rendered.yaml -n "$NAMESPACE"
rm -f /tmp/sealos-deploy-rendered.yaml
```

**Step 4 — Handle apply errors:**

| Error | Fix |
|-------|-----|
| `unknown field "spec.xxx"` in App CR | Remove the unknown field and retry |
| PodSecurity warnings | Warnings are non-blocking — deployment still proceeds |
| `Forbidden` | Kubeconfig may be expired — re-run auth |
| `already exists` | Resource exists from a previous deploy — use `kubectl apply` (idempotent) |

**Step 5 — Verify deployment:**
```bash
# Wait for pod to be ready (max 120s)
KUBECONFIG=~/.sealos/kubeconfig kubectl --insecure-skip-tls-verify \
  wait --for=condition=available deployment/<app-name> -n "$NAMESPACE" --timeout=120s

# Get pod status
KUBECONFIG=~/.sealos/kubeconfig kubectl --insecure-skip-tls-verify \
  get pods -l app=<app-name> -n "$NAMESPACE"
```

App URL: `https://<app_host>.<CLOUD_DOMAIN>`

### Checkpoint: deploy

Read `deploy-out/context.json`, merge the following into the `deploy` key, then write back:

| Field | Source |
|-------|--------|
| `completed_at` | Current ISO timestamp |
| `method` | `template-api` or `kubectl-apply` |
| `instance` | Instance/app name in cluster |
| `namespace` | K8s namespace |
| `url` | Public app URL |
| `region` | Sealos region URL |

### Checkpoint: deployed (top-level)

**This is critical for enabling future updates.** After a successful deploy, also write a top-level `deployed` key to `deploy-out/context.json`:

```json
{
  "deployed": {
    "app_name": "<instance name, e.g. evershop-uvbp0n0n>",
    "app_host": "<ingress host prefix, e.g. evershop-4ha6b4mh>",
    "namespace": "<K8s namespace from kubeconfig>",
    "region": "<Sealos region domain, e.g. gzg.sealos.run>",
    "current_image": "<IMAGE_REF used in this deploy>",
    "docker_hub_user": "<DOCKER_HUB_USER, or null if existing image was used>",
    "repo_name": "<REPO_NAME>",
    "url": "<public app URL>",
    "deployed_at": "<current ISO timestamp>",
    "last_updated_at": "<current ISO timestamp>",
    "update_history": [
      {
        "timestamp": "<current ISO timestamp>",
        "action": "deploy",
        "image": "<IMAGE_REF>",
        "method": "<template-api or kubectl-apply>",
        "status": "success",
        "note": "Initial deployment"
      }
    ]
  }
}
```

The `deployed` section is what **Deployment Mode Detection** reads on subsequent runs to decide between DEPLOY and UPDATE mode. Without it, every `/sealos-deploy` creates a new instance.

The `update_history` array is append-only — every subsequent update (via Update Path) adds an entry. See the **Update History** section at the end of this file for the full schema and rules.

Sources for each field:
- `app_name`: from `deploy.instance` (Template API response) or the rendered `defaults.app_name` (kubectl apply)
- `app_host`: from the rendered `defaults.app_host` value, or parsed from the Ingress host
- `namespace`: from kubeconfig context or `deploy.namespace`
- `region`: from `~/.sealos/auth.json` `region` field (strip `https://`)
- `current_image`: from `image_ref` (top-level context field)
- `docker_hub_user`: from Phase 4 `DOCKER_HUB_USER` (null if Phase 2 found existing image)
- `repo_name`: from `PROJECT.repo_name`
- `url`: from `deploy.url`

---

## Cleanup

If `WORK_DIR` was created via `mktemp` (remote GitHub URL clone), remove it:
```bash
rm -rf "$WORK_DIR"
```

Do NOT clean up if `WORK_DIR` is the user's local project directory.

---

## Output

On success, present to user:

```
✓ Assessed: {language} + {framework}, score {N}/12 — {verdict}
✓ Image: {IMAGE_REF} ({source: existing/built})
✓ Template: deploy-out/template/{app-name}/index.yaml
✓ Configured: {N} inputs set ({M} required, {K} optional)
✓ Deployed to Sealos Cloud ({region})

App URL: https://<app-access-url>
```

If any `inputs` were configured, also show:
```
Configuration applied:
  ADMIN_EMAIL: admin@example.com
  OPENAI_API_KEY: sk-***...*** (masked)
```
Mask sensitive values (API keys, passwords) — show only first 3 and last 3 characters.

---
---

# Update Path

**This section is only executed in UPDATE mode** (entered via Deployment Mode Detection above).

The update path skips Assess, Detect Image, Dockerfile, and Template generation — it reuses the existing deployment and only pushes a new image.

All kubectl commands use the Sealos kubeconfig:
```
KUBECONFIG=~/.sealos/kubeconfig kubectl --insecure-skip-tls-verify
```

### kubectl Safety Rules (MUST follow)

The Sealos kubeconfig has **real cluster permissions**. Destructive operations can permanently lose user data and running services.

**Allowed operations — read and in-place update only:**
- `kubectl get` — read resources
- `kubectl set image` — update container image
- `kubectl patch` — update specific fields
- `kubectl rollout status` — watch rollout progress
- `kubectl rollout undo` — revert to previous revision (only on failed rollout)
- `kubectl rollout restart` — restart pods with same config
- `kubectl logs` — read pod logs for debugging

**NEVER run these — no exceptions:**
- `kubectl delete` — never delete deployments, services, ingresses, PVCs, databases, or any resource
- `kubectl replace` — can overwrite resources and lose fields
- `kubectl scale ... --replicas=0` — equivalent to taking the app offline
- `kubectl edit` — opens interactive editor, not suitable for automation
- `kubectl apply` with incomplete YAML — can remove fields that were previously set

If a situation seems to require deleting or replacing a resource, **stop and ask the user** rather than proceeding.

## Context from Mode Detection

These values are already known from `deploy-out/context.json` `deployed` section:

```
APP_NAME      = deployed.app_name       (e.g., "evershop-uvbp0n0n")
NAMESPACE     = deployed.namespace      (e.g., "ns-qiqovyrm")
REGION        = deployed.region         (e.g., "gzg.sealos.run")
CURRENT_IMAGE = deployed.current_image  (e.g., "zhujingyang/evershop:20260309")
DOCKER_HUB_USER = deployed.docker_hub_user
REPO_NAME     = deployed.repo_name
APP_URL       = deployed.url
```

---

## Phase U1: Build & Push

Ask the user what changed:

```
What would you like to update?

  1. Code changed — rebuild and push new image (default)
  2. Just restart the current deployment (no rebuild)
```

### Option 1: Rebuild

Reuse the **exact same build logic as Phase 4** — same Dockerfile, same build-push.mjs or fallback.

```bash
# With Node.js:
node "<SKILL_DIR>/scripts/build-push.mjs" "$WORK_DIR" "$DOCKER_HUB_USER" "$REPO_NAME"

# Without Node.js:
TAG=$(date +%Y%m%d-%H%M%S)
NEW_IMAGE="$DOCKER_HUB_USER/$REPO_NAME:$TAG"
docker buildx build --platform linux/amd64 -t "$NEW_IMAGE" --push -f Dockerfile "$WORK_DIR"
```

Record `NEW_IMAGE` from the output.

If build fails → same error handling as Phase 4.2 (read error-patterns.md, fix Dockerfile, retry up to 3 times).

### Option 2: Restart only

No build needed. Use the current image:
```
NEW_IMAGE = CURRENT_IMAGE
```

Will trigger a rollout restart in Phase U2.

---

## Phase U2: Apply Update

### Image update (Option 1 — new image built):

```bash
KUBECONFIG=~/.sealos/kubeconfig kubectl --insecure-skip-tls-verify \
  set image deployment/$APP_NAME \
  $APP_NAME=$NEW_IMAGE \
  -n $NAMESPACE
```

### Restart only (Option 2 — no new image):

```bash
KUBECONFIG=~/.sealos/kubeconfig kubectl --insecure-skip-tls-verify \
  rollout restart deployment/$APP_NAME \
  -n $NAMESPACE
```

---

## Phase U3: Verify Rollout

### Wait for new pods to be ready:

```bash
KUBECONFIG=~/.sealos/kubeconfig kubectl --insecure-skip-tls-verify \
  rollout status deployment/$APP_NAME \
  -n $NAMESPACE --timeout=120s
```

### On success:

Update `deploy-out/context.json`:
- Set `deployed.current_image` to `NEW_IMAGE`
- Set `deployed.last_updated_at` to current ISO timestamp
- Append an entry to `deployed.update_history` (see Update History below)

Present to user:
```
✓ Updated: <APP_NAME>
✓ Image: <CURRENT_IMAGE> → <NEW_IMAGE>
✓ Rollout: complete

App URL: <APP_URL>
```

### On failure:

Auto-rollback:
```bash
KUBECONFIG=~/.sealos/kubeconfig kubectl --insecure-skip-tls-verify \
  rollout undo deployment/$APP_NAME \
  -n $NAMESPACE
```

Append a **failed** entry to `deployed.update_history` (see Update History below).

Report to user:
```
✗ Rollout failed — automatically rolled back to previous version.

Debug:
  kubectl logs deployment/<APP_NAME> -n <NAMESPACE> --tail=50
```

Do NOT update `deployed.current_image` on failure — it stays at the old value.

---

## Update History

Every update (successful or failed) appends an entry to `deployed.update_history` in `deploy-out/context.json`. This provides a traceable log of all changes to the deployment.

```json
{
  "deployed": {
    "app_name": "morphic-dc21ad72",
    "current_image": "zhujingyang/morphic:20260310-143022",
    "update_history": [
      {
        "timestamp": "2026-03-09T18:37:30Z",
        "action": "deploy",
        "image": "ghcr.io/miurla/morphic:668daf0e",
        "method": "kubectl-apply",
        "status": "success",
        "note": "Initial deployment"
      },
      {
        "timestamp": "2026-03-09T20:15:00Z",
        "action": "set-env",
        "changes": ["OPENAI_API_KEY=sk-***", "OPENAI_BASE_URL=https://..."],
        "method": "kubectl-set-env",
        "status": "success",
        "note": "Fix: default openai provider not enabled"
      },
      {
        "timestamp": "2026-03-10T14:30:22Z",
        "action": "set-image",
        "previous_image": "ghcr.io/miurla/morphic:668daf0e",
        "image": "zhujingyang/morphic:20260310-143022",
        "method": "kubectl-set-image",
        "status": "success"
      },
      {
        "timestamp": "2026-03-11T09:00:00Z",
        "action": "set-image",
        "previous_image": "zhujingyang/morphic:20260310-143022",
        "image": "zhujingyang/morphic:20260311-090000",
        "method": "kubectl-set-image",
        "status": "failed",
        "note": "CrashLoopBackOff — rolled back"
      }
    ]
  }
}
```

### History entry fields

| Field | Required | Description |
|-------|----------|-------------|
| `timestamp` | yes | ISO 8601 timestamp of the operation |
| `action` | yes | What changed: `deploy`, `set-image`, `set-env`, `patch`, `restart` |
| `status` | yes | `success` or `failed` |
| `method` | yes | kubectl command used: `kubectl-apply`, `kubectl-set-image`, `kubectl-set-env`, `kubectl-patch`, `kubectl-rollout-restart` |
| `image` | if image changed | New image reference |
| `previous_image` | if image changed | Image before the update |
| `changes` | if env/config changed | Array of changes (mask sensitive values: `sk-***`) |
| `note` | no | Free-text reason or context for the change |

### Rules

- **Always append, never rewrite** — history is append-only. Never delete or modify previous entries.
- **Mask secrets** — API keys, passwords, tokens: show only first 3 chars + `***` (e.g., `sk-***`).
- **Initial deploy counts** — the first entry should be `action: "deploy"` written by Phase 6 checkpoint.
- **Failed updates count** — record failures so the user can see what was attempted and why it didn't work.
- **Keep it bounded** — if history exceeds 50 entries, trim the oldest entries (keep the first `deploy` entry and the most recent 49).
