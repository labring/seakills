---
name: sealos-deploy
version: "1.0.3"
description: Deploy any GitHub project to Sealos Cloud in one command. Assesses readiness, generates Dockerfile, builds image, creates Sealos template, and deploys — fully automated.
triggers:
  - /sealos-deploy
  - deploy to sealos
  - deploy this to sealos
  - deploy this project to sealos
allowed-tools: Read, Glob, Grep, Bash, Write, Edit, WebFetch, mcp__deepwiki__ask_question
---

# Sealos Deploy

Deploy any GitHub project to Sealos Cloud — from source code to running application, one command.

## Usage

```
/sealos-deploy <github-url>
/sealos-deploy                    # deploy current project
/sealos-deploy <local-path>
```

## Quick Start

Execute the modules in order:

1. `modules/preflight.md` — Environment checks & Sealos auth
2. `modules/pipeline.md` — Full deployment pipeline (Phase 1–6)

## Logging

Every run MUST write a log file at `~/.sealos/logs/deploy-<YYYYMMDD-HHmmss>.log`.

**At the very start of execution**, create the log file **once**:
```bash
mkdir -p ~/.sealos/logs
LOG_FILE=~/.sealos/logs/deploy-$(date +%Y%m%d-%H%M%S).log
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Deploy started" > "$LOG_FILE"
```

**Important: create the log file ONLY ONCE at the start. All subsequent writes MUST append (`>>`) to this same `$LOG_FILE`. Do NOT create a second log file.**

**At each phase boundary**, append a log entry to the same file with Bash `>>`:
```
[2026-03-05 14:30:01] === Phase 0: Preflight ===
[2026-03-05 14:30:01] Docker: ✓ 27.5.1
[2026-03-05 14:30:01] Node.js: ✓ 22.12.0
[2026-03-05 14:30:02] Sealos auth: ✓ (region: https://192.168.12.53.nip.io)
[2026-03-05 14:30:02] Project: /Users/dev/myapp (github: https://github.com/owner/repo)

[2026-03-05 14:30:03] === Phase 1: Assess ===
[2026-03-05 14:30:03] Score: 9/12 (good)
[2026-03-05 14:30:03] Language: python, Framework: fastapi, Port: 8000
[2026-03-05 14:30:03] Decision: CONTINUE

[2026-03-05 14:30:04] === Phase 2: Detect Image ===
[2026-03-05 14:30:05] Docker Hub: owner/repo:latest (arm64 only, no amd64)
[2026-03-05 14:30:05] GHCR: not found
[2026-03-05 14:30:05] Decision: no amd64 image → continue to Phase 3

[2026-03-05 14:30:06] === Phase 3: Dockerfile ===
[2026-03-05 14:30:06] Existing Dockerfile: none
[2026-03-05 14:30:07] Generated: python-fastapi template, port 8000

[2026-03-05 14:30:08] === Phase 4: Build & Push ===
[2026-03-05 14:30:08] Docker Hub user: zhujingyang
[2026-03-05 14:30:30] Build: ✓ zhujingyang/repo:20260305
[2026-03-05 14:30:30] IMAGE_REF=zhujingyang/repo:20260305

[2026-03-05 14:30:31] === Phase 5: Template ===
[2026-03-05 14:30:32] Output: template/repo/index.yaml

[2026-03-05 14:30:33] === Phase 6: Deploy ===
[2026-03-05 14:30:33] Deploy URL: https://template.192.168.12.53.nip.io/api/v2alpha/templates
[2026-03-05 14:30:35] Status: 201 — deployed successfully
[2026-03-05 14:30:35] === DONE ===
```

**On error**, log the error details before stopping:
```
[2026-03-05 14:30:10] === ERROR ===
[2026-03-05 14:30:10] Phase: 4 (Build & Push)
[2026-03-05 14:30:10] Error: docker buildx build failed — "npm ERR! Missing script: build"
[2026-03-05 14:30:10] Retry: 1/3
```

**At the very end**, tell the user where the log is:
```
Log saved to: ~/.sealos/logs/deploy-20260305-143001.log
```

## Scripts

Located in `scripts/` within this skill directory (`<SKILL_DIR>/scripts/`):

| Script | Usage | Purpose |
|--------|-------|---------|
| `score-model.mjs` | `node score-model.mjs <repo-dir>` | Deterministic readiness scoring (0-12) |
| `detect-image.mjs` | `node detect-image.mjs <github-url> [work-dir]` or `node detect-image.mjs <work-dir>` | Detect existing Docker/GHCR images |
| `build-push.mjs` | `node build-push.mjs <work-dir> <user> <repo>` | Build amd64 image & push to Docker Hub |
| `sealos-auth.mjs` | `node sealos-auth.mjs check\|login` | Sealos Cloud authentication |

All scripts output JSON. Run via Bash and parse the result.

## Internal Skill Dependencies

This skill references knowledge files from co-installed internal skills. These are **not** user-facing — they are loaded on-demand during specific phases.

```
~/.claude/skills/
├── sealos-deploy/           ← this skill (user entry point)
├── dockerfile-skill/        ← Phase 3: Dockerfile generation knowledge
├── cloud-native-readiness/  ← Phase 1: assessment criteria
└── docker-to-sealos/       ← Phase 5: Sealos template rules
```

Paths used in pipeline.md follow the pattern:
```
~/.claude/skills/dockerfile-skill/knowledge/error-patterns.md
~/.claude/skills/dockerfile-skill/templates/<lang>.dockerfile
~/.claude/skills/docker-to-sealos/references/sealos-specs.md
```

## Phase Overview

| Phase | Action | Skip When |
|-------|--------|-----------|
| 0 — Preflight | Docker + Sealos auth (Docker Hub deferred to Phase 4) | All checks pass |
| 1 — Assess | Clone repo (or use current project), analyze deployability | Score too low → stop |
| 2 — Detect | Find existing image (Docker Hub / GHCR / README) | Found → jump to Phase 5 |
| 3 — Dockerfile | Generate Dockerfile if missing | Already has one → skip |
| 4 — Build & Push | `docker buildx` → Docker Hub | — |
| 5 — Template | Generate Sealos application template | — |
| 6 — Deploy | Deploy template to Sealos Cloud | — |

## Decision Flow

```
Input (GitHub URL / local path)
  │
  ▼
[Phase 0] Preflight ── fail → guide user to fix
  │ pass
  ▼
[Phase 1] Assess ── not suitable → STOP with reason
  │ suitable
  ▼
[Phase 2] Detect existing image
  │
  ├── found (amd64) ────────────────────┐
  │                                     │
  ▼                                     │
[Phase 3] Dockerfile (generate/reuse)   │
  │                                     │
  ▼                                     │
[Phase 4] Build & Push to Docker Hub    │
  │                                     │
  ◄─────────────────────────────────────┘
  │
  ▼
[Phase 5] Generate Sealos Template
  │
  ▼
[Phase 6] Deploy to Sealos Cloud ── 401 → re-auth
  │                                  409 → instance exists
  ▼
Done — app deployed ✓
```
