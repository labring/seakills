# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Seakills is an AI agent skills ecosystem for Sealos Cloud. It provides slash-command skills (`/sealos-deploy`, `/cloud-native-readiness`, `/dockerfile`) that work with Claude Code, Gemini CLI, and Codex. The project has two main parts: the **skills** (markdown-based modules + Node.js scripts) and a **landing site** (Next.js).

## Commands

### Site development (run from `site/`)
```bash
cd site && pnpm install    # install dependencies
cd site && pnpm dev        # dev server on localhost:3000
cd site && pnpm build      # production build
cd site && pnpm lint       # ESLint
```

### Packaging & distribution (run from repo root)
```bash
./package.sh               # package skills/ into tar.gz, copy install.sh to site/public/
```

### Docker (site)
```bash
cd site && docker build -t seakills-site . && docker run -p 3000:3000 seakills-site
```

### CI
GitHub Actions (`.github/workflows/deploy-site.yml`) triggers on push to `main` when `skills/**`, `install.sh`, or `site/**` change. It runs `package.sh`, then builds and pushes a Docker image to `ghcr.io/zjy365/seakills-site`.

## Architecture

### Skill dependency graph
```
sealos-deploy (user entry point: /sealos-deploy)
  ├→ cloud-native-readiness   (Phase 1: score 0-12)
  ├→ dockerfile-skill          (Phase 3: generate Dockerfile)
  └→ docker-to-sealos          (Phase 5: Compose → Sealos template)
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
```
Preflight → Assess (score<4 = stop) → Detect image (found? skip build) →
Generate Dockerfile → Build & Push → Generate Sealos Template → Deploy
```
State is tracked in `deploy-out/context.json` for resume capability.

### Installer (`install.sh`)
Downloads skills from site distribution (with GitHub fallback), installs to `~/.agents/skills/` (canonical), then symlinks to each detected agent's skills directory.

### Site (`site/`)
Next.js 16 + React 19 + TypeScript landing page. Uses Radix UI, Tailwind CSS, and Motion for animations. Configured for standalone output. Serves packaged skill tarballs and the installer from `public/`.

## Version management
The single source of truth for version is `VERSION="x.y.z"` in `install.sh`. `package.sh` extracts it and exports to `$GITHUB_ENV` for CI tagging.

## Key paths
- `skills/sealos-deploy/config.json` — OAuth client_id, regional Sealos URLs
- `site/next.config.mjs` — standalone output, unoptimized images, ignores TS build errors
- `site/components.json` — shadcn/ui component config with `@/` path alias
