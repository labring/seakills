import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  AnalysisArtifact,
  ArtifactPaths,
  SealosLastDeployRecord,
  SealosStateArtifact,
  ScriptExecutionResult,
  ValidateArtifactsOutput,
  WorkflowCheckpointRecord,
  WorkflowConfigArtifact,
  WorkflowPendingGate,
  WorkflowResumeValidationResult,
  WorkflowRuntimeStatus,
  WorkflowStatusPendingGateSummary,
  WorkflowStatusRetrySummary,
  WorkflowStatusSummary,
  WorkflowStepName,
  WorkflowStateArtifact,
  WorkflowUpdateAttemptOutcome,
  WorkflowUpdateAttemptRecord,
} from "../types";
import { runNodeScript } from "./runNodeScript";

export const RESUMABLE_WORKFLOW_STEPS: WorkflowStepName[] = [
  "assess",
  "detect-image",
  "build-push",
  "template",
  "deploy",
  "validate-artifacts",
];

export function getArtifactPaths(workDir: string): ArtifactPaths {
  const sealosDir = join(workDir, ".sealos");
  return {
    workDir,
    sealosDir,
    config: join(sealosDir, "config.json"),
    dockerfile: join(workDir, "Dockerfile"),
    analysis: join(sealosDir, "analysis.json"),
    buildDir: join(sealosDir, "build"),
    buildResult: join(sealosDir, "build", "build-result.json"),
    templateDir: join(sealosDir, "template"),
    templateFile: join(sealosDir, "template", "index.yaml"),
    state: join(sealosDir, "state.json"),
    workflowState: join(sealosDir, "workflow-state.json"),
  };
}

export async function ensureBaseArtifactDirs(paths: ArtifactPaths): Promise<void> {
  await mkdir(paths.templateDir, { recursive: true });
}

export async function ensureBuildDir(paths: ArtifactPaths): Promise<void> {
  await mkdir(paths.buildDir, { recursive: true });
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeAnalysisArtifact(
  paths: ArtifactPaths,
  analysis: AnalysisArtifact,
): Promise<ScriptExecutionResult<ValidateArtifactsOutput>> {
  await ensureBaseArtifactDirs(paths);
  await writeJsonFile(paths.analysis, analysis);
  return validateArtifacts(paths.workDir);
}

export async function updateAnalysisArtifact(
  paths: ArtifactPaths,
  update: (current: AnalysisArtifact) => AnalysisArtifact,
): Promise<ScriptExecutionResult<ValidateArtifactsOutput>> {
  const current = await readJsonFile<AnalysisArtifact>(paths.analysis);
  if (!current) {
    throw new Error(`Missing analysis artifact at ${paths.analysis}`);
  }
  await writeJsonFile(paths.analysis, update(current));
  return validateArtifacts(paths.workDir);
}

export async function copyTemplateArtifact(sourcePath: string, destinationPath: string): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
}

export async function readWorkflowStateArtifact(
  paths: ArtifactPaths,
): Promise<WorkflowStateArtifact | null> {
  return readJsonFile<WorkflowStateArtifact>(paths.workflowState);
}

export async function readStateArtifact(paths: ArtifactPaths): Promise<SealosStateArtifact | null> {
  return readJsonFile<SealosStateArtifact>(paths.state);
}

function normalizePendingGate(
  pendingGate: WorkflowStateArtifact["pending_gate"],
): WorkflowStatusPendingGateSummary | null {
  if (!pendingGate) {
    return null;
  }

  return {
    kind: pendingGate.kind,
    name: pendingGate.name,
    ...(pendingGate.step ? { step: pendingGate.step } : {}),
    status: pendingGate.status,
    prompt: pendingGate.prompt,
    created_at: pendingGate.created_at,
    expires_at: pendingGate.expires_at,
    resume_hint: pendingGate.resume_hint,
  };
}

