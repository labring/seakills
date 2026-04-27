import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getArtifactPaths,
  buildWorkflowStatusSummary,
  createWorkflowUpdateRetryRecord,
  readWorkflowStateArtifact,
  writeJsonFile,
} from "./artifacts";
import { validateArtifactsStep } from "../steps/validateArtifactsStep";
import {
  applyWorkflowCheckpoint,
  createWorkflowStateArtifact,
  executeUpdateDeployStep,
} from "../workflows/sealosDeploy";
import type { SealosDeployWorkflowInput, SealosStateArtifact, WorkflowRuntimeState } from "../types";

async function makeTempWorkDir(prefix: string) {
  return mkdtemp(join(tmpdir(), prefix));
}

function makeInput(workDir: string): SealosDeployWorkflowInput {
  return {
    workDir,
    repoName: "demo-app",
    githubUrl: null,
    branch: "main",
    dryRun: false,
    title: "demo-app",
    description: "test",
    url: undefined,
    author: "Seakills",
    categories: ["backend"],
  };
}

function makeDeployFacts(image = "ghcr.io/example/demo-app:current"): SealosStateArtifact {
  return {
    version: "1.0",
    last_deploy: {
      app_name: "demo-app",
      app_host: "demo-app",
      namespace: "ns-demo",
      region: "example.com",
      image,
      docker_hub_user: null,
      repo_name: "demo-app",
      url: "https://demo-app.example.com",
      deployed_at: "2026-04-15T09:00:00.000Z",
      last_updated_at: "2026-04-15T09:30:00.000Z",
    },
    history: [
        {
          at: "2026-04-15T09:00:00.000Z",
          action: "deploy",
          image,
          method: "template-api",
          status: "success",
          note: "Initial deployment",
      },
    ],
  };
}

function makeUpdateRuntimeState(
  workDir: string,
  imageRef = "docker.io/example/demo-app:next",
): WorkflowRuntimeState {
  const input = makeInput(workDir);
  return {
    input,
    analysis: undefined,
    config: undefined,
    imageRef,
    executionMode: "update",
    executionSummary: "Running update mode for deployment/demo-app in namespace ns-demo.",
    deploymentChoice: "update",
    updateTarget: {
      app_name: "demo-app",
      namespace: "ns-demo",
      region: "example.com",
      image: "docker.io/example/demo-app:previous",
      repo_name: "demo-app",
      url: "https://demo-app.example.com",
    },
    region: "example.com",
    workspace: "ns-demo",
    resumeInput: {},
    stepResults: [],
    stepsCompleted: ["assess", "build-push"],
  };
}

async function writeValidAnalysis(workDir: string, imageRef: string) {
  const paths = getArtifactPaths(workDir);
  await writeJsonFile(paths.analysis, {
    generated_at: "2026-04-15T10:00:00.000Z",
    project: {
      github_url: null,
      work_dir: workDir,
      repo_name: "demo-app",
      branch: "main",
    },
    score: {
      total: 8,
      verdict: "deployable",
      dimensions: {
        statelessness: 2,
        config: 1,
        scalability: 1,
        startup: 1,
        observability: 1,
        boundaries: 2,
      },
    },
    language: "node",
    all_languages: ["node"],
    framework: "express",
    package_manager: "pnpm",
    port: 3000,
    databases: [],
    runtime_version: {
      node: "22",
      source: "test",
    },
    env_vars: {},
    has_dockerfile: true,
    complexity_tier: "L1",
    image_ref: imageRef,
  });
}

async function writeValidBuildResult(workDir: string, imageRef: string) {
  const paths = getArtifactPaths(workDir);
  await writeJsonFile(paths.buildResult, {
    outcome: "success",
    registry: imageRef.startsWith("ghcr.io/") ? "ghcr" : "dockerhub",
    build: {
      image_name: "demo-app",
      started_at: "2026-04-15T10:00:00.000Z",
    },
    push: {
      remote_image: imageRef,
      pushed_at: "2026-04-15T10:01:00.000Z",
    },
    finished_at: "2026-04-15T10:01:30.000Z",
  });
}

