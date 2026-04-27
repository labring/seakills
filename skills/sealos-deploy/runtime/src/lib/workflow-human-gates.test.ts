import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readWorkflowStateArtifact, getArtifactPaths, writeJsonFile } from "./artifacts";
import { normalizeWorkflowInput, normalizeWorkflowRunOptions, runSealosDeployDirect } from "../server";
import { createWorkflowStateArtifact, createDeployInputsGate, getDeployInputPayload } from "../workflows/sealosDeploy";
import type {
  SealosDeployWorkflowInput,
  WorkflowCheckpointRecord,
  WorkflowRuntimeState,
  WorkflowStateArtifact,
} from "../types";

function makeInput(workDir: string): SealosDeployWorkflowInput {
  return normalizeWorkflowInput({
    workDir,
    dryRun: false,
    title: "Human gate test",
    categories: ["backend"],
  });
}

async function makeFixtureRoot(prefix: string) {
  return mkdtemp(join(tmpdir(), prefix));
}

function futureTimestamp(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function makeRuntimeState(workDir: string): WorkflowRuntimeState {
  return {
    input: makeInput(workDir),
    analysis: {
      generated_at: "2026-04-15T09:00:00.000Z",
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
      env_vars: {
        API_KEY: { category: "required" },
        NODE_ENV: { category: "optional", default: "production" },
      },
      has_dockerfile: false,
      complexity_tier: "L1",
      image_ref: null,
    },
    config: undefined,
    imageRef: null,
    executionMode: "deploy",
    executionSummary: "Running fresh deploy path for this workflow run.",
    deploymentChoice: null,
    updateTarget: null,
    region: "https://cloud.example.com",
    workspace: "ns-current",
    resumeInput: {},
    stepResults: [],
    stepsCompleted: ["preflight", "assess"],
  };
}

test("deploy-input payload captures unresolved fields and required env", async () => {
  const workDir = await makeFixtureRoot("sealos-human-gates-payload-");
  try {
    const runtimeState = makeRuntimeState(workDir);
    const payload = getDeployInputPayload(runtimeState, null);
    const gate = createDeployInputsGate(payload, "2026-04-15T09:05:00.000Z");

    assert.equal(gate.name, "deploy-inputs");
    assert.equal(gate.payload.workspace, "ns-current");
    assert.deepEqual(payload.required_env, ["API_KEY"]);
    assert.ok(payload.unresolved_fields.includes("build_command"));
    assert.ok(payload.unresolved_fields.includes("start_command"));
    assert.ok(payload.unresolved_fields.includes("base_image"));
    assert.ok(payload.unresolved_fields.includes("env_overrides"));
    assert.ok(!payload.unresolved_fields.includes("port"));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("run options preserve workspace, config overrides, env overrides, and approval submissions", () => {
  const options = normalizeWorkflowRunOptions({
    resume: true,
    workspace: "ns-demo",
    config_overrides: {
      port: 8080,
      build_command: "pnpm build",
      start_command: "pnpm start",
      base_image: "node:22-slim",
    },
    env_overrides: {
      API_KEY: "secret",
    },
    approval: "approve",
  });

  assert.equal(options.startMode, "resume");
  assert.equal(options.resumeInput?.workspace, "ns-demo");
  assert.equal(options.resumeInput?.config_overrides?.port, 8080);
  assert.equal(options.resumeInput?.env_overrides?.API_KEY, "secret");
  assert.equal(options.resumeInput?.approval, "approve");
});

async function writePendingAuthGate(workDir: string, gate: WorkflowStateArtifact["pending_gate"]) {
  const paths = {
    workflowState: join(workDir, ".sealos", "workflow-state.json"),
  };
  await mkdir(join(workDir, ".sealos"), { recursive: true });
  const workflowState = createWorkflowStateArtifact("run-human-gates", "2026-04-15T09:00:00.000Z");
  workflowState.status = "waiting";
  workflowState.pending_gate = gate;
  await writeJsonFile(paths.workflowState, workflowState);
}

async function writeAuthenticatedHomeFixture(homeDir: string) {
  const sealosHome = join(homeDir, ".sealos");
  await mkdir(sealosHome, { recursive: true });
  await writeFile(join(sealosHome, "kubeconfig"), [
    "apiVersion: v1",
    "clusters:",
    "  - name: demo",
    "    cluster:",
    "      server: https://cloud.example.com",
    "users:",
    "  - name: demo",
    "    user:",
    "      token: demo-token",
  ].join("\n"), "utf8");
  await writeFile(join(sealosHome, "auth.json"), JSON.stringify({
    region: "https://cloud.example.com",
    current_workspace: {
      id: "ns-current",
      uid: "ns-current-uid",
      teamName: "Current Team",
    },
  }, null, 2), "utf8");
}

function makeCheckpoint(
  step: WorkflowCheckpointRecord["step"],
  artifactPaths: string[],
  imageRef?: string,
): WorkflowCheckpointRecord {
  return {
    step,
    status: "success",
    completed_at: "2026-04-15T09:02:00.000Z",
    artifact_paths: artifactPaths,
    summary: `${step} complete`,
    ...(imageRef ? { image_ref: imageRef } : {}),
  };
}

async function writeDeployApplyGateResumeFixture(workDir: string) {
  const paths = getArtifactPaths(workDir);
  const imageRef = "ghcr.io/example/demo-app:resume";
  const analysis = makeRuntimeState(workDir).analysis!;
  await mkdir(paths.templateDir, { recursive: true });
  await mkdir(paths.buildDir, { recursive: true });
  await writeFile(join(workDir, "package.json"), JSON.stringify({ name: "demo-app" }), "utf8");
  await writeAuthenticatedHomeFixture(workDir);
  await writeJsonFile(paths.analysis, {
    ...analysis,
    has_dockerfile: true,
    image_ref: imageRef,
  });
  await writeJsonFile(paths.buildResult, {
    outcome: "success",
    registry: "ghcr",
    build: {
      image_name: "demo-app",
      started_at: "2026-04-15T09:00:00.000Z",
    },
    push: {
      remote_image: imageRef,
      pushed_at: "2026-04-15T09:01:00.000Z",
    },
    finished_at: "2026-04-15T09:01:30.000Z",
  });
  await writeFile(paths.templateFile, "defaults:\n  app_name: demo-app\n  app_host: demo-app\n", "utf8");

  const workflowState = createWorkflowStateArtifact("run-downstream-gate", "2026-04-15T09:00:00.000Z");
  workflowState.status = "waiting";
  workflowState.current_step = "deploy";
  workflowState.steps_completed = ["assess", "detect-image", "build-push", "template"];
  workflowState.checkpoints = [
    makeCheckpoint("assess", [paths.analysis], imageRef),
    makeCheckpoint("detect-image", [paths.analysis], imageRef),
    makeCheckpoint("build-push", [paths.buildResult, paths.analysis], imageRef),
    makeCheckpoint("template", [paths.templateFile], imageRef),
  ];
  workflowState.resume.resume_from_step = "deploy";
  workflowState.resume.resume_count = 1;
  workflowState.resume.last_resumed_at = "2026-04-15T09:03:00.000Z";
  workflowState.pending_gate = {
    kind: "confirmation",
    name: "deploy-apply-confirmation",
    status: "waiting",
    prompt: "Confirm applying the generated deployment for demo-app.",
    payload: {
      image_ref: imageRef,
      workspace: "ns-current",
      approval_options: ["approve", "reject"],
    },
    created_at: "2026-04-15T09:04:00.000Z",
    expires_at: null,
    resume_hint: "Resume with --resume --approval approve to run deployTemplateStep.",
  };

  await writeJsonFile(paths.workflowState, workflowState);
}

test("expired auth gate blocks resume with a clear message", async () => {
  const workDir = await makeFixtureRoot("sealos-human-gates-expired-");
  try {
    await writeFile(join(workDir, "package.json"), JSON.stringify({ name: "demo-app", version: "0.0.1" }), "utf8");
    await writePendingAuthGate(workDir, {
      kind: "auth",
      name: "sealos-auth",
      status: "waiting",
      prompt: "Authorize Sealos access",
      payload: {
        region: "https://cloud.example.com",
        device_code: "device-123",
      },
      created_at: "2026-04-15T09:00:00.000Z",
      expires_at: "2020-04-15T09:00:30.000Z",
      resume_hint: "resume",
    });

    const result = await runSealosDeployDirect(makeInput(workDir), {
      startMode: "resume",
      runId: "run-human-gates",
    });

    assert.equal(result.status, "blocked");
    assert.match(result.message, /expired/i);
    assert.equal(result.pendingGate?.name, "sealos-auth");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("downstream pending gate survives preflight resume without workspace override", async () => {
  const workDir = await makeFixtureRoot("sealos-human-gates-downstream-");
  const previousHome = process.env.HOME;
  try {
    await writeDeployApplyGateResumeFixture(workDir);
    process.env.HOME = workDir;

    const result = await runSealosDeployDirect(makeInput(workDir), {
      startMode: "resume",
      runId: "run-downstream-gate",
    });
    const workflowState = await readWorkflowStateArtifact(getArtifactPaths(workDir));

    assert.equal(result.status, "waiting");
    assert.equal(result.pendingGate?.name, "deploy-apply-confirmation");
    assert.equal(workflowState?.pending_gate?.name, "deploy-apply-confirmation");
  } finally {
    process.env.HOME = previousHome;
    await rm(workDir, { recursive: true, force: true });
  }
});

test("stale auth gate with region mismatch blocks resume safely", async () => {
  const workDir = await makeFixtureRoot("sealos-human-gates-region-");
  try {
    await writeFile(join(workDir, "package.json"), JSON.stringify({ name: "demo-app", version: "0.0.1" }), "utf8");
    await writePendingAuthGate(workDir, {
      kind: "auth",
      name: "sealos-auth",
      status: "waiting",
      prompt: "Authorize Sealos access",
      payload: {
        region: "https://cloud.example.com",
        device_code: "device-123",
      },
      created_at: "2026-04-15T09:00:00.000Z",
      expires_at: futureTimestamp(),
      resume_hint: "resume",
    });

    const result = await runSealosDeployDirect(makeInput(workDir), {
      startMode: "resume",
      runId: "run-human-gates",
      resumeInput: {
        region: "https://other.example.com",
      },
    });

    assert.equal(result.status, "blocked");
    assert.match(result.message, /created for/i);
    assert.equal(result.pendingGate?.name, "sealos-auth");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("restart confirmation supports cancel without looping forever", async () => {
  const workDir = await makeFixtureRoot("sealos-human-gates-restart-cancel-");
  try {
    await writeFile(join(workDir, "package.json"), JSON.stringify({ name: "demo-app", version: "0.0.1" }), "utf8");
    await writePendingAuthGate(workDir, {
      kind: "confirmation",
      name: "restart-confirmation",
      status: "waiting",
      prompt: "Checkpoint mismatch. Restart is required before this run can continue.",
      payload: {
        failed_checkpoint: "deploy",
        approval_options: ["restart", "cancel"],
      },
      created_at: "2026-04-15T09:00:00.000Z",
      expires_at: null,
      resume_hint: "resume",
    });

    const result = await runSealosDeployDirect(makeInput(workDir), {
      startMode: "resume",
      runId: "run-human-gates",
      resumeInput: {
        approval: "cancel",
      },
    });
    const workflowState = await readWorkflowStateArtifact(getArtifactPaths(workDir));

    assert.equal(result.status, "blocked");
    assert.match(result.message, /cancelled/i);
    assert.equal(result.pendingGate, null);
    assert.equal(workflowState?.status, "failed");
    assert.equal(workflowState?.pending_gate, null);
    assert.equal(workflowState?.last_error?.step, "deploy");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("restart cancel falls back safely when failed checkpoint payload is unknown", async () => {
  const workDir = await makeFixtureRoot("sealos-human-gates-restart-unknown-");
  try {
    await writeFile(join(workDir, "package.json"), JSON.stringify({ name: "demo-app", version: "0.0.1" }), "utf8");
    await writePendingAuthGate(workDir, {
      kind: "confirmation",
      name: "restart-confirmation",
      step: "preflight",
      status: "waiting",
      prompt: "Checkpoint mismatch. Restart is required before this run can continue.",
      payload: {
        failed_checkpoint: "unknown-step",
        approval_options: ["restart", "cancel"],
      },
      created_at: "2026-04-15T09:00:00.000Z",
      expires_at: null,
      resume_hint: "resume",
    });

    const result = await runSealosDeployDirect(makeInput(workDir), {
      startMode: "resume",
      runId: "run-human-gates",
      resumeInput: {
        approval: "cancel",
      },
    });
    const workflowState = await readWorkflowStateArtifact(getArtifactPaths(workDir));

    assert.equal(result.status, "blocked");
    assert.equal(workflowState?.status, "failed");
    assert.equal(workflowState?.last_error?.step, "preflight");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
