import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

import { writeJsonFile } from "../lib/artifacts";
import { createWorkflowStateArtifact } from "../workflows/sealosDeploy";

const CLI_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(CLI_DIR, "../..");

async function createFixtureRoot(prefix: string) {
  const workDir = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(workDir, ".sealos"), { recursive: true });
  await writeFile(join(workDir, "package.json"), JSON.stringify({
    name: "update-fixture-app",
    private: true,
  }, null, 2), "utf8");
  return workDir;
}

async function writeDeployFacts(
  workDir: string,
  options: {
    image: string;
    history: Array<Record<string, unknown>>;
  },
) {
  await writeJsonFile(join(workDir, ".sealos", "state.json"), {
    version: "1.0",
    last_deploy: {
      app_name: "demo-app",
      app_host: "demo-app",
      namespace: "ns-demo",
      region: "example.com",
      image: options.image,
      docker_hub_user: null,
      repo_name: "demo-app",
      url: "https://demo-app.example.com",
      deployed_at: "2026-04-15T09:00:00.000Z",
      last_updated_at: "2026-04-15T09:30:00.000Z",
    },
    history: options.history,
  });
}

function runStatusCommand(workDir: string) {
  return execFileSync(
    process.execPath,
    ["--import", "tsx", "src/cli/statusRun.ts", "--dir", workDir],
    {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
    },
  );
}

async function runSuccessfulUpdateScenario() {
  const workDir = await createFixtureRoot("sealos-update-success-");
  try {
    const workflowState = createWorkflowStateArtifact("update-success", "2026-04-15T12:00:00.000Z");
    workflowState.execution_mode = "update";
    workflowState.status = "completed";
    workflowState.update_attempt = {
      attempt: 2,
      max_attempts: 3,
      last_attempt_started_at: "2026-04-15T12:05:00.000Z",
      last_outcome_status: "succeeded",
      last_outcome_at: "2026-04-15T12:06:00.000Z",
      last_outcome_message: "Update set-image succeeded after one retry.",
      last_failure_at: "2026-04-15T12:04:00.000Z",
      last_failure_message: "temporary failed rollout before retry",
      exhausted: false,
      terminal_failure: false,
      rollback_completed_at: null,
    };
    await writeJsonFile(join(workDir, ".sealos", "workflow-state.json"), workflowState);
    await writeDeployFacts(workDir, {
      image: "ghcr.io/example/demo-app:next",
      history: [
        {
          at: "2026-04-15T09:00:00.000Z",
          action: "deploy",
          image: "ghcr.io/example/demo-app:previous",
          method: "template-api",
          status: "success",
          note: "Initial deployment",
        },
        {
          at: "2026-04-15T12:06:00.000Z",
          action: "set-image",
          image: "ghcr.io/example/demo-app:next",
          previous_image: "ghcr.io/example/demo-app:previous",
          method: "kubectl-set-image",
          status: "success",
          note: "set-image completed after retry",
        },
      ],
    });

    const output = runStatusCommand(workDir);
    assert.match(output, /Mode: update/);
    assert.match(output, /Retry state: Attempt 2\/3 succeeded after 1 retry\./);
    assert.match(output, /Last deploy: demo-app in ns-demo .*image ghcr.io\/example\/demo-app:next/);

    return {
      scenario: "successful update set-image after retry",
      status: "passed",
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function runTerminalFailureScenario() {
  const workDir = await createFixtureRoot("sealos-update-failed-");
  try {
    const workflowState = createWorkflowStateArtifact("update-failed", "2026-04-15T13:00:00.000Z");
    workflowState.execution_mode = "update";
    workflowState.status = "failed";
    workflowState.current_step = "deploy";
    workflowState.last_error = {
      step: "deploy",
      message: "terminal failed rollout after retries",
      at: "2026-04-15T13:08:00.000Z",
    };
    workflowState.update_attempt = {
      attempt: 3,
      max_attempts: 3,
      last_attempt_started_at: "2026-04-15T13:06:00.000Z",
      last_outcome_status: "failed",
      last_outcome_at: "2026-04-15T13:08:00.000Z",
      last_outcome_message: "Attempt 3/3 exhausted retries and triggered rollout undo deployment/$APP_NAME -n $NAMESPACE.",
      last_failure_at: "2026-04-15T13:08:00.000Z",
      last_failure_message: "failed rollout during update branch",
      exhausted: true,
      terminal_failure: true,
      rollback_completed_at: "2026-04-15T13:09:00.000Z",
    };
    await writeJsonFile(join(workDir, ".sealos", "workflow-state.json"), workflowState);
    await writeDeployFacts(workDir, {
      image: "ghcr.io/example/demo-app:previous",
      history: [
        {
          at: "2026-04-15T09:00:00.000Z",
          action: "deploy",
          image: "ghcr.io/example/demo-app:previous",
          method: "template-api",
          status: "success",
          note: "Initial deployment",
        },
        {
          at: "2026-04-15T13:09:00.000Z",
          action: "set-image",
          image: "ghcr.io/example/demo-app:next",
          previous_image: "ghcr.io/example/demo-app:previous",
          method: "kubectl-set-image",
          status: "failed",
          note: "rollout undo deployment/$APP_NAME -n $NAMESPACE completed after failed rollout",
        },
      ],
    });

    const output = runStatusCommand(workDir);
    assert.match(output, /Runtime status: failed/);
    assert.match(output, /Retry state: Attempt 3\/3 exhausted the workflow retry policy and ended in terminal failure\./);
    assert.match(output, /rollout undo deployment\/\$APP_NAME -n \$NAMESPACE/);
    assert.match(output, /Last deploy: demo-app in ns-demo .*image ghcr.io\/example\/demo-app:previous/);

    return {
      scenario: "terminal failed rollout preserves previous_image after rollback undo",
      status: "passed",
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const results = [
    await runSuccessfulUpdateScenario(),
    await runTerminalFailureScenario(),
  ];

  console.log(JSON.stringify({
    smoke: "update",
    status: "passed",
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
