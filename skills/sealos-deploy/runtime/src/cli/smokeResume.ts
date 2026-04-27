import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exit } from "node:process";

import {
  getArtifactPaths,
  readWorkflowStateArtifact,
  writeJsonFile,
} from "../lib/artifacts";
import { normalizeWorkflowInput, prepareWorkflowLaunch, runSealosDeployDirect } from "../server";
import type {
  AnalysisArtifact,
  BuildPushOutput,
  SealosDeployWorkflowInput,
  WorkflowCheckpointRecord,
  WorkflowStateArtifact,
} from "../types";

const IMAGE_REF = "ghcr.io/example/demo-app:phase2";

function makeInput(workDir: string): SealosDeployWorkflowInput {
  return normalizeWorkflowInput({
    workDir,
    dryRun: true,
    title: "Phase 2 Resume Smoke",
    description: "Fixture-backed smoke validation for artifact-presence-bridge and workflow-state resume",
    categories: ["backend"],
  });
}

async function createFixtureRoot(prefix: string) {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeAuthenticatedSealosFixture(workDir: string) {
  const sealosHome = join(workDir, ".sealos");
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
    regional_token: "demo-regional-token",
    current_workspace: {
      id: "ns-demo",
      uid: "ns-demo-uid",
      teamName: "Demo Team",
    },
  }, null, 2), "utf8");
}

async function writeValidAnalysisArtifact(workDir: string, imageRef: string | null) {
  const paths = getArtifactPaths(workDir);
  const analysis: AnalysisArtifact = {
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
      source: "smoke",
    },
    env_vars: {},
    has_dockerfile: true,
    complexity_tier: "L1",
    image_ref: imageRef,
  };

  await writeJsonFile(paths.analysis, analysis);
}

async function writeValidBuildArtifact(workDir: string, imageRef: string) {
  const paths = getArtifactPaths(workDir);
  await mkdir(paths.buildDir, { recursive: true });
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
  } satisfies {
    outcome: "success";
    registry: BuildPushOutput["registry"];
    build: { image_name: string; started_at: string };
    push: { remote_image: string; pushed_at: string };
    finished_at: string;
  });
}

async function writeTemplateArtifact(workDir: string) {
  const paths = getArtifactPaths(workDir);
  await mkdir(paths.templateDir, { recursive: true });
  await writeFile(
    paths.templateFile,
    [
      "apiVersion: templates.sealos.io/v1beta1",
      "kind: Template",
      "metadata:",
      "  name: demo-app",
      "spec:",
      "  title: demo-app",
      "  defaults:",
      "    app_name: demo-app",
      "    app_host: demo-app",
      "  inputs: []",
      "  outputs: []",
    ].join("\n"),
    "utf8",
  );
}

function makeCheckpoint(
  step: WorkflowCheckpointRecord["step"],
  artifactPaths: string[],
  imageRef?: string,
): WorkflowCheckpointRecord {
  return {
    step,
    status: "success",
    completed_at: "2026-04-14T10:02:00.000Z",
    artifact_paths: artifactPaths,
    summary: `${step} migrated via artifact-presence-bridge`,
    ...(imageRef ? { image_ref: imageRef } : {}),
  };
}

async function writeTemplateCheckpointWorkflowState(workDir: string) {
  const paths = getArtifactPaths(workDir);
  const workflowState: WorkflowStateArtifact = {
    version: "1.0",
    workflow: "sealos-deploy",
    run_id: "resume-template-run",
    status: "resumable",
    execution_mode: "deploy",
    execution_summary: "Running fresh deploy path for this workflow run.",
    deployment_choice: null,
    update_target: null,
    update_attempt: null,
    current_step: null,
    steps_completed: ["assess", "detect-image", "build-push", "template"],
    checkpoints: [
      makeCheckpoint("assess", [paths.analysis], IMAGE_REF),
      makeCheckpoint("detect-image", [paths.analysis], IMAGE_REF),
      makeCheckpoint("build-push", [paths.buildResult, paths.analysis], IMAGE_REF),
      makeCheckpoint("template", [paths.templateFile], IMAGE_REF),
    ],
    resume: {
      resume_from_step: "deploy",
      resume_count: 1,
      last_resumed_at: "2026-04-14T10:03:00.000Z",
      migration_source: null,
    },
    last_error: null,
    pending_gate: null,
    started_at: "2026-04-14T10:00:00.000Z",
    updated_at: "2026-04-14T10:03:00.000Z",
    completed_at: null,
  };

  await writeJsonFile(paths.workflowState, workflowState);
}

async function writeInvalidDeployFacts(workDir: string) {
  const paths = getArtifactPaths(workDir);
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
}

