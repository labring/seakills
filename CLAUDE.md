# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Seakills is a skills repository for Sealos Cloud in the `skills.sh` ecosystem. This repo contains the skills pack plus supporting helper scripts and eval fixtures. The landing site now lives in the separate `zjy365/seakills-site` repository.

## Commands

This repo does not have a single top-level app build.

- Most work happens directly under `skills/**`
- Run helper scripts with `node <path-to-script>.mjs`
- Keep `skills/sealos-deploy/evals/` in sync when skill behavior changes

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

## Key paths
- `skills/sealos-deploy/SKILL.md` — primary entry point for the deploy workflow
- `skills/sealos-deploy/config.json` — OAuth client_id, regional Sealos URLs
- `skills/sealos-deploy/scripts/` — auth, scoring, and helper automation scripts
- `skills/sealos-deploy/evals/evals.json` — eval prompts and assertions
