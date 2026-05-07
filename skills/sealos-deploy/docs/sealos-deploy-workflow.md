# Sealos Deploy Workflow

This guide covers the explicit workflow runtime for `sealos-deploy`. Legacy
`/sealos-deploy` remains the default path. Workflow mode is opt-in. It never uses
a silent fallback to the legacy markdown pipeline during recovery.

## Entry Forms

```text
/sealos-deploy workflow
/sealos-deploy workflow <github-url>
/sealos-deploy workflow <local-path>
/sealos-deploy workflow --resume <target>
/sealos-deploy workflow --restart <target>
/sealos-deploy workflow status <target>
```

Use `status` first when a run pauses or fails. Resume only when the status output
shows a pending gate or resumable checkpoint. Restart only when the previous
state is stale, mismatched, or intentionally discarded.

## Runtime Commands

```bash
pnpm --dir <SKILL_DIR>/runtime start:run --dir <WORK_DIR>
pnpm --dir <SKILL_DIR>/runtime start:run --dir <WORK_DIR> --resume
pnpm --dir <SKILL_DIR>/runtime start:run --dir <WORK_DIR> --restart
pnpm --dir <SKILL_DIR>/runtime status:run --dir <WORK_DIR>
```

The runtime writes workflow progress to `<WORK_DIR>/.sealos/workflow-state.json`
and deployment facts to `<WORK_DIR>/.sealos/state.json`. Operators should use
`status:run` instead of reading those files directly during normal recovery.

## Recovery Rules

- `status:run` is the canonical inspection command for waiting, failed, resumed,
  retrying, and completed runs.
- `--resume` requires a compatible `workflow-state.json`; strict resume never
  creates migration state from old artifacts.
- `--restart` starts a fresh workflow path after explicit operator intent.
- Gate payloads are validated on resume. Expired auth, stale region/workspace
  choices, and deploy-checkpoint mismatches block recovery.
- Workflow recovery never silently falls back to the legacy `/sealos-deploy`
  path. Surface the recovery command and stop if the runtime cannot proceed.
- In short: workflow mode never uses a silent fallback.

## Human Gates

The workflow may pause for:

- `region-selection`
- `sealos-auth`
- `workspace-selection`
- `workspace-change-confirmation`
- `deploy-inputs`
- `deploy-apply-confirmation`
- `deployment-mode-confirmation`
- `restart-confirmation`

When a gate is waiting, run:

```bash
pnpm --dir <SKILL_DIR>/runtime status:run --dir <WORK_DIR>
```

Then resume with the command shown in the recovery line, such as:

```bash
pnpm --dir <SKILL_DIR>/runtime start:run --dir <WORK_DIR> --resume --approval approve
pnpm --dir <SKILL_DIR>/runtime start:run --dir <WORK_DIR> --resume --region <region>
pnpm --dir <SKILL_DIR>/runtime start:run --dir <WORK_DIR> --resume --workspace <workspace-id>
```

## Update Path

If `.sealos/state.json` contains a verified `last_deploy` and the deployment is
still running, workflow mode can use the update path:

```text
preflight -> build-push -> kubectl set image -> verify rollout
```

Failed update rollouts retry at workflow level. Exhausted retries trigger
rollback with `kubectl rollout undo`, preserve the previous image in
`last_deploy`, and record terminal failed `set-image` history only after the
rollback path completes.

## Deploy Path

Fresh deployments run:

```text
preflight -> assess -> detect-image -> dockerfile -> build-push -> template -> deploy -> validate-artifacts
```

Dry-run smoke coverage exercises this path without contacting a real registry or
creating a live Sealos deployment.