async function writeFakeKubectlBin(rootDir: string) {
  const binDir = join(rootDir, "bin");
  await mkdir(binDir, { recursive: true });
  const kubectlPath = join(binDir, "kubectl");
  await writeFile(kubectlPath, [
    "#!/bin/sh",
    "echo ok",
    "exit 0",
    "",
  ].join("\n"), "utf8");
  await chmod(kubectlPath, 0o755);
  return binDir;
}

test("retry summary distinguishes retry attempts from resume_count for update branch status", () => {
  const workflowState = createWorkflowStateArtifact("run-update-retry", "2026-04-15T10:00:00.000Z");
  workflowState.execution_mode = "update";
  workflowState.status = "running";
  workflowState.current_step = "deploy";
  workflowState.resume.resume_count = 2;
  workflowState.resume.last_resumed_at = "2026-04-15T10:10:00.000Z";
  workflowState.update_attempt = createWorkflowUpdateRetryRecord({
    attempt: 2,
    maxAttempts: 3,
    lastAttemptStartedAt: "2026-04-15T10:12:00.000Z",
    lastOutcomeStatus: "retrying",
    lastOutcomeAt: "2026-04-15T10:13:00.000Z",
    lastOutcomeMessage: "Attempt 2/3 failed; retrying update set-image rollout verification.",
    lastFailureAt: "2026-04-15T10:13:00.000Z",
    lastFailureMessage:
      "Update rollout failed after kubectl set-image and rollout status on attempt 2/3.",
  });

  const summary = buildWorkflowStatusSummary(workflowState, makeDeployFacts());
  assert.equal(summary.mode, "update");
  assert.equal(summary.resume?.resume_count, 2);
  assert.equal(summary.retry?.attempt, 2);
  assert.equal(summary.retry?.remaining_attempts, 1);
  assert.equal(summary.retry?.last_outcome_status, "retrying");
  assert.match(summary.retry?.summary ?? "", /retries remaining/i);
});

test("terminal failure summary preserves previous_image deploy facts until failed set-image is terminal", () => {
  const workflowState = createWorkflowStateArtifact("run-update-failed", "2026-04-15T11:00:00.000Z");
  workflowState.execution_mode = "update";
  workflowState.status = "failed";
  workflowState.current_step = "deploy";
  workflowState.last_error = {
    step: "deploy",
    message: "failed rollout after kubectl set-image; rollout undo completed",
    at: "2026-04-15T11:20:00.000Z",
  };
  workflowState.update_attempt = createWorkflowUpdateRetryRecord({
    attempt: 3,
    maxAttempts: 3,
    lastAttemptStartedAt: "2026-04-15T11:10:00.000Z",
    lastOutcomeStatus: "failed",
    lastOutcomeAt: "2026-04-15T11:20:00.000Z",
    lastOutcomeMessage:
      "Attempt 3/3 exhausted the workflow retry policy after rollout undo deployment/$APP_NAME -n $NAMESPACE.",
    lastFailureAt: "2026-04-15T11:18:00.000Z",
    lastFailureMessage:
      "Terminal failed rollout after kubectl set-image; kubectl rollout undo deployment/$APP_NAME -n $NAMESPACE completed.",
    exhausted: true,
    terminalFailure: true,
    rollbackCompletedAt: "2026-04-15T11:20:00.000Z",
  });

  const deployFacts: SealosStateArtifact = {
    ...makeDeployFacts("ghcr.io/example/demo-app:previous"),
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
        at: "2026-04-15T11:20:00.000Z",
        action: "set-image",
        image: "ghcr.io/example/demo-app:next",
        previous_image: "ghcr.io/example/demo-app:previous",
        method: "kubectl-set-image",
        status: "failed",
        note: "rollout undo deployment/$APP_NAME -n $NAMESPACE completed after failed rollout",
      },
    ],
  };

  const summary = buildWorkflowStatusSummary(workflowState, deployFacts);
  assert.equal(summary.retry?.terminal_failure, true);
  assert.equal(summary.retry?.exhausted, true);
  assert.match(summary.retry?.summary ?? "", /terminal failure/i);
  assert.equal(summary.last_deploy?.image, "ghcr.io/example/demo-app:previous");
  assert.equal(deployFacts.history[1].previous_image, "ghcr.io/example/demo-app:previous");
  assert.match(deployFacts.history[1].note ?? "", /rollout undo/i);
});