function normalizeRetrySummary(
  updateAttempt: WorkflowStateArtifact["update_attempt"],
): WorkflowStatusRetrySummary | null {
  if (!updateAttempt) {
    return null;
  }

  const lastOutcomeStatus =
    updateAttempt.last_outcome_status
    ?? (updateAttempt.terminal_failure
      ? "failed"
      : updateAttempt.last_failure_at
        ? "retrying"
        : "running");
  const exhausted = updateAttempt.exhausted ?? updateAttempt.terminal_failure;
  const remainingAttempts = Math.max(updateAttempt.max_attempts - updateAttempt.attempt, 0);
  const summary = updateAttempt.terminal_failure || exhausted
    ? `Attempt ${updateAttempt.attempt}/${updateAttempt.max_attempts} exhausted the workflow retry policy and ended in terminal failure.`
    : lastOutcomeStatus === "succeeded" && updateAttempt.attempt > 1
      ? `Attempt ${updateAttempt.attempt}/${updateAttempt.max_attempts} succeeded after ${updateAttempt.attempt - 1} retry${updateAttempt.attempt === 2 ? "" : "ies"}.`
      : lastOutcomeStatus === "succeeded"
        ? `Attempt ${updateAttempt.attempt}/${updateAttempt.max_attempts} succeeded on the first try.`
        : lastOutcomeStatus === "running"
          ? `Attempt ${updateAttempt.attempt}/${updateAttempt.max_attempts} is in progress for update apply and rollout verification.`
          : remainingAttempts > 0
            ? `Attempt ${updateAttempt.attempt}/${updateAttempt.max_attempts}; ${remainingAttempts} retries remaining.`
            : `Attempt ${updateAttempt.attempt}/${updateAttempt.max_attempts}; no retries remaining.`;

  return {
    attempt: updateAttempt.attempt,
    max_attempts: updateAttempt.max_attempts,
    remaining_attempts: remainingAttempts,
    last_attempt_started_at: updateAttempt.last_attempt_started_at ?? null,
    last_outcome_status: lastOutcomeStatus,
    last_outcome_at: updateAttempt.last_outcome_at ?? updateAttempt.last_failure_at ?? null,
    last_outcome_message: updateAttempt.last_outcome_message ?? updateAttempt.last_failure_message ?? null,
    last_failure_at: updateAttempt.last_failure_at,
    last_failure_message: updateAttempt.last_failure_message,
    exhausted,
    terminal_failure: updateAttempt.terminal_failure,
    rollback_completed_at: updateAttempt.rollback_completed_at,
    summary,
  };
}

function normalizeLastDeploy(
  lastDeploy: SealosStateArtifact["last_deploy"] | null | undefined,
): SealosLastDeployRecord | null {
  return lastDeploy ?? null;
}

export function buildWorkflowStatusSummary(
  workflowState: WorkflowStateArtifact | null,
  deployState: SealosStateArtifact | null,
): WorkflowStatusSummary {
  return {
    workflow: "sealos-deploy",
    mode: workflowState?.execution_mode ?? null,
    runtime_status: workflowState?.status ?? null,
    current_step: workflowState?.current_step ?? null,
    pending_gate: normalizePendingGate(workflowState?.pending_gate ?? null),
    last_error: workflowState?.last_error ?? null,
    resume: workflowState?.resume ?? null,
    retry: normalizeRetrySummary(workflowState?.update_attempt ?? null),
    last_deploy: normalizeLastDeploy(deployState?.last_deploy),
  };
}

export async function readWorkflowStatusSummary(
  paths: ArtifactPaths,
): Promise<WorkflowStatusSummary> {
  const [workflowState, deployState] = await Promise.all([
    readWorkflowStateArtifact(paths),
    readStateArtifact(paths),
  ]);

  return buildWorkflowStatusSummary(workflowState, deployState);
}

export async function readWorkflowStatusSummaryForDir(
  workDir: string,
): Promise<WorkflowStatusSummary> {
  return readWorkflowStatusSummary(getArtifactPaths(workDir));
}

export async function readWorkflowConfigArtifact(
  paths: ArtifactPaths,
): Promise<WorkflowConfigArtifact | null> {
  return readJsonFile<WorkflowConfigArtifact>(paths.config);
}

export async function writeStateArtifact(
  paths: ArtifactPaths,
  state: SealosStateArtifact,
): Promise<ScriptExecutionResult<ValidateArtifactsOutput>> {
  await writeJsonFile(paths.state, state);
  return validateArtifacts(paths.workDir);
}

export async function writeWorkflowConfigArtifact(
  paths: ArtifactPaths,
  config: WorkflowConfigArtifact,
): Promise<ScriptExecutionResult<ValidateArtifactsOutput>> {
  await writeJsonFile(paths.config, config);
  return validateArtifacts(paths.workDir);
}

export async function writeWorkflowStateArtifact(
  paths: ArtifactPaths,
  state: WorkflowStateArtifact,
): Promise<ScriptExecutionResult<ValidateArtifactsOutput>> {
  await writeJsonFile(paths.workflowState, state);
  return validateArtifacts(paths.workDir);
}

export async function deleteWorkflowStateArtifact(paths: ArtifactPaths): Promise<void> {
  await rm(paths.workflowState, { force: true });
}

export function withPendingGate(
  workflowState: WorkflowStateArtifact,
  pendingGate: WorkflowPendingGate,
  updatedAt: string,
): WorkflowStateArtifact {
  return {
    ...workflowState,
    status: "waiting",
    current_step: null,
    last_error: null,
    pending_gate: pendingGate,
    updated_at: updatedAt,
    completed_at: null,
  };
}

