---
name: sealos-deploy
version: "1.0.2"
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
2. `modules/pipeline.md` — Full deployment pipeline (Phase 1–5)

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
Done — output template YAML + imageRef
```