async function createLegacyArtifactFixture(options: {
  withWorkflowState?: boolean;
  withInvalidDeployFacts?: boolean;
  withoutWorkflowState?: boolean;
}) {
  const workDir = await createFixtureRoot("sealos-smoke-resume-");
  await mkdir(join(workDir, "src"), { recursive: true });
  await writeFile(join(workDir, "package.json"), JSON.stringify({
    name: "demo-app",
    version: "0.0.1",
    private: true,
  }, null, 2));

  await writeValidAnalysisArtifact(workDir, IMAGE_REF);
  await writeValidBuildArtifact(workDir, IMAGE_REF);
  await writeTemplateArtifact(workDir);
  await writeAuthenticatedSealosFixture(workDir);

  if (options.withWorkflowState) {
    await writeTemplateCheckpointWorkflowState(workDir);
  }

  if (options.withInvalidDeployFacts) {
    await writeInvalidDeployFacts(workDir);
  }

  if (options.withoutWorkflowState) {
    const paths = getArtifactPaths(workDir);
    await rm(paths.workflowState, { force: true });
  }

  return workDir;
}

async function runScenarioTemplateResume() {
  const workDir = await createLegacyArtifactFixture({ withWorkflowState: true });
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = workDir;
    const result = await runSealosDeployDirect(makeInput(workDir), {
      startMode: "auto",
      runId: "resume-template-run",
      resumeInput: {
        approval: "approve",
        workspace: "ns-demo",
      },
    });

    assert.equal(result.status, "success");
    assert.ok(result.stepResults.some((entry) => entry.step === "template" && entry.status === "skipped"));
    assert.ok(result.stepResults.some((entry) => entry.step === "deploy"));

    return {
      scenario: "workflow-state.json resume from template checkpoint",
      status: "passed",
      stepsCompleted: result.stepsCompleted,
    };
  } finally {
    process.env.HOME = previousHome;
    await rm(workDir, { recursive: true, force: true });
  }
}

async function runScenarioDeployMismatch() {
  const workDir = await createLegacyArtifactFixture({
    withWorkflowState: true,
    withInvalidDeployFacts: true,
  });
  const paths = getArtifactPaths(workDir);
  const previousHome = process.env.HOME;

  try {
    process.env.HOME = workDir;
    const workflowState = await readWorkflowStateArtifact(paths);
    assert.ok(workflowState);
    workflowState!.steps_completed.push("deploy");
    workflowState!.checkpoints.push(makeCheckpoint("deploy", [paths.templateFile, paths.state], IMAGE_REF));
    await writeJsonFile(paths.workflowState, workflowState);

    const result = await runSealosDeployDirect(makeInput(workDir), {
      startMode: "auto",
      runId: "deploy-mismatch-run",
      resumeInput: {
        workspace: "ns-demo",
      },
    });
    assert.equal(result.status, "waiting");
    assert.equal(result.pendingGate.name, "restart-confirmation");

    return {
      scenario: "deploy-checkpoint mismatch returns restart-confirmation",
      status: "passed",
    };
  } finally {
    process.env.HOME = previousHome;
    await rm(workDir, { recursive: true, force: true });
  }
}

async function runScenarioArtifactPresenceBridge() {
  const workDir = await createLegacyArtifactFixture({
    withWorkflowState: false,
    withoutWorkflowState: true,
  });
  try {
    const input = makeInput(workDir);
    const runOptions = await prepareWorkflowLaunch(input, {
      startMode: "auto",
      runId: "artifact-presence-bridge-run",
    });
    const workflowState = await readWorkflowStateArtifact(getArtifactPaths(workDir));

    assert.equal(runOptions.runId, "artifact-presence-bridge-run");
    assert.ok(workflowState);
    assert.equal(workflowState?.resume.migration_source, "artifact-presence-bridge");
    assert.equal(workflowState?.resume.resume_from_step, "deploy");
    assert.equal(workflowState?.resume.resume_count, 0);

    return {
      scenario: "artifact-only migration via artifact-presence-bridge",
      status: "passed",
      resume_from_step: workflowState?.resume.resume_from_step,
      migration_source: workflowState?.resume.migration_source,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function runScenarioStrictResumeWithoutSidecar() {
  const workDir = await createLegacyArtifactFixture({
    withWorkflowState: false,
    withoutWorkflowState: true,
  });

  try {
    await assert.rejects(
      () => runSealosDeployDirect(makeInput(workDir), { startMode: "resume", runId: "strict-resume-run" }),
      /workflow-state\.json does not exist/i,
    );

    return {
      scenario: "--resume fails when workflow-state.json is absent",
      status: "passed",
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const results = [
    await runScenarioTemplateResume(),
    await runScenarioDeployMismatch(),
    await runScenarioArtifactPresenceBridge(),
    await runScenarioStrictResumeWithoutSidecar(),
  ];

  console.log(JSON.stringify({
    smoke: "smoke:resume",
    artifactPresenceBridge: "artifact-presence-bridge",
    results,
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  exit(1);
});