export function clearPendingGate(
  workflowState: WorkflowStateArtifact,
  updatedAt: string,
  nextStatus: WorkflowRuntimeStatus = "running",
): WorkflowStateArtifact {
  return {
    ...workflowState,
    status: nextStatus,
    pending_gate: null,
    updated_at: updatedAt,
  };
}

export function createWorkflowUpdateRetryRecord(params: {
  attempt: number;
  maxAttempts: number;
  lastAttemptStartedAt?: string | null;
  lastOutcomeStatus?: WorkflowUpdateAttemptOutcome;
  lastOutcomeAt?: string | null;
  lastOutcomeMessage?: string | null;
  lastFailureAt?: string | null;
  lastFailureMessage?: string | null;
  exhausted?: boolean;
  terminalFailure?: boolean;
  rollbackCompletedAt?: string | null;
}): WorkflowUpdateAttemptRecord {
  return {
    attempt: params.attempt,
    max_attempts: params.maxAttempts,
    last_attempt_started_at: params.lastAttemptStartedAt ?? null,
    last_outcome_status: params.lastOutcomeStatus ?? "running",
    last_outcome_at: params.lastOutcomeAt ?? null,
    last_outcome_message: params.lastOutcomeMessage ?? null,
    last_failure_at: params.lastFailureAt ?? null,
    last_failure_message: params.lastFailureMessage ?? null,
    exhausted: params.exhausted ?? false,
    terminal_failure: params.terminalFailure ?? false,
    rollback_completed_at: params.rollbackCompletedAt ?? null,
  };
}

export function withWorkflowUpdateRetry(
  workflowState: WorkflowStateArtifact,
  retryState: WorkflowUpdateAttemptRecord | null,
  updatedAt: string,
): WorkflowStateArtifact {
  return {
    ...workflowState,
    update_attempt: retryState,
    updated_at: updatedAt,
  };
}

export function isExpiredTimestamp(timestamp: string | null, now = Date.now()) {
  if (!timestamp) {
    return false;
  }

  const parsed = Date.parse(timestamp);
  return !Number.isNaN(parsed) && parsed <= now;
}

