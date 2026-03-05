# Deployment Pipeline

After preflight passes, execute Phase 1–5 in order.

`SKILL_DIR` refers to the directory containing this skill's SKILL.md (e.g., `~/.claude/skills/sealos-deploy`).

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
`~/.claude/skills/cloud-native-readiness/knowledge/scoring-criteria.md`

**Decision:**
- `score < 4` → STOP. Tell user: "This project scored {N}/12 ({verdict}). Not suitable for containerized deployment because: {dimension_details for 0-score dimensions}."
- `score >= 4` → CONTINUE.

### 1.3 AI Quick Assessment

Based on the score result and your own analysis of the project, assess:

1. Read key files: `README.md`, `package.json`/`go.mod`/`requirements.txt`, `Dockerfile` (if exists)
2. Check: Is this a web service, API, or worker with network interface?
3. Determine: ports, required env vars, database dependencies, special concerns

If the score is borderline (4-6), also read:
- `~/.claude/skills/cloud-native-readiness/knowledge/scoring-criteria.md` — detailed rubrics
- `~/.claude/skills/cloud-native-readiness/knowledge/anti-patterns.md` — disqualifying patterns

**STOP conditions:**
- Desktop/GUI application (Electron without server, Qt, GTK)
- Mobile app without backend
- CLI tool / library / SDK (no network service)
- No identifiable entry point or build system

Record for later phases: `language`, `framework`, `ports`, `env_vars`, `databases`, `has_dockerfile`

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
~/.claude/skills/dockerfile-skill/templates/golang.dockerfile
~/.claude/skills/dockerfile-skill/templates/nodejs-express.dockerfile
~/.claude/skills/dockerfile-skill/templates/nodejs-nextjs.dockerfile
~/.claude/skills/dockerfile-skill/templates/python-fastapi.dockerfile
~/.claude/skills/dockerfile-skill/templates/python-django.dockerfile
~/.claude/skills/dockerfile-skill/templates/java-springboot.dockerfile
```

Read the template matching the detected language/framework, then adapt it:
- Replace placeholder ports with detected ports
- Adjust build commands based on actual package manager (npm/yarn/pnpm/bun)
- Add system dependencies if needed
- Set correct entry point

**For detailed analysis guidance, read:**
```
~/.claude/skills/dockerfile-skill/modules/analyze.md    — 17-step analysis process
~/.claude/skills/dockerfile-skill/modules/generate.md   — generation rules and best practices
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
   ~/.claude/skills/dockerfile-skill/knowledge/error-patterns.md
   ```
3. Match the error → apply fix to Dockerfile → retry
4. Also consult if needed:
   ```
   ~/.claude/skills/dockerfile-skill/knowledge/system-deps.md
   ~/.claude/skills/dockerfile-skill/knowledge/best-practices.md
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
~/.claude/skills/docker-to-sealos/SKILL.md                       — 7-step workflow + MUST rules
~/.claude/skills/docker-to-sealos/references/sealos-specs.md     — Sealos ordering, labels, conventions
~/.claude/skills/docker-to-sealos/references/conversion-mappings.md — field-level Docker→Sealos mappings
```

If the project uses databases, also read:
```
~/.claude/skills/docker-to-sealos/references/database-templates.md
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

### 5.3 Validate

Run validation if Python is available:
```bash
python "~/.claude/skills/docker-to-sealos/scripts/quality_gate.py" 2>/dev/null
```

If Python is not available, validate manually by checking the MUST rules above against the generated YAML.

---

## Phase 6: Deploy to Sealos Cloud

### 6.1 Construct Deploy URL

The template deploy API uses a fixed `template.` subdomain prefix on the region domain:

```
Region:     https://192.168.12.53.nip.io
Deploy URL: https://template.192.168.12.53.nip.io/api/v2alpha/templates
```

Extract the region from `~/.sealos/auth.json` (saved during preflight auth):
```bash
REGION=$(cat ~/.sealos/auth.json | grep -o '"region":"[^"]*"' | cut -d'"' -f4)
REGION_DOMAIN=$(echo "$REGION" | sed 's|https://||')
DEPLOY_URL="https://template.${REGION_DOMAIN}/api/v2alpha/templates"
```

### 6.2 Deploy Template

Read kubeconfig, **encode it with `encodeURIComponent`**, and send as `Authorization` header.

Request body only needs the `yaml` field — the full template YAML string.

**With Node.js:**
```bash
node -e "
const fs = require('fs');
const os = require('os');
const kc = fs.readFileSync(os.homedir() + '/.sealos/kubeconfig', 'utf-8');
const yaml = fs.readFileSync('template/<app-name>/index.yaml', 'utf-8');
fetch('$DEPLOY_URL', {
  method: 'POST',
  headers: {
    'Authorization': encodeURIComponent(kc),
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ yaml })
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

# Build JSON body — use jq if available, otherwise AI constructs it
TEMPLATE_YAML=$(cat template/<app-name>/index.yaml)
jq -n --arg yaml "$TEMPLATE_YAML" '{yaml: $yaml}' | \
  curl -sf -X POST "$DEPLOY_URL" \
    -H "Authorization: $KUBECONFIG_ENCODED" \
    -H "Content-Type: application/json" \
    -d @-
```

**Without jq:**
The AI should read the template YAML (already in context), construct the JSON body directly, write it to a temp file, and curl it:
```bash
# AI writes properly escaped JSON to temp file
cat > /tmp/sealos-deploy-body.json << 'DEPLOY_EOF'
{"yaml": "<AI inserts JSON-escaped template YAML here>"}
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
| 500/503 | Server/cluster error | Retry once after 5s |

On 201 success, extract the app access URL from the response and present to user.

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
✓ Deployed to Sealos Cloud ({region})

App URL: https://<app-access-url>
```