test("update deploy returns retry metadata so checkpoint writes preserve succeeded outcome", async () => {
  const workDir = await makeTempWorkDir("sealos-update-deploy-");
  const previousPath = process.env.PATH;
  try {
    const imageRef = "docker.io/example/demo-app:next";
    const paths = getArtifactPaths(workDir);
    const fakeBin = await writeFakeKubectlBin(workDir);
    process.env.PATH = `${fakeBin}:${previousPath ?? ""}`;

    await writeJsonFile(paths.state, makeDeployFacts("docker.io/example/demo-app:previous"));
    const workflowState = createWorkflowStateArtifact("run-update-execute", "2026-04-15T12:00:00.000Z");
    workflowState.execution_mode = "update";
    workflowState.execution_summary = "Running update mode for deployment/demo-app in namespace ns-demo.";
    workflowState.deployment_choice = "update";
    workflowState.update_target = {
      app_name: "demo-app",
      namespace: "ns-demo",
      region: "example.com",
      image: "docker.io/example/demo-app:previous",
      repo_name: "demo-app",
      url: "https://demo-app.example.com",
    };

    const execution = await executeUpdateDeployStep(
      makeUpdateRuntimeState(workDir, imageRef),
      workflowState,
      paths,
    );

    assert.equal(execution.result.status, "success");
    assert.equal(execution.workflowState.update_attempt?.last_outcome_status, "succeeded");

    const checkpointed = applyWorkflowCheckpoint(
      execution.workflowState,
      {
        step: execution.result.step,
        status: execution.result.status,
        completed_at: "2026-04-15T12:10:00.000Z",
        artifact_paths: execution.result.artifactPaths,
        summary: execution.result.summary,
        image_ref: imageRef,
      },
      "2026-04-15T12:10:00.000Z",
    );
    assert.equal(checkpointed.update_attempt?.last_outcome_status, "succeeded");

    const persisted = await readWorkflowStateArtifact(paths);
    assert.equal(persisted?.update_attempt?.last_outcome_status, "succeeded");
  } finally {
    process.env.PATH = previousPath;
    await rm(workDir, { recursive: true, force: true });
  }
});

test("update-mode artifact validation does not require template output", async () => {
  const workDir = await makeTempWorkDir("sealos-update-validate-");
  try {
    const imageRef = "docker.io/example/demo-app:next";
    const paths = getArtifactPaths(workDir);
    const workflowState = createWorkflowStateArtifact("run-update-validate", "2026-04-15T12:00:00.000Z");
    workflowState.execution_mode = "update";
    workflowState.execution_summary = "Running update mode for deployment/demo-app in namespace ns-demo.";
    workflowState.deployment_choice = "update";
    workflowState.update_target = {
      app_name: "demo-app",
      namespace: "ns-demo",
      region: "example.com",
      image: "docker.io/example/demo-app:previous",
      repo_name: "demo-app",
      url: "https://demo-app.example.com",
    };
    workflowState.update_attempt = createWorkflowUpdateRetryRecord({
      attempt: 1,
      maxAttempts: 3,
      lastOutcomeStatus: "succeeded",
      lastOutcomeAt: "2026-04-15T12:05:00.000Z",
      lastOutcomeMessage: "Update set-image succeeded.",
    });

    await writeValidAnalysis(workDir, imageRef);
    await writeValidBuildResult(workDir, imageRef);
    await writeJsonFile(paths.state, makeDeployFacts("docker.io/example/demo-app:previous"));
    await writeJsonFile(paths.workflowState, workflowState);

    const result = await validateArtifactsStep(makeUpdateRuntimeState(workDir, imageRef));

    assert.equal(result.result.status, "success");
    assert.match(result.result.summary, /update-mode/i);
    assert.ok(!result.result.artifactPaths.includes(paths.templateFile));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
