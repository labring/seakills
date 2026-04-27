# `@seakills/sealos-deploy-workflow`

This package is the maintainer workflow runtime for `sealos-deploy`.

Phase 5 exposes that runtime through the explicit `/sealos-deploy workflow ...`
surface while keeping legacy `/sealos-deploy` as the default path. This README
stays focused on runtime commands and rollout guardrails; the canonical operator
guide is [`../docs/sealos-deploy-workflow.md`](../docs/sealos-deploy-workflow.md).

If this runtime was copied as part of a skill install, run `pnpm install` inside
`<SKILL_DIR>/runtime` before first use unless dependencies were already vendored.

## Maintainer Commands

From the repository root:

```bash
pnpm --dir <SKILL_DIR>/runtime dev
```

Start a run directly from the CLI:

```bash
pnpm --dir <SKILL_DIR>/runtime start:run --dir /absolute/path/to/project
```

Resume or restart explicitly:

```bash
pnpm --dir <SKILL_DIR>/runtime start:run --dir /absolute/path/to/project --resume
pnpm --dir <SKILL_DIR>/runtime start:run --dir /absolute/path/to/project --restart
```

Inspect the current run state without opening raw JSON:

```bash
pnpm --dir <SKILL_DIR>/runtime status:run --dir /absolute/path/to/project
```

Run the fixture-backed smoke path:

```bash
pnpm --dir <SKILL_DIR>/runtime typecheck
pnpm --dir <SKILL_DIR>/runtime test:gates
pnpm --dir <SKILL_DIR>/runtime test:update
pnpm --dir <SKILL_DIR>/runtime smoke:gates
pnpm --dir <SKILL_DIR>/runtime smoke:happy-path
pnpm --dir <SKILL_DIR>/runtime smoke:skill-entry
pnpm --dir <SKILL_DIR>/runtime smoke:resume
pnpm --dir <SKILL_DIR>/runtime smoke:status
pnpm --dir <SKILL_DIR>/runtime smoke:update
```

## Rollout Guardrails

- Public skill entry is `/sealos-deploy workflow ...`, not `/sealos-deploy --workflow`.
- Recovery stays explicit: inspect with `status:run`, then use `--resume` or `--restart`.
- Silent fallback to the legacy markdown path is disabled for workflow-mode recovery.
- Operator wording must stay aligned with [`../docs/sealos-deploy-workflow.md`](../docs/sealos-deploy-workflow.md).

The dev runtime exposes:

- `GET /api/health`
- `GET /api/health?dir=/absolute/path/to/project`
- `POST /api/runs`

## Scope

Phase 3 keeps the maintainer-only workflow runtime boundary and now adds durable checkpoint state plus workflow-backed human gates:

- `preflight -> assess -> detect-image -> ensure-dockerfile/build-path -> template -> deploy`

The staged human gate sequence is now:

- `region -> auth pause -> workspace -> deploy inputs -> confirmations -> deploy`
- `workspace-change-confirmation` is required before switching away from the authenticated workspace
- `deploy-apply-confirmation` is required before the final deploy step runs
- stale or expired gate payloads block resume instead of silently continuing

The workflow closes with artifact validation, but it still does not yet implement:

- workflow-native update-mode orchestration
- public cutover from `/sealos-deploy`

Update-mode orchestration remains deferred to Phase 4.

## Runtime Shape

- `src/workflows/sealosDeploy.ts` contains the Phase 1 `use workflow` orchestration shell.
- `src/workflows/sealosDeploy.ts` now persists `.sealos/workflow-state.json` before and after resumable checkpoints.
- `src/workflows/sealosDeploy.ts` also persists pending gate metadata for `region-selection`, `sealos-auth`, `workspace-selection`, `deploy-inputs`, and confirmation gates.
- `src/steps/*.ts` wrap the bundled `../scripts/*.mjs` helpers rather than reimplementing them.
- `src/server.ts` plus `src/api/*.ts` expose the maintainer HTTP surface for health and run start.
- `src/cli/*.ts` provide direct maintainer commands for start, status inspection, and smoke validation.

## Layered State Model

- `.sealos/workflow-state.json` is the in-flight workflow progress store. It tracks run ID, current step, resumable checkpoints, resume metadata, retry state, pending gates, and `last_error`.
- `.sealos/config.json` is the durable user-input store for staged deploy inputs such as `port`, `build_command`, `start_command`, `base_image`, and `env_overrides`.
- `.sealos/state.json` remains the deploy facts store. It keeps `last_deploy` and `history`, and Phase 2 does not repurpose it into a workflow progress file.
- `status:run` normalizes both artifacts into one operator summary with `Mode:`, `Runtime status:`, `Current step:`, `Pending gate:`, `Latest failure:`, `Retry state:`, and `Last deploy:`.
- `smoke:update` verifies update branch reporting for successful `set-image` retries and terminal failed rollout + rollback paths.
- Default `start:run` may seed `workflow-state.json` from legacy `analysis.json`, `build-result.json`, and `template/index.yaml` through `artifact-presence-bridge` when no sidecar exists.
- Strict `--resume` never seeds migration. If `workflow-state.json` is missing or mismatched, the runtime now emits `restart-confirmation` instead of silently restarting.
- Deploy checkpoints are trusted only when `.sealos/state.json` contains matching deploy facts, and resume validates prior artifacts before skipping work.
- The runtime now exposes the same normalized inspection summary through `status:run` and `GET /api/health?dir=...`, so operators can inspect waiting, failed, resumed, and retrying runs without reading raw files.
- Update-path retries are workflow-level behavior. Retry attempts stay in `.sealos/workflow-state.json`, while `.sealos/state.json` only records terminal failed `set-image` history after retry exhaustion and rollback.
