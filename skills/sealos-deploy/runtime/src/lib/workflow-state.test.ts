import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildWorkflowStatusSummary,
  getArtifactPaths,
  validateWorkflowResumeState,
  writeJsonFile,
} from "./artifacts";
import {
  buildRecoveryCommand,
  buildStatusCommand,
  getOperatorGuidePath,
} from "./operatorGuidance";
import { parseArgs } from "../cli/startRun";
import { normalizeWorkflowRunOptions, runSealosDeployDirect } from "../server";
import {
  applyWorkflowCheckpoint,
  createWorkflowStateArtifact,
  isResumableStep,
  markWorkflowStepRunning,
  prepareWorkflowExecution,
} from "../workflows/sealosDeploy";
import type {
  SealosDeployWorkflowInput,
  WorkflowCheckpointRecord,
  WorkflowStateArtifact,
} from "../types";

async function makeTempWorkDir() {
  return mkdtemp(join(tmpdir(), "sealos-workflow-state-"));
}

function makeInput(workDir: string): SealosDeployWorkflowInput {
  return {
    workDir,
    repoName: "demo-app",
    githubUrl: null,
    branch: "main",
    dryRun: true,
    title: "demo-app",
    description: "test",
    url: undefined,
    author: "Seakills",
    categories: ["backend"],
  };
}

function makeCheckpoint(
  step: WorkflowCheckpointRecord["step"],
  artifactPaths: string[],
  imageRef?: string,
): WorkflowCheckpointRecord {
  return {
    step,
    status: "success",
    completed_at: "2026-04-14T10:00:00.000Z",
    artifact_paths: artifactPaths,
    summary: `${step} complete`,
    ...(imageRef ? { image_ref: imageRef } : {}),
  };
}

test("fresh workflow state initializes run_id, current_step, and resume metadata", () => {
  const startedAt = "2026-04-14T10:00:00.000Z";
  const workflowState = createWorkflowStateArtifact("run-123", startedAt);
  const runningState = markWorkflowStepRunning(
    workflowState,
    "assess",
    "2026-04-14T10:01:00.000Z",
  );

  assert.equal(workflowState.run_id, "run-123");
  assert.equal(workflowState.resume.resume_from_step, null);
  assert.equal(workflowState.resume.resume_count, 0);
  assert.equal(runningState.current_step, "assess");
  assert.equal(runningState.status, "running");
});

test("successful resumable checkpoints record steps_completed and artifact_paths", () => {
  const workflowState = createWorkflowStateArtifact("run-456", "2026-04-14T10:00:00.000Z");
  const checkpointed = applyWorkflowCheckpoint(
    workflowState,
    makeCheckpoint("assess", ["/tmp/project/.sealos/analysis.json"]),
    "2026-04-14T10:02:00.000Z",
  );

  assert.deepEqual(checkpointed.steps_completed, ["assess"]);
  assert.deepEqual(checkpointed.checkpoints[0].artifact_paths, ["/tmp/project/.sealos/analysis.json"]);
  assert.equal(checkpointed.checkpoints[0].summary, "assess complete");
});

test("preflight and dockerfile stay replay-only instead of resumable checkpoints", () => {
  assert.equal(isResumableStep("preflight"), false);
  assert.equal(isResumableStep("dockerfile"), false);
  assert.equal(isResumableStep("assess"), true);
  assert.equal(isResumableStep("deploy"), true);
});

