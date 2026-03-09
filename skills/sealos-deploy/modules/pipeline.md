# Deployment Pipeline

After preflight passes, execute Phase 1–5 in order.

`SKILL_DIR` refers to the directory containing this skill's SKILL.md. Sibling skills are at `<SKILL_DIR>/../`.

Use `ENV` from preflight to choose between script mode (Node.js available) and fallback mode (AI-native).

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
2. If still no GitHub URL, skip Docker Hub / GHCR checks and only scan README for image references
3. Docker Hub check:
```bash
curl -sf "https://hub.docker.com/v2/namespaces/<owner>/repositories/<repo>/tags?page_size=10"
```
3. GHCR check:
```bash
TOKEN=$(curl -sf "https://ghcr.io/token?scope=repository:<owner>/<repo>:pull" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
curl -sf -H "Authorization: Bearer $TOKEN" "https://ghcr.io/v2/<owner>/<repo>/tags/list"
```
4. If neither found, search `README.md` for `ghcr.io/` or `docker run/pull` references with different owner
5. For any candidate, verify amd64: `docker manifest inspect <image>:<tag>`

Prefer versioned tags (`v1.2.3`) over `latest`.

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
```

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

Tag format: `<DOCKER_HUB_USER>/<repo-name>:YYYYMMDD` (e.g., `zhujingyang/kite:20260304`).

**If Node.js available:**
```bash
node "<SKILL_DIR>/scripts/build-push.mjs" "$WORK_DIR" "<DOCKER_HUB_USER>" "<repo-name>"
```
Output: `{ "success": true, "image": "..." }` or `{ "success": false, "error": "..." }`

**If Node.js not available (fallback — run docker directly):**
```bash
TAG=$(date +%Y%m%d)
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

On success, record `IMAGE_REF` from the build output.

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

Using `IMAGE_REF`, detected ports, env vars, and the Sealos rules, generate `template/<app-name>/index.yaml`.

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

Write the updated template back to `template/<app-name>/index.yaml`.

Record all user choices as `CONFIG` for use in Phase 6:
```
CONFIG.inputs = { ADMIN_EMAIL: "admin@example.com", OPENAI_API_KEY: "sk-..." }
CONFIG.defaults_overrides = {}  (if user wanted to change any defaults)
```

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

---

## Phase 6: Deploy to Sealos Cloud

### 6.1 Construct Deploy URL

The template deploy API uses a fixed `template.` subdomain prefix on the region domain:

```
Region:     https://<region-domain>
Deploy URL: https://template.<region-domain>/api/v2alpha/templates
```

Extract the region from `~/.sealos/auth.json` (saved during preflight auth):
```bash
REGION=$(cat ~/.sealos/auth.json | grep -o '"region":"[^"]*"' | cut -d'"' -f4)
REGION_DOMAIN=$(echo "$REGION" | sed 's|https://||')
DEPLOY_URL="https://template.${REGION_DOMAIN}/api/v2alpha/templates"
```

### 6.2 Deploy Template

Read kubeconfig, **encode it with `encodeURIComponent`**, and send as `Authorization` header.

Request body needs:
- `yaml` — the full template YAML string
- `inputs` — user-provided input values from Phase 5.5 (key-value object)

The `inputs` field passes user configuration so the template engine can substitute `${{ inputs.xxx }}` variables.

**With Node.js:**
```bash
node -e "
const fs = require('fs');
const os = require('os');
const kc = fs.readFileSync(os.homedir() + '/.sealos/kubeconfig', 'utf-8');
const yaml = fs.readFileSync('template/<app-name>/index.yaml', 'utf-8');
// CONFIG.inputs from Phase 5.5
const inputs = { ADMIN_EMAIL: 'user@example.com' };
fetch('$DEPLOY_URL', {
  method: 'POST',
  headers: {
    'Authorization': encodeURIComponent(kc),
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ yaml, inputs })
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

# Build JSON body with inputs — use jq if available
TEMPLATE_YAML=$(cat template/<app-name>/index.yaml)
jq -n --arg yaml "$TEMPLATE_YAML" \
  --argjson inputs '{"ADMIN_EMAIL":"user@example.com"}' \
  '{yaml: $yaml, inputs: $inputs}' | \
  curl -sf -X POST "$DEPLOY_URL" \
    -H "Authorization: $KUBECONFIG_ENCODED" \
    -H "Content-Type: application/json" \
    -d @-
```

**Without jq:**
The AI should read the template YAML (already in context), construct the JSON body directly, write it to a temp file, and curl it:
```bash
# AI writes properly escaped JSON to temp file including inputs from Phase 5.5
cat > /tmp/sealos-deploy-body.json << 'DEPLOY_EOF'
{"yaml": "<AI inserts JSON-escaped template YAML here>", "inputs": {"ADMIN_EMAIL": "user@example.com"}}
DEPLOY_EOF

curl -sf -X POST "$DEPLOY_URL" \
  -H "Authorization: $KUBECONFIG_ENCODED" \
  -H "Content-Type: application/json" \
  -d @/tmp/sealos-deploy-body.json

rm -f /tmp/sealos-deploy-body.json
```

### 6.3 Handle Response

| Status | Meaning | Action |
|--------|---------|--------|
| 201 | Deployed successfully | Report success to user |
| 200 | Dry-run preview (dryRun: true) | Show preview |
| 400 | Bad request — invalid YAML | Fix template and retry |
| 401 | Unauthorized — invalid kubeconfig | Re-run auth: `node sealos-auth.mjs login` |
| 409 | Conflict — instance already exists | Inform user, suggest different app name |
| 422 | K8s rejected resource spec | Fix template based on error details |
| 500/503 | Template service unavailable | **Fall back to kubectl (6.4)** |

On 201 success, extract the app access URL from the response and present to user.

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
| `${{ inputs.<key> }}` | User-provided values from Phase 5.5 `CONFIG.inputs` |
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
✓ Template: template/{app-name}/index.yaml
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
