# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What This Project Is

Seakills is a skills repository for Sealos Cloud in the `skills.sh` ecosystem. The project has two main parts: the **skills** (markdown-based modules + Node.js scripts) and a **landing site** (Next.js).

## Commands

### Site development (run from `site/`)
```bash
cd site && pnpm install    # install dependencies
cd site && pnpm dev        # dev server on localhost:3000
cd site && pnpm build      # production build
cd site && pnpm lint       # ESLint
```

### Docker (site)
```bash
cd site && docker build -t seakills-site . && docker run -p 3000:3000 seakills-site
```

### CI
GitHub Actions (`.github/workflows/deploy-site.yml`) triggers on push to `main` when `skills/**` or `site/**` change. It builds and pushes a Docker image to `ghcr.io/zjy365/seakills-site`.

## Architecture

### Skill dependency graph
```text
sealos-deploy (user entry point: /sealos-deploy)
  ├→ cloud-native-readiness   (Phase 1: score 0-12)
  ├→ dockerfile-skill         (Phase 3: generate Dockerfile)
  └→ docker-to-sealos         (Phase 5: Compose → Sealos template)
```

### Skill module pattern
Each skill follows the same structure:
- `SKILL.md` — entry point with YAML frontmatter (name, version, allowed-tools, compatibility)
- `modules/*.md` — phased execution logic (preflight, assess, generate, build, deploy)
- `scripts/*.mjs` — Node.js executables (auth, scoring, image detection, build)
- `knowledge/*.md` — error patterns, best practices, scoring criteria
- `config.json` — runtime config (OAuth, regions)

Skills reference paths with `<SKILL_DIR>` for self and `<SKILL_DIR>/../other-skill/` for siblings.

### Deployment pipeline (sealos-deploy)
```text
Preflight → Mode Detection → DEPLOY or UPDATE

DEPLOY: Assess → Detect image → Dockerfile → Build & Push → Template → Deploy
UPDATE: Build & Push → kubectl set image → Verify rollout (auto-rollback on failure)
```

Mode detection reads `.sealos/state.json` `last_deploy` field. If a running deployment is found (verified via kubectl), the skill enters UPDATE mode and skips assess/template/deploy phases. If not, it runs the full DEPLOY pipeline.

State is tracked in `.sealos/state.json` (deployment state), `.sealos/analysis.json` (project analysis snapshot), and `.sealos/config.json` (optional user overrides). The `last_deploy` section in `state.json` records app name, namespace, image, and URL so later deploys can update in place instead of starting over.

### Site (`site/`)
Next.js 16 + React 19 + TypeScript landing page. Uses Radix UI, Tailwind CSS, and Motion for animations. Configured for standalone output.

## Key paths
- `skills/sealos-deploy/config.json` — OAuth client_id, regional Sealos URLs
- `site/next.config.mjs` — standalone output, unoptimized images, ignores TS build errors
- `site/components.json` — shadcn/ui component config with `@/` path alias