test("detect-image checkpoint can resume when no reusable image was found", async () => {
  const workDir = await makeTempWorkDir();
  const paths = getArtifactPaths(workDir);
  try {
    await mkdir(paths.sealosDir, { recursive: true });
    await writeJsonFile(paths.analysis, {
      generated_at: "2026-04-24T10:00:00.000Z",
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
      package_manager: "npm",
      port: 3000,
      databases: [],
      runtime_version: {
        node: "22",
        source: "test",
      },
      env_vars: {},
      has_dockerfile: false,
      complexity_tier: "L1",
      image_ref: null,
    });

    const workflowState = createWorkflowStateArtifact("run-no-image", "2026-04-24T10:00:00.000Z");
    workflowState.checkpoints = [
      makeCheckpoint("assess", [paths.analysis]),
      makeCheckpoint("detect-image", [paths.analysis]),
    ];
    workflowState.steps_completed = ["assess", "detect-image"];

    const validation = await validateWorkflowResumeState(paths, workflowState);
    assert.equal(validation.canResume, true);
    assert.equal(validation.resumeFromStep, "build-push");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("deploy checkpoint mismatch blocks resume until restart is explicit", async () => {
  const workDir = await makeTempWorkDir();
  const paths = getArtifactPaths(workDir);
  const input = makeInput(workDir);
  const imageRef = "ghcr.io/example/demo-app:phase2";

  try {
    await mkdir(paths.templateDir, { recursive: true });
    await mkdir(paths.buildDir, { recursive: true });

    await writeJsonFile(paths.analysis, {
      generated_at: "2026-04-14T10:00:00.000Z",
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
      package_manager: "npm",
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
    await writeJsonFile(paths.buildResult, {
      outcome: "success",
      registry: "ghcr",
      build: {
        image_name: "demo-app",
        started_at: "2026-04-14T10:00:00.000Z",
      },
      push: {
        remote_image: imageRef,
        pushed_at: "2026-04-14T10:00:30.000Z",
      },
      finished_at: "2026-04-14T10:01:00.000Z",
    });
    await writeFile(paths.templateFile, "defaults:\n  app_name: demo-app\n  app_host: demo-app\n", "utf8");

    const workflowState: WorkflowStateArtifact = {
      version: "1.0",
      workflow: "sealos-deploy",
      run_id: "run-old",
      status: "failed",
      execution_mode: "deploy",
      execution_summary: "Running fresh deploy path for this workflow run.",
      deployment_choice: null,
      update_target: null,
      update_attempt: null,
      current_step: null,
      steps_completed: ["assess", "detect-image", "build-push", "template", "deploy"],
      checkpoints: [
        makeCheckpoint("assess", [paths.analysis], imageRef),
        makeCheckpoint("detect-image", [paths.analysis], imageRef),
        makeCheckpoint("build-push", [paths.buildResult, paths.analysis], imageRef),
        makeCheckpoint("template", [paths.templateFile], imageRef),
        makeCheckpoint("deploy", [paths.templateFile, paths.state], imageRef),
      ],
      resume: {
        resume_from_step: "deploy",
        resume_count: 1,
        last_resumed_at: "2026-04-14T10:05:00.000Z",
        migration_source: null,
      },
      last_error: {
        step: "deploy",
        message: "deploy mismatch",
        at: "2026-04-14T10:05:00.000Z",
      },
      pending_gate: null,
      started_at: "2026-04-14T10:00:00.000Z",
      updated_at: "2026-04-14T10:05:00.000Z",
      completed_at: null,
    };

    await writeJsonFile(paths.workflowState, workflowState);
    await writeJsonFile(paths.state, {
      version: "1.0",
      last_deploy: {
        app_name: "demo-app",
        app_host: "demo-app",
        namespace: "ns-demo",
        region: "example.com",
        image: "ghcr.io/example/demo-app:stale",
        docker_hub_user: null,
        repo_name: "demo-app",
        url: "https://demo-app.example.com",
        deployed_at: "2026-04-14T09:55:00.000Z",
        last_updated_at: "2026-04-14T09:55:00.000Z",
      },
      history: [
        {
          at: "2026-04-14T09:55:00.000Z",
          action: "deploy",
          image: "ghcr.io/example/demo-app:stale",
          method: "template-api",
          status: "success",
          note: "Initial deployment",
        },
      ],
    });

    const validation = await validateWorkflowResumeState(paths, workflowState);
    assert.equal(validation.canResume, false);
    assert.equal(validation.failedCheckpoint, "deploy");
    assert.match(validation.message ?? "", /last_deploy/i);

    const autoPrepared = await prepareWorkflowExecution(input, { startMode: "auto", runId: "run-new" });
    assert.equal(autoPrepared.workflowState.pending_gate?.name, "restart-confirmation");
    assert.match(autoPrepared.workflowState.pending_gate?.prompt ?? "", /restart/i);

    const directRun = await runSealosDeployDirect(input, { startMode: "auto", runId: "run-direct" });
    assert.equal(directRun.status, "waiting");
    assert.equal(directRun.pendingGate?.name, "restart-confirmation");

    const restarted = await prepareWorkflowExecution(input, { startMode: "restart", runId: "run-restart" });
    assert.equal(restarted.workflowState.run_id, "run-restart");
    assert.equal(restarted.resumeFromStep, null);
    assert.deepEqual(restarted.workflowState.steps_completed, []);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("direct and server-backed entry surfaces preserve resume and restart semantics", () => {
  assert.equal(parseArgs(["--dir", "/tmp/demo"]).startMode, "auto");
  assert.equal(parseArgs(["--dir", "/tmp/demo", "--resume"]).startMode, "resume");
  assert.equal(parseArgs(["--dir", "/tmp/demo", "--restart"]).startMode, "restart");

  assert.equal(normalizeWorkflowRunOptions({ resume: true }).startMode, "resume");
  assert.equal(normalizeWorkflowRunOptions({ restart: true }).startMode, "restart");
  assert.equal(normalizeWorkflowRunOptions({}).startMode, "auto");

  assert.throws(
    () => parseArgs(["--dir", "/tmp/demo", "--resume", "--restart"]),
    /cannot be used together/i,
  );
  assert.throws(
    () => normalizeWorkflowRunOptions({ resume: true, restart: true }),
    /cannot both be true/i,
  );
});

test("operator guidance uses concrete runtime paths and gate-specific recovery commands", () => {
  const workDir = "/tmp/demo app";

  assert.match(buildStatusCommand(workDir), /status:run --dir '\/tmp\/demo app'/);
  assert.match(getOperatorGuidePath(), /docs\/sealos-deploy-workflow\.md$/);
  assert.match(
    buildRecoveryCommand(workDir, { name: "workspace-selection" }),
    /--resume --workspace <workspace-id>$/,
  );
  assert.match(
    buildRecoveryCommand(workDir, { name: "deploy-inputs" }),
    /--resume --config-overrides '<json>' --env-overrides '<json>'$/,
  );
});

test("status summary normalizes workflow runtime, pending gate, retry, and last deploy facts", () => {
  const workflowState = createWorkflowStateArtifact("run-status", "2026-04-15T10:00:00.000Z");
  workflowState.execution_mode = "update";
  workflowState.status = "waiting";
  workflowState.current_step = "deploy";
  workflowState.pending_gate = {
    kind: "confirmation",
    name: "deploy-apply-confirmation",
    status: "waiting",
    prompt: "Confirm deploy apply.",
    payload: {},
    created_at: "2026-04-15T10:05:00.000Z",
    expires_at: null,
    resume_hint: "Resume with --resume --approval apply.",
  };
  workflowState.last_error = {
    step: "deploy",
    message: "rollout failed",
    at: "2026-04-15T10:06:00.000Z",
  };
  workflowState.resume = {
    resume_from_step: "deploy",
    resume_count: 2,
    last_resumed_at: "2026-04-15T10:04:00.000Z",
    migration_source: null,
  };
  workflowState.update_attempt = {
    attempt: 2,
    max_attempts: 3,
    last_failure_at: "2026-04-15T10:06:00.000Z",
    last_failure_message: "rollout failed",
    terminal_failure: false,
    rollback_completed_at: null,
  };

  const summary = buildWorkflowStatusSummary(workflowState, {
    version: "1.0",
    last_deploy: {
      app_name: "demo-app",
      app_host: "demo-app",
      namespace: "ns-demo",
      region: "https://cloud.example.com",
      image: "ghcr.io/example/demo-app:prev",
      docker_hub_user: null,
      repo_name: "demo-app",
      url: "https://demo-app.example.com",
      deployed_at: "2026-04-15T09:00:00.000Z",
      last_updated_at: "2026-04-15T09:30:00.000Z",
    },
    history: [],
  });

  assert.equal(summary.workflow, "sealos-deploy");
  assert.equal(summary.mode, "update");
  assert.equal(summary.runtime_status, "waiting");
  assert.equal(summary.current_step, "deploy");
  assert.equal(summary.pending_gate?.name, "deploy-apply-confirmation");
  assert.equal(summary.last_error?.message, "rollout failed");
  assert.equal(summary.resume?.resume_count, 2);
  assert.equal(summary.retry?.remaining_attempts, 1);
  assert.match(summary.retry?.summary ?? "", /1 retries remaining/i);
  assert.equal(summary.last_deploy?.app_name, "demo-app");
});