function buildMigrationCheckpoint(
  step: WorkflowCheckpointRecord["step"],
  artifactPaths: string[],
  completedAt: string,
  imageRef: string | null,
): WorkflowCheckpointRecord {
  return {
    step,
    status: "success",
    completed_at: completedAt,
    artifact_paths: artifactPaths,
    summary: `Migrated ${step} from legacy .sealos artifact presence via artifact-presence-bridge.`,
    ...(imageRef ? { image_ref: imageRef } : {}),
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function validateCheckpointArtifactPaths(checkpoint: WorkflowStateArtifact["checkpoints"][number]) {
  for (const artifactPath of checkpoint.artifact_paths) {
    if (!(await fileExists(artifactPath))) {
      return {
        valid: false,
        message: `Checkpoint '${checkpoint.step}' is missing artifact ${artifactPath}.`,
      };
    }
  }

  return { valid: true as const };
}

async function validateResumeCheckpoint(
  paths: ArtifactPaths,
  checkpoint: WorkflowStateArtifact["checkpoints"][number],
) {
  const artifactPathValidation = await validateCheckpointArtifactPaths(checkpoint);
  if (!artifactPathValidation.valid) {
    return artifactPathValidation;
  }

  switch (checkpoint.step) {
    case "assess": {
      const analysis = await readJsonFile<AnalysisArtifact>(paths.analysis);
      if (!analysis) {
        return {
          valid: false,
          message: "Checkpoint 'assess' requires .sealos/analysis.json.",
        };
      }
      return { valid: true as const };
    }
    case "detect-image": {
      const analysis = await readJsonFile<AnalysisArtifact>(paths.analysis);
      if (!analysis) {
        return {
          valid: false,
          message: "Checkpoint 'detect-image' requires .sealos/analysis.json.",
        };
      }
      return { valid: true as const };
    }
    case "build-push": {
      const buildResult = await readJsonFile<{ outcome?: string }>(paths.buildResult);
      if (!buildResult || buildResult.outcome !== "success") {
        return {
          valid: false,
          message: "Checkpoint 'build-push' requires .sealos/build/build-result.json with outcome \"success\".",
        };
      }
      return { valid: true as const };
    }
    case "template": {
      if (!(await fileExists(paths.templateFile))) {
        return {
          valid: false,
          message: "Checkpoint 'template' requires .sealos/template/index.yaml.",
        };
      }
      return { valid: true as const };
    }
    case "deploy": {
      const deployState = await readStateArtifact(paths);
      const latestHistory = deployState?.history[deployState.history.length - 1];
      if (
        !deployState?.last_deploy.app_name
        || !deployState.last_deploy.image
        || !latestHistory
        || latestHistory.status !== "success"
        || latestHistory.image !== checkpoint.image_ref
      ) {
        return {
          valid: false,
          message:
            "Checkpoint 'deploy' requires .sealos/state.json with last_deploy facts and a latest successful history entry matching the checkpoint image.",
        };
      }
      return { valid: true as const };
    }
    case "validate-artifacts": {
      const validation = await validateArtifacts(paths.workDir);
      if (!validation.stdoutJson.valid) {
        return {
          valid: false,
          message: `Checkpoint 'validate-artifacts' requires validate-artifacts.mjs --dir ${paths.workDir} to report valid: true.`,
        };
      }
      return { valid: true as const };
    }
    default:
      return { valid: true as const };
  }
}

export async function validateWorkflowResumeState(
  paths: ArtifactPaths,
  workflowState: WorkflowStateArtifact,
): Promise<WorkflowResumeValidationResult> {
  const checkpointMap = new Map(
    workflowState.checkpoints.map((checkpoint) => [checkpoint.step, checkpoint]),
  );

  for (const step of RESUMABLE_WORKFLOW_STEPS) {
    const checkpoint = checkpointMap.get(step);
    if (!checkpoint) {
      return {
        canResume: true,
        resumeFromStep: step,
      };
    }

    const validation = await validateResumeCheckpoint(paths, checkpoint);
    if (!validation.valid) {
      return {
        canResume: false,
        resumeFromStep: null,
        failedCheckpoint: step,
        message: validation.message,
      };
    }
  }

  return {
    canResume: true,
    resumeFromStep: null,
  };
}

export async function seedWorkflowStateFromLegacyArtifacts(
  paths: ArtifactPaths,
  runId: string,
): Promise<WorkflowStateArtifact | null> {
  const existingWorkflowState = await readWorkflowStateArtifact(paths);
  if (existingWorkflowState) {
    return existingWorkflowState;
  }

  const analysis = await readJsonFile<AnalysisArtifact>(paths.analysis);
  const buildResult = await readJsonFile<{ outcome?: string }>(paths.buildResult);
  const hasTemplate = await fileExists(paths.templateFile);
  const imageRef = analysis?.image_ref ?? null;
  const completedAt = new Date().toISOString();
  const checkpoints: WorkflowCheckpointRecord[] = [];

  if (analysis) {
    checkpoints.push(buildMigrationCheckpoint("assess", [paths.analysis], completedAt, imageRef));
  }

  if (analysis?.image_ref) {
    checkpoints.push(buildMigrationCheckpoint("detect-image", [paths.analysis], completedAt, analysis.image_ref));
  }

  if (buildResult?.outcome === "success") {
    checkpoints.push(
      buildMigrationCheckpoint(
        "build-push",
        analysis ? [paths.buildResult, paths.analysis] : [paths.buildResult],
        completedAt,
        imageRef,
      ),
    );
  }

  if (hasTemplate) {
    checkpoints.push(buildMigrationCheckpoint("template", [paths.templateFile], completedAt, imageRef));
  }

  if (!checkpoints.length) {
    return null;
  }

  const checkpointMap = new Map(checkpoints.map((checkpoint) => [checkpoint.step, checkpoint]));
  const resumeFromStep =
    RESUMABLE_WORKFLOW_STEPS.find((step) => !checkpointMap.has(step)) ?? null;

  const workflowState: WorkflowStateArtifact = {
    version: "1.0",
    workflow: "sealos-deploy",
    run_id: runId,
    status: "resumable",
    execution_mode: "deploy",
    execution_summary: "Recovered workflow progress from legacy artifacts; continuing the fresh deploy path.",
    deployment_choice: null,
    update_target: null,
    update_attempt: null,
    current_step: null,
    steps_completed: checkpoints.map((checkpoint) => checkpoint.step),
    checkpoints,
    resume: {
      resume_from_step: resumeFromStep,
      resume_count: 0,
      last_resumed_at: null,
      migration_source: "artifact-presence-bridge",
    },
    last_error: null,
    pending_gate: null,
    started_at: completedAt,
    updated_at: completedAt,
    completed_at: null,
  };

  await writeWorkflowStateArtifact(paths, workflowState);
  return workflowState;
}

export async function validateArtifacts(workDir: string) {
  return runNodeScript<ValidateArtifactsOutput>(
    "scripts/validate-artifacts.mjs",
    ["--dir", workDir],
    { cwd: workDir },
  );
}
