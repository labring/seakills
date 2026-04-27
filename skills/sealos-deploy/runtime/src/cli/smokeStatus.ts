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
    name: "status-fixture-app",
    private: true,
  }, null, 2), "utf8");
  return workDir;
}

async function writeLastDeployFixture(workDir: string, image = "ghcr.io/example/demo-app:stable") {
  await writeJsonFile(join(workDir, ".sealos", "state.json"), {
    version: "1.0",
    last_deploy: {
      app_name: "demo-app",
      app_host: "demo-app",
      namespace: "ns-demo",
      region: "https://cloud.example.com",
      image,
      docker_hub_user: null,
      repo_name: "demo-app",
      url: "https://demo-app.example.com",
      deployed_at: "2026-04-15T09:00:00.000Z",
      last_updated_at: "2026-04-15T09:30:00.000Z",
    },
    history: [],
  });
}

async function runStatusCommand(workDir: string) {
  return execFileSync(
    process.execPath,
    ["--import", "./node_modules/tsx/dist/loader.mjs", "src/cli/statusRun.ts", "--dir", workDir],
    {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
    },
  );
}

async function runWaitingFixtureScenario() {
  const workDir = await createFixtureRoot("sealos-status-fixture-waiting-");
  try {
    const workflowState = createWorkflowStateArtifact("status-waiting", "2026-04-15T10:00:00.000Z");
    workflowState.status = "waiting";
    workflowState.current_step = "deploy";
    workflowState.resume.resume_count = 1;
    workflowState.resume.last_resumed_at = "2026-04-15T10:05:00.000Z";
    workflowState.pending_gate = {
      kind: "confirmation",
      name: "deploy-apply-confirmation",
      status: "waiting",
      prompt: "Confirm deploy apply.",
      payload: {},
      created_at: "2026-04-15T10:06:00.000Z",
      expires_at: null,
      resume_hint: "Resume with --resume --approval apply.",
    };
    await writeJsonFile(join(workDir, ".sealos", "workflow-state.json"), workflowState);

    const output = await runStatusCommand(workDir);
    assert.match(output, /Mode: deploy/);
    assert.match(output, /Runtime status: waiting/);
    assert.match(output, /Current step: deploy/);
    assert.match(output, /Pending gate: deploy-apply-confirmation/);
    assert.match(output, /Resume with --resume --approval apply\./);
    assert.match(output, /Recovery: .*start:run.*--resume --approval approve/);

    return {
      scenario: "fixture waiting gate summary",
      status: "passed",
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function runFailedFixtureScenario() {
  const workDir = await createFixtureRoot("sealos-status-fixture-failed-");
  try {
    const workflowState = createWorkflowStateArtifact("status-failed", "2026-04-15T11:00:00.000Z");
    workflowState.execution_mode = "update";
    workflowState.status = "failed";
    workflowState.current_step = "deploy";
    workflowState.last_error = {
      step: "deploy",
      message: "rollout failed after set-image",
      at: "2026-04-15T11:06:00.000Z",
    };
    await writeJsonFile(join(workDir, ".sealos", "workflow-state.json"), workflowState);
    await writeLastDeployFixture(workDir);

    const output = await runStatusCommand(workDir);
    assert.match(output, /Mode: update/);
    assert.match(output, /Runtime status: failed/);
    assert.match(output, /Latest failure: rollout failed after set-image @ 2026-04-15T11:06:00.000Z/);
    assert.match(output, /Last deploy: demo-app in ns-demo/);
    assert.match(output, /Recovery: .*start:run.*--restart/);

    return {
      scenario: "fixture failed status summary",
      status: "passed",
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function runRetryingFixtureScenario() {
  const workDir = await createFixtureRoot("sealos-status-fixture-retrying-");
  try {
    const workflowState = createWorkflowStateArtifact("status-retrying", "2026-04-15T12:00:00.000Z");
    workflowState.execution_mode = "update";
    workflowState.status = "running";
    workflowState.current_step = "deploy";
    workflowState.update_attempt = {
      attempt: 2,
      max_attempts: 3,
      last_failure_at: "2026-04-15T12:05:00.000Z",
      last_failure_message: "temporary rollout failure",
      terminal_failure: false,
      rollback_completed_at: null,
    };
    await writeJsonFile(join(workDir, ".sealos", "workflow-state.json"), workflowState);
    await writeLastDeployFixture(workDir, "ghcr.io/example/demo-app:previous");

    const output = await runStatusCommand(workDir);
    assert.match(output, /Mode: update/);
    assert.match(output, /Retry state: Attempt 2\/3; 1 retries remaining\./);
    assert.match(output, /last failure 2026-04-15T12:05:00.000Z/);
    assert.match(output, /Recovery: Run status:run again after the next workflow action\. Legacy fallback is disabled\./);

    return {
      scenario: "fixture retrying status summary",
      status: "passed",
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const results = [
    await runWaitingFixtureScenario(),
    await runFailedFixtureScenario(),
    await runRetryingFixtureScenario(),
  ];

  console.log(JSON.stringify({
    smoke: "status",
    status: "passed",
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
