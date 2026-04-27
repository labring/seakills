import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { FatalError } from "workflow";

import type {
  AnalysisArtifact,
  DeployTemplateOutput,
  SealosDeployWorkflowBlockedResult,
  SealosDeployWorkflowResult,
  SealosDeployWorkflowWaitingResult,
  WorkflowConfigArtifact,
  SealosHistoryEntry,
  SealosStateArtifact,
  SealosDeployWorkflowInput,
  WorkflowCheckpointRecord,
  WorkflowExecutionMode,
  WorkflowPendingGate,
  WorkflowResumeInput,
  WorkflowRunOptions,
  WorkflowRuntimeState,
  WorkflowStateArtifact,
  WorkflowStepName,
  WorkflowStepResult,
  WorkflowUpdateTarget,
} from "../types";
import {
  RESUMABLE_WORKFLOW_STEPS,
  clearPendingGate,
  createWorkflowUpdateRetryRecord,
  deleteWorkflowStateArtifact,
  getArtifactPaths,
  isExpiredTimestamp,
  readJsonFile,
  readWorkflowConfigArtifact,
  readStateArtifact,
  readWorkflowStateArtifact,
  updateAnalysisArtifact,
  validateWorkflowResumeState,
  withPendingGate,
  withWorkflowUpdateRetry,
  writeWorkflowConfigArtifact,
  writeStateArtifact,
  writeWorkflowStateArtifact,
} from "../lib/artifacts";
import { runNodeScript, ScriptExecutionError } from "../lib/runNodeScript";
import { assessStep } from "../steps/assessStep";
import { buildPushStep } from "../steps/buildPushStep";
import { deployTemplateStep } from "../steps/deployTemplateStep";
import { detectImageStep } from "../steps/detectImageStep";
import { generateTemplateStep } from "../steps/generateTemplateStep";
import { prepareDockerfileStep } from "../steps/prepareDockerfileStep";
import { preflightStep } from "../steps/preflightStep";
import { validateArtifactsStep } from "../steps/validateArtifactsStep";

const execFileAsync = promisify(execFile);

type StepExecutor = (state: WorkflowRuntimeState) => Promise<{
  state: WorkflowRuntimeState;
  result: WorkflowRuntimeState["stepResults"][number];
}>;

interface StepDefinition {
  step: WorkflowStepName;
  execute: StepExecutor;
}

interface PreparedExecution {
  runtimeState: WorkflowRuntimeState;
  workflowState: WorkflowStateArtifact;
  resumeFromStep: WorkflowStepName | null;
}

interface PendingGateResolution {
  state: WorkflowRuntimeState;
  workflowState: WorkflowStateArtifact;
  outcome?: SealosDeployWorkflowWaitingResult | SealosDeployWorkflowBlockedResult;
}

interface SealosSkillConfig {
  default_region: string;
  regions: string[];
}

interface SealosAuthCheckOutput {
  authenticated: boolean;
  region?: string;
  workspace?: string;
  tools?: {
    kubectl?: boolean;
  };
}

interface BeginLoginOutput {
  action: string;
  region: string;
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  interval: number;
  expires_in: number;
}

interface CompleteLoginOutput {
  kubeconfig_path: string;
  region: string;
  workspace: string;
}

interface WorkspaceListOutput {
  current: string | null;
  workspaces: Array<{
    uid: string;
    id: string;
    teamName: string;
    role?: string;
    nstype?: string;
  }>;
}

interface DeployInputsGatePayload {
  workspace: string | null;
  resolved: {
    port: number | null;
    build_command: string | null;
    start_command: string | null;
    base_image: string | null;
    docker_hub_user: string | null;
  };
  unresolved_fields: string[];
  required_env: string[];
  env_overrides: Record<string, string>;
  analysis_generated_at: string | null;
}

const SEALOS_SKILL_CONFIG_PATH = fileURLToPath(
  new URL("../../../config.json", import.meta.url),
);

const STEP_CHAIN: StepDefinition[] = [
  { step: "preflight", execute: preflightStep },
  { step: "assess", execute: assessStep },
  { step: "detect-image", execute: detectImageStep },
  { step: "dockerfile", execute: prepareDockerfileStep },
  { step: "build-push", execute: buildPushStep },
  { step: "template", execute: generateTemplateStep },
  { step: "deploy", execute: deployTemplateStep },
  { step: "validate-artifacts", execute: validateArtifactsStep },
];

const REPLAY_ONLY_STEPS = new Set<WorkflowStepName>(["preflight", "dockerfile"]);
const UPDATE_MODE_SKIPPED_STEPS = new Set<WorkflowStepName>(["detect-image", "dockerfile", "template"]);
const KUBECTL_VERIFY_DEPLOYMENT_HINT = "kubectl get deployment/$APP_NAME -n $NAMESPACE";
const KUBECTL_SET_IMAGE_HINT =
  "kubectl set image deployment/$APP_NAME $APP_NAME=$NEW_IMAGE -n $NAMESPACE";
const KUBECTL_ROLLOUT_STATUS_HINT =
  "kubectl rollout status deployment/$APP_NAME -n $NAMESPACE --timeout=120s";
const KUBECTL_ROLLOUT_UNDO_HINT =
  "kubectl rollout undo deployment/$APP_NAME -n $NAMESPACE";
const UPDATE_DEPLOY_MAX_ATTEMPTS = 3;
const DEFAULT_EXECUTION_SUMMARY = "Running fresh deploy path for this workflow run.";
const LEGACY_PREFLIGHT_PENDING_GATES = new Set<WorkflowPendingGate["name"]>([
  "region-selection",
  "sealos-auth",
  "workspace-selection",
  "workspace-change-confirmation",
  "restart-confirmation",
]);

const RESUME_CHECKPOINT_REQUIREMENTS: Record<string, string> = {
  assess: ".sealos/analysis.json",
  "detect-image": ".sealos/analysis.json",
  "build-push": ".sealos/build/build-result.json",
  template: ".sealos/template/index.yaml",
  deploy: ".sealos/state.json (last_deploy + history)",
  "validate-artifacts": "validate-artifacts.mjs --dir <workDir>",
};

async function loadSealosSkillConfig(): Promise<SealosSkillConfig> {
  const raw = await readFile(SEALOS_SKILL_CONFIG_PATH, "utf8");
  return JSON.parse(raw) as SealosSkillConfig;
}

function getPendingGateRegion(pendingGate: WorkflowPendingGate | null): string | null {
  const region = pendingGate?.payload?.region;
  return typeof region === "string" ? region : null;
}

function buildWorkflowResultBase(state: WorkflowRuntimeState) {
  return {
    workDir: state.input.workDir,
    artifactDir: `${state.input.workDir}/.sealos`,
    imageRef: state.imageRef,
    executionMode: state.executionMode,
    executionSummary: state.executionSummary,
    updateTarget: state.updateTarget,
    stepsCompleted: state.stepsCompleted,
    stepResults: state.stepResults,
  };
}

function buildWaitingResult(
  state: WorkflowRuntimeState,
  pendingGate: WorkflowPendingGate,
): SealosDeployWorkflowWaitingResult {
  return {
    status: "waiting",
    ...buildWorkflowResultBase(state),
    pendingGate,
  };
}

function buildBlockedResult(
  state: WorkflowRuntimeState,
  message: string,
  pendingGate: WorkflowPendingGate | null,
): SealosDeployWorkflowBlockedResult {
  return {
    status: "blocked",
    ...buildWorkflowResultBase(state),
    message,
    pendingGate,
  };
}

function createRegionSelectionGate(
  config: SealosSkillConfig,
  currentRegion: string | null,
  createdAt: string,
): WorkflowPendingGate {
  return {
    kind: "input",
    name: "region-selection",
    step: "preflight",
    status: "waiting",
    prompt: "Select the Sealos region before authentication begins.",
    payload: {
      default_region: config.default_region,
      available_regions: config.regions,
      current_region: currentRegion,
    },
    created_at: createdAt,
    expires_at: null,
    resume_hint: "Resume with --resume --region <region> (or submit region in POST /api/runs).",
  };
}

function normalizeApproval(approval: string | undefined) {
  return approval?.trim().toLowerCase() ?? null;
}

function isApproved(approval: string | undefined) {
  const normalized = normalizeApproval(approval);
  return normalized === "approve" || normalized === "approved" || normalized === "yes" || normalized === "true";
}

function isRejected(approval: string | undefined) {
  const normalized = normalizeApproval(approval);
  return normalized === "reject" || normalized === "rejected" || normalized === "no" || normalized === "false";
}

function isCancelled(approval: string | undefined) {
  const normalized = normalizeApproval(approval);
  return normalized === "cancel" || normalized === "cancelled";
}

function isPreflightPendingGate(pendingGate: WorkflowPendingGate | null): boolean {
  if (!pendingGate) {
    return false;
  }

  if (pendingGate.step) {
    return pendingGate.step === "preflight";
  }

  return LEGACY_PREFLIGHT_PENDING_GATES.has(pendingGate.name);
}

function failedCheckpointStep(value: unknown): WorkflowStepName {
  return typeof value === "string" && RESUMABLE_WORKFLOW_STEPS.includes(value as WorkflowStepName)
    ? value as WorkflowStepName
    : "preflight";
}

async function listSealosWorkspaces(workDir: string) {
  return runNodeScript<WorkspaceListOutput>(
    "scripts/sealos-auth.mjs",
    ["list"],
    { cwd: workDir },
  );
}

function createWorkspaceSelectionGate(
  workspaceList: WorkspaceListOutput,
  createdAt: string,
): WorkflowPendingGate {
  return {
    kind: "input",
    name: "workspace-selection",
    step: "preflight",
    status: "waiting",
    prompt: "Choose the Sealos workspace for this workflow run before continuing.",
    payload: {
      current_workspace: workspaceList.current,
      workspaces: workspaceList.workspaces,
    },
    created_at: createdAt,
    expires_at: null,
    resume_hint: "Resume with --resume --workspace <workspace-id> (or submit workspace in POST /api/runs).",
  };
}

function createWorkspaceChangeConfirmationGate(
  currentWorkspace: string | null,
  selectedWorkspace: WorkspaceListOutput["workspaces"][number],
  createdAt: string,
): WorkflowPendingGate {
  return {
    kind: "confirmation",
    name: "workspace-change-confirmation",
    step: "preflight",
    status: "waiting",
    prompt: `Confirm switching the active workspace from ${currentWorkspace ?? "unknown"} to ${selectedWorkspace.id}.`,
    payload: {
      current_workspace: currentWorkspace,
      selected_workspace: selectedWorkspace,
      approval_options: ["approve", "reject"],
    },
    created_at: createdAt,
    expires_at: null,
    resume_hint: "Resume with --resume --approval approve to switch, or --approval reject to keep the current workspace.",
  };
}

function createRestartConfirmationGate(
  message: string,
  failedCheckpoint: WorkflowStepName | undefined,
  createdAt: string,
): WorkflowPendingGate {
  return {
    kind: "confirmation",
    name: "restart-confirmation",
    step: "preflight",
    status: "waiting",
    prompt: message,
    payload: {
      failed_checkpoint: failedCheckpoint ?? null,
      approval_options: ["restart", "cancel"],
    },
    created_at: createdAt,
    expires_at: null,
    resume_hint: "Resume with --resume --approval restart to discard workflow-state.json and start fresh.",
  };
}

export function getDeployInputPayload(
  state: WorkflowRuntimeState,
  config: WorkflowConfigArtifact | null,
): DeployInputsGatePayload {
  const requiredEnv = Object.entries(state.analysis?.env_vars ?? {})
    .filter(([, descriptor]) => descriptor.category === "required")
    .map(([name]) => name)
    .sort();
  const envOverrides = { ...(config?.env_overrides ?? {}), ...(state.resumeInput.env_overrides ?? {}) };
  const unresolvedFields = [
    config?.port != null || state.analysis?.port != null ? null : "port",
    config?.build_command ? null : "build_command",
    config?.start_command ? null : "start_command",
    config?.base_image ? null : "base_image",
    state.imageRef || config?.docker_hub_user || process.env.DOCKER_HUB_USER ? null : "docker_hub_user",
    requiredEnv.every((name) => Boolean(envOverrides[name])) ? null : "env_overrides",
  ].filter((value): value is string => Boolean(value));

  return {
    workspace: state.workspace,
    resolved: {
      port: config?.port ?? state.analysis?.port ?? null,
      build_command: config?.build_command ?? null,
      start_command: config?.start_command ?? null,
      base_image: config?.base_image ?? null,
      docker_hub_user: config?.docker_hub_user ?? process.env.DOCKER_HUB_USER ?? null,
    },
    unresolved_fields: unresolvedFields,
    required_env: requiredEnv,
    env_overrides: envOverrides,
    analysis_generated_at: state.analysis?.generated_at ?? null,
  };
}

export function createDeployInputsGate(
  payload: DeployInputsGatePayload,
  createdAt: string,
): WorkflowPendingGate {
  return {
    kind: "input",
    name: "deploy-inputs",
    step: "dockerfile",
    status: "waiting",
    prompt: "Provide the remaining deploy inputs before the workflow continues into build, template, and deploy steps.",
    payload: payload as unknown as Record<string, unknown>,
    created_at: createdAt,
    expires_at: null,
    resume_hint: "Resume with --resume plus --config-overrides / --env-overrides data (or POST /api/runs JSON fields).",
  };
}

function createDeploymentModeConfirmationGate(
  stateArtifact: SealosStateArtifact,
  createdAt: string,
): WorkflowPendingGate {
  return {
    kind: "confirmation",
    name: "deployment-mode-confirmation",
    step: "detect-image",
    status: "waiting",
    prompt: `Found an existing deployment for ${stateArtifact.last_deploy.app_name}. Choose whether this workflow should create a new instance or update the live deployment in place.`,
    payload: {
      last_deploy: stateArtifact.last_deploy,
      approval_options: ["new-instance", "update"],
    },
    created_at: createdAt,
    expires_at: null,
    resume_hint: "Resume with --resume --approval new-instance to deploy a fresh instance, or --approval update to verify and update the existing deployment.",
  };
}

function createDeployApplyConfirmationGate(
  state: WorkflowRuntimeState,
  createdAt: string,
): WorkflowPendingGate {
  return {
    kind: "confirmation",
    name: "deploy-apply-confirmation",
    step: "deploy",
    status: "waiting",
    prompt: `Confirm applying the generated deployment for ${state.input.repoName}.`,
    payload: {
      image_ref: state.imageRef,
      workspace: state.workspace,
      approval_options: ["approve", "reject"],
    },
    created_at: createdAt,
    expires_at: null,
    resume_hint: "Resume with --resume --approval approve to run deployTemplateStep.",
  };
}

async function readSealosAuthStatus(workDir: string) {
  return runNodeScript<SealosAuthCheckOutput>(
    "scripts/sealos-auth.mjs",
    ["check"],
    { cwd: workDir },
  );
}

function normalizeResumeRegion(
  resumeInput: WorkflowResumeInput,
  fallbackRegion: string | null,
): string | null {
  const region = resumeInput.region?.trim();
  return region || fallbackRegion;
}

function isAuthorizationPending(error: ScriptExecutionError) {
  return `${error.stdoutText}\n${error.stderrText}`.includes("Authorization is still pending");
}

function isExpiredAuthorizationError(error: ScriptExecutionError) {
  return `${error.stdoutText}\n${error.stderrText}`.includes("Device code expired");
}

function uniqueSteps(steps: WorkflowStepName[]) {
  return [...new Set(steps)];
}

function uniqueArtifactPaths(paths: string[]) {
  return [...new Set(paths)];
}

export function isResumableStep(step: WorkflowStepName) {
  return RESUMABLE_WORKFLOW_STEPS.includes(step);
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeHostLikeValue(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "sealos-app";
}

function dockerHubUserFromImageRef(imageRef: string | null) {
  if (!imageRef) {
    return null;
  }

  const withoutDigest = imageRef.split("@")[0];
  const lastColon = withoutDigest.lastIndexOf(":");
  const withoutTag = lastColon > withoutDigest.lastIndexOf("/") ? withoutDigest.slice(0, lastColon) : withoutDigest;
  const segments = withoutTag.split("/");
  if (segments.length < 2) {
    return null;
  }

  const namespace = segments[0];
  if (namespace === "ghcr.io" || namespace.includes(".") || namespace.includes(":")) {
    return null;
  }

  return namespace;
}

function trimHistory(history: SealosHistoryEntry[]) {
  if (history.length <= 50) {
    return history;
  }

  const [first, ...rest] = history;
  return [first, ...rest.slice(-49)];
}

function createInitialRuntimeState(
  input: SealosDeployWorkflowInput,
  resumeInput: WorkflowResumeInput,
): WorkflowRuntimeState {
  return {
    input,
    imageRef: null,
    executionMode: "deploy",
    executionSummary: DEFAULT_EXECUTION_SUMMARY,
    deploymentChoice: null,
    updateTarget: null,
    region: null,
    workspace: null,
    resumeInput,
    stepResults: [],
    stepsCompleted: [],
  };
}

function getKubeEnv() {
  return {
    ...process.env,
    KUBECONFIG: process.env.KUBECONFIG ?? `${process.env.HOME}/.sealos/kubeconfig`,
  };
}

async function runKubectl(
  args: string[],
  workDir: string,
): Promise<{ stdoutText: string; stderrText: string }> {
  const { stdout, stderr } = await execFileAsync(
    "kubectl",
    ["--insecure-skip-tls-verify", ...args],
    {
      cwd: workDir,
      env: getKubeEnv(),
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  return {
    stdoutText: stdout.trim(),
    stderrText: stderr.trim(),
  };
}

function toUpdateTarget(record: SealosStateArtifact["last_deploy"]): WorkflowUpdateTarget {
  return {
    app_name: record.app_name,
    namespace: record.namespace,
    region: record.region,
    image: record.image,
    repo_name: record.repo_name,
    url: record.url,
  };
}

function syncWorkflowMetadata(
  workflowState: WorkflowStateArtifact,
  state: WorkflowRuntimeState,
): WorkflowStateArtifact {
  return {
    ...workflowState,
    execution_mode: state.executionMode,
    execution_summary: state.executionSummary,
    deployment_choice: state.deploymentChoice,
    update_target: state.updateTarget,
  };
}

async function verifyLiveUpdateTarget(
  workDir: string,
  record: SealosStateArtifact["last_deploy"],
): Promise<{ ok: true; target: WorkflowUpdateTarget } | { ok: false; reason: string }> {
  try {
    await runKubectl(
      ["get", "deployment", record.app_name, "-n", record.namespace, "-o", "json"],
      workDir,
    );
    return {
      ok: true,
      target: toUpdateTarget(record),
    };
  } catch (error) {
    return {
      ok: false,
      reason:
        `Recorded deployment ${record.app_name} in namespace ${record.namespace} ` +
        `could not be revalidated with kubectl (${KUBECTL_VERIFY_DEPLOYMENT_HINT}). ` +
        `Falling back to a fresh deploy/new-instance path instead of trusting stale last_deploy state: ${toErrorMessage(error)}`,
    };
  }
}

export function createWorkflowStateArtifact(runId: string, startedAt: string): WorkflowStateArtifact {
  return {
    version: "1.0",
    workflow: "sealos-deploy",
    run_id: runId,
    status: "running",
    execution_mode: "deploy",
    execution_summary: DEFAULT_EXECUTION_SUMMARY,
    deployment_choice: null,
    update_target: null,
    update_attempt: null,
    current_step: null,
    steps_completed: [],
    checkpoints: [],
    resume: {
      resume_from_step: null,
      resume_count: 0,
      last_resumed_at: null,
      migration_source: null,
    },
    last_error: null,
    pending_gate: null,
    started_at: startedAt,
    updated_at: startedAt,
    completed_at: null,
  };
}

export function markWorkflowStepRunning(
  workflowState: WorkflowStateArtifact,
  step: WorkflowStepName,
  updatedAt: string,
): WorkflowStateArtifact {
  return {
    ...workflowState,
    status: "running",
    current_step: step,
    pending_gate: null,
    updated_at: updatedAt,
  };
}

export function applyWorkflowCheckpoint(
  workflowState: WorkflowStateArtifact,
  checkpoint: WorkflowCheckpointRecord,
  updatedAt: string,
): WorkflowStateArtifact {
  const nextCheckpoints = workflowState.checkpoints.filter((entry) => entry.step !== checkpoint.step);
  nextCheckpoints.push(checkpoint);

  return {
    ...workflowState,
    status: "resumable",
    current_step: null,
    steps_completed: uniqueSteps([...workflowState.steps_completed, checkpoint.step]),
    checkpoints: nextCheckpoints,
    last_error: null,
    pending_gate: null,
    updated_at: updatedAt,
  };
}

export function markWorkflowFailed(
  workflowState: WorkflowStateArtifact,
  step: WorkflowStepName,
  message: string,
  failedAt: string,
): WorkflowStateArtifact {
  return {
    ...workflowState,
    status: "failed",
    current_step: step,
    last_error: {
      step,
      message,
      at: failedAt,
    },
    pending_gate: null,
    updated_at: failedAt,
  };
}

export function markWorkflowCompleted(
  workflowState: WorkflowStateArtifact,
  completedAt: string,
): WorkflowStateArtifact {
  return {
    ...workflowState,
    status: "completed",
    current_step: null,
    pending_gate: null,
    updated_at: completedAt,
    completed_at: completedAt,
  };
}

function buildCheckpointRecord(
  result: WorkflowStepResult,
  completedAt: string,
  imageRef: string | null,
  extraArtifactPaths: string[] = [],
): WorkflowCheckpointRecord {
  return {
    step: result.step,
    status: result.status,
    completed_at: completedAt,
    artifact_paths: uniqueArtifactPaths([...result.artifactPaths, ...extraArtifactPaths]),
    summary: result.summary,
    ...(imageRef ? { image_ref: imageRef } : {}),
  };
}

function checkpointSkipResult(checkpoint: WorkflowCheckpointRecord): WorkflowStepResult {
  return {
    step: checkpoint.step,
    status: "skipped",
    summary: `Skipped ${checkpoint.step} because workflow-state.json and ${RESUME_CHECKPOINT_REQUIREMENTS[checkpoint.step]} already validated for resume.`,
    warnings: [],
    artifactPaths: checkpoint.artifact_paths,
    stdoutJson: {
      resumed: true,
      resume_from_step: checkpoint.step,
      completed_at: checkpoint.completed_at,
    },
  };
}

function shouldSkipForResume(step: WorkflowStepName, resumeFromStep: WorkflowStepName | null) {
  if (!resumeFromStep || !isResumableStep(step)) {
    return false;
  }

  return RESUMABLE_WORKFLOW_STEPS.indexOf(step) < RESUMABLE_WORKFLOW_STEPS.indexOf(resumeFromStep);
}

async function hydrateRuntimeState(
  input: SealosDeployWorkflowInput,
  workflowState: WorkflowStateArtifact,
  resumeInput: WorkflowResumeInput,
): Promise<WorkflowRuntimeState> {
  const paths = getArtifactPaths(input.workDir);
  const analysis = await readJsonFile<AnalysisArtifact>(paths.analysis);
  const config = await readWorkflowConfigArtifact(paths);
  const checkpointImage =
    [...workflowState.checkpoints].reverse().find((entry) => entry.image_ref)?.image_ref ?? null;

  return {
    ...createInitialRuntimeState(input, resumeInput),
    config: config ?? undefined,
    analysis: analysis ?? undefined,
    imageRef: checkpointImage ?? analysis?.image_ref ?? null,
    executionMode: workflowState.execution_mode,
    executionSummary: workflowState.execution_summary,
    deploymentChoice: workflowState.deployment_choice,
    updateTarget: workflowState.update_target,
    region: getPendingGateRegion(workflowState.pending_gate),
    workspace: null,
    stepsCompleted: [...workflowState.steps_completed],
  };
}

async function applyResumeOverrides(
  state: WorkflowRuntimeState,
  paths: ReturnType<typeof getArtifactPaths>,
) {
  const nextConfig: WorkflowConfigArtifact = {
    ...(state.config ?? {}),
    ...(state.resumeInput.config_overrides ?? {}),
    env_overrides: {
      ...(state.config?.env_overrides ?? {}),
      ...(state.resumeInput.env_overrides ?? {}),
    },
  };

  await writeWorkflowConfigArtifact(paths, nextConfig);

  let nextAnalysis = state.analysis;
  const overridePort = nextConfig.port;
  if (typeof overridePort === "number" && state.analysis && overridePort !== state.analysis.port) {
    await updateAnalysisArtifact(paths, (analysis) => ({
      ...analysis,
      port: overridePort,
    }));
    nextAnalysis = {
      ...state.analysis,
      port: overridePort,
    };
  }

  return {
    ...state,
    config: nextConfig,
    analysis: nextAnalysis,
  };
}

async function beginAuthGate(
  state: WorkflowRuntimeState,
  workflowState: WorkflowStateArtifact,
  paths: ReturnType<typeof getArtifactPaths>,
  region: string,
): Promise<PendingGateResolution> {
  const login = await runNodeScript<BeginLoginOutput>(
    "scripts/sealos-auth.mjs",
    ["begin-login", region],
    { cwd: state.input.workDir },
  );
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + (login.stdoutJson.expires_in * 1000)).toISOString();
  const pendingGate: WorkflowPendingGate = {
    kind: "auth",
    name: "sealos-auth",
    step: "preflight",
    status: "waiting",
    prompt: `Authorize Sealos access for ${region} in your browser, then resume the workflow.`,
    payload: login.stdoutJson as unknown as Record<string, unknown>,
    created_at: createdAt,
    expires_at: expiresAt,
    resume_hint: "After browser approval, resume with --resume for the same work directory.",
  };

  const nextState = {
    ...state,
    region,
  };
  const nextWorkflowState = withPendingGate(workflowState, pendingGate, createdAt);
  await writeWorkflowStateArtifact(paths, nextWorkflowState);

  return {
    state: nextState,
    workflowState: nextWorkflowState,
    outcome: buildWaitingResult(nextState, pendingGate),
  };
}

async function handlePreflightHumanGates(
  state: WorkflowRuntimeState,
  workflowState: WorkflowStateArtifact,
  runOptions: WorkflowRunOptions,
  paths: ReturnType<typeof getArtifactPaths>,
): Promise<PendingGateResolution> {
  const pendingGate = workflowState.pending_gate;

  if (pendingGate && !isPreflightPendingGate(pendingGate)) {
    return { state, workflowState };
  }

  const config = await loadSealosSkillConfig();

  if (pendingGate?.name === "restart-confirmation") {
    const approval = normalizeApproval(state.resumeInput.approval);
    if (approval === "restart") {
      await deleteWorkflowStateArtifact(paths);
      const startedAt = new Date().toISOString();
      return {
        state: {
          ...state,
          config: undefined,
          analysis: undefined,
          imageRef: null,
          region: null,
          workspace: null,
          stepResults: [],
          stepsCompleted: [],
        },
        workflowState: createWorkflowStateArtifact(workflowState.run_id, startedAt),
      };
    }

    if (isCancelled(state.resumeInput.approval)) {
      const cancelledAt = new Date().toISOString();
      const failedStep = failedCheckpointStep(pendingGate.payload.failed_checkpoint);
      const cancelledWorkflowState = markWorkflowFailed(
        workflowState,
        failedStep,
        "Restart was cancelled by the operator; workflow remains blocked until a new run or explicit restart.",
        cancelledAt,
      );
      await writeWorkflowStateArtifact(paths, cancelledWorkflowState);
      return {
        state,
        workflowState: cancelledWorkflowState,
        outcome: buildBlockedResult(
          state,
          "Restart was cancelled. Start a new run or resume with --restart when you are ready to discard the invalid workflow-state.json.",
          null,
        ),
      };
    }

    return {
      state,
      workflowState,
      outcome: buildWaitingResult(state, pendingGate),
    };
  }

  if (pendingGate?.name === "sealos-auth") {
    const gateRegion = getPendingGateRegion(pendingGate);
    const requestedRegion = normalizeResumeRegion(state.resumeInput, gateRegion);
    const gateExpired = isExpiredTimestamp(pendingGate.expires_at);
    const gateRegionMismatch = Boolean(requestedRegion && gateRegion && requestedRegion !== gateRegion);

    if (gateExpired || gateRegionMismatch) {
      const message = gateExpired
        ? "The pending Sealos auth link has expired."
        : `The pending Sealos auth link was created for ${gateRegion}, but resume requested ${requestedRegion}.`;

      if (runOptions.startMode === "auto" && requestedRegion) {
        const clearedWorkflowState = clearPendingGate(workflowState, new Date().toISOString());
        await writeWorkflowStateArtifact(paths, clearedWorkflowState);
        return beginAuthGate(
          {
            ...state,
            region: requestedRegion,
            workspace: state.workspace,
          },
          clearedWorkflowState,
          paths,
          requestedRegion,
        );
      }

      return {
        state,
        workflowState,
        outcome: buildBlockedResult(
          state,
          `${message} Re-run without --resume to generate a fresh auth gate.`,
          pendingGate,
        ),
      };
    }

    try {
      const deviceCode = pendingGate.payload.device_code;
      if (typeof deviceCode !== "string" || !gateRegion) {
        return {
          state,
          workflowState,
          outcome: buildBlockedResult(
            state,
            "The pending Sealos auth gate is missing region or device code metadata.",
            pendingGate,
          ),
        };
      }

      const completed = await runNodeScript<CompleteLoginOutput>(
        "scripts/sealos-auth.mjs",
        ["complete-login", "--region", gateRegion, "--device-code", deviceCode],
        { cwd: state.input.workDir },
      );
      const clearedWorkflowState = clearPendingGate(workflowState, new Date().toISOString());
      await writeWorkflowStateArtifact(paths, clearedWorkflowState);
      return {
        state: {
          ...state,
          region: completed.stdoutJson.region,
          workspace: completed.stdoutJson.workspace,
        },
        workflowState: clearedWorkflowState,
      };
    } catch (error) {
      if (error instanceof ScriptExecutionError && isAuthorizationPending(error)) {
        return {
          state,
          workflowState,
          outcome: buildWaitingResult(state, pendingGate),
        };
      }

      if (error instanceof ScriptExecutionError && isExpiredAuthorizationError(error)) {
        return {
          state,
          workflowState,
          outcome: buildBlockedResult(
            state,
            "The pending Sealos auth link has expired. Re-run without --resume to generate a fresh auth gate.",
            pendingGate,
          ),
        };
      }

      throw error;
    }
  }

  const authCheck = await readSealosAuthStatus(state.input.workDir);
  const currentRegion = authCheck.stdoutJson.region ?? null;
  const currentWorkspace = authCheck.stdoutJson.workspace ?? null;
  const selectedRegion = normalizeResumeRegion(
    state.resumeInput,
    state.region ?? currentRegion,
  );

  if (pendingGate?.name === "region-selection") {
    if (!selectedRegion) {
      return {
        state: {
          ...state,
          workspace: currentWorkspace,
        },
        workflowState,
        outcome: buildWaitingResult(state, pendingGate),
      };
    }

    if (!config.regions.includes(selectedRegion)) {
      return {
        state,
        workflowState,
        outcome: buildBlockedResult(
          state,
          `Unknown Sealos region '${selectedRegion}'. Choose one of: ${config.regions.join(", ")}`,
          pendingGate,
        ),
      };
    }

    const clearedState = {
      ...state,
      region: selectedRegion,
      workspace: currentWorkspace,
    };
    const clearedWorkflowState = clearPendingGate(workflowState, new Date().toISOString());
    await writeWorkflowStateArtifact(paths, clearedWorkflowState);
    return beginAuthGate(clearedState, clearedWorkflowState, paths, selectedRegion);
  }

  if (authCheck.stdoutJson.authenticated && pendingGate?.name === "workspace-selection") {
    const workspaceList = await listSealosWorkspaces(state.input.workDir);
    const requestedWorkspace = state.resumeInput.workspace?.trim();
    if (!requestedWorkspace) {
      return {
        state: {
          ...state,
          workspace: currentWorkspace,
        },
        workflowState,
        outcome: buildWaitingResult(
          {
            ...state,
            workspace: currentWorkspace,
          },
          pendingGate,
        ),
      };
    }

    const selectedWorkspace = workspaceList.stdoutJson.workspaces.find((workspace) =>
      workspace.id === requestedWorkspace || workspace.uid === requestedWorkspace,
    );
    if (!selectedWorkspace) {
      return {
        state: {
          ...state,
          workspace: currentWorkspace,
        },
        workflowState,
        outcome: buildBlockedResult(
          {
            ...state,
            workspace: currentWorkspace,
          },
          `Unknown workspace '${requestedWorkspace}'. Resume with one of the advertised workspace ids.`,
          pendingGate,
        ),
      };
    }

    if (selectedWorkspace.id === currentWorkspace) {
      const clearedWorkflowState = clearPendingGate(workflowState, new Date().toISOString());
      await writeWorkflowStateArtifact(paths, clearedWorkflowState);
      return {
        state: {
          ...state,
          region: currentRegion ?? selectedRegion,
          workspace: currentWorkspace,
        },
        workflowState: clearedWorkflowState,
      };
    }

    const nextPendingGate = createWorkspaceChangeConfirmationGate(
      currentWorkspace,
      selectedWorkspace,
      new Date().toISOString(),
    );
    const waitingWorkflowState = withPendingGate(workflowState, nextPendingGate, nextPendingGate.created_at);
    await writeWorkflowStateArtifact(paths, waitingWorkflowState);
    return {
      state: {
        ...state,
        region: currentRegion ?? selectedRegion,
        workspace: currentWorkspace,
      },
      workflowState: waitingWorkflowState,
      outcome: buildWaitingResult(
        {
          ...state,
          region: currentRegion ?? selectedRegion,
          workspace: currentWorkspace,
        },
        nextPendingGate,
      ),
    };
  }

  if (authCheck.stdoutJson.authenticated && pendingGate?.name === "workspace-change-confirmation") {
    if (isRejected(state.resumeInput.approval)) {
      return {
        state: {
          ...state,
          region: currentRegion ?? selectedRegion,
          workspace: currentWorkspace,
        },
        workflowState,
        outcome: buildBlockedResult(
          {
            ...state,
            region: currentRegion ?? selectedRegion,
            workspace: currentWorkspace,
          },
          "Workspace switch was declined. The workflow cannot continue until a workspace is confirmed.",
          pendingGate,
        ),
      };
    }

    if (!isApproved(state.resumeInput.approval)) {
      return {
        state: {
          ...state,
          region: currentRegion ?? selectedRegion,
          workspace: currentWorkspace,
        },
        workflowState,
        outcome: buildWaitingResult(
          {
            ...state,
            region: currentRegion ?? selectedRegion,
            workspace: currentWorkspace,
          },
          pendingGate,
        ),
      };
    }

    const selectedWorkspace = pendingGate.payload.selected_workspace;
    const workspaceId =
      typeof selectedWorkspace === "object" && selectedWorkspace && "id" in selectedWorkspace
        ? selectedWorkspace.id
        : null;

    if (typeof workspaceId !== "string") {
      return {
        state,
        workflowState,
        outcome: buildBlockedResult(
          state,
          "The workspace-change-confirmation gate is missing the selected workspace metadata.",
          pendingGate,
        ),
      };
    }

    const switched = await runNodeScript<{ workspace: { id: string } }>(
      "scripts/sealos-auth.mjs",
      ["switch", workspaceId],
      { cwd: state.input.workDir },
    );
    const clearedWorkflowState = clearPendingGate(workflowState, new Date().toISOString());
    await writeWorkflowStateArtifact(paths, clearedWorkflowState);
    return {
      state: {
        ...state,
        region: currentRegion ?? selectedRegion,
        workspace: switched.stdoutJson.workspace.id,
      },
      workflowState: clearedWorkflowState,
    };
  }

  if (authCheck.stdoutJson.authenticated) {
    if (state.workspace) {
      return {
        state: {
          ...state,
          region: currentRegion ?? selectedRegion,
          workspace: state.workspace,
        },
        workflowState,
      };
    }

    const requestedWorkspace = state.resumeInput.workspace?.trim();
    if (requestedWorkspace && requestedWorkspace === currentWorkspace) {
      return {
        state: {
          ...state,
          region: currentRegion ?? selectedRegion,
          workspace: currentWorkspace,
        },
        workflowState,
      };
    }

    const workspaceList = await listSealosWorkspaces(state.input.workDir);
    const nextPendingGate = createWorkspaceSelectionGate(workspaceList.stdoutJson, new Date().toISOString());
    const waitingWorkflowState = withPendingGate(workflowState, nextPendingGate, nextPendingGate.created_at);
    await writeWorkflowStateArtifact(paths, waitingWorkflowState);
    return {
      state: {
        ...state,
        region: currentRegion ?? selectedRegion,
        workspace: currentWorkspace,
      },
      workflowState: waitingWorkflowState,
      outcome: buildWaitingResult(
        {
          ...state,
          region: currentRegion ?? selectedRegion,
          workspace: currentWorkspace,
        },
        nextPendingGate,
      ),
    };
  }

  if (!selectedRegion) {
    const nextPendingGate = createRegionSelectionGate(config, currentRegion, new Date().toISOString());
    const waitingWorkflowState = withPendingGate(workflowState, nextPendingGate, nextPendingGate.created_at);
    await writeWorkflowStateArtifact(paths, waitingWorkflowState);
    return {
      state,
      workflowState: waitingWorkflowState,
      outcome: buildWaitingResult(state, nextPendingGate),
    };
  }

  return beginAuthGate(
    {
      ...state,
      region: selectedRegion,
      workspace: currentWorkspace,
    },
    workflowState,
    paths,
    selectedRegion,
  );
}

async function writeDeployFactsArtifact(
  state: WorkflowRuntimeState,
  result: WorkflowStepResult<DeployTemplateOutput>,
  completedAt: string,
) {
  const paths = getArtifactPaths(state.input.workDir);
  const existingState = await readStateArtifact(paths);
  const output = result.stdoutJson;
  const appName = sanitizeHostLikeValue(output?.app_name ?? state.input.repoName);
  const appHost = sanitizeHostLikeValue(output?.app_host ?? state.input.repoName);
  const namespace = output?.namespace ?? "default";
  const region = output?.region_domain ?? "example.com";
  const image = state.imageRef ?? state.analysis?.image_ref;

  if (!image) {
    throw new FatalError("Deploy checkpoint requires a resolved image_ref before writing .sealos/state.json.");
  }

  const nextHistory = trimHistory([
    ...(existingState?.history ?? []),
    {
      at: completedAt,
      action: "deploy",
      image,
      method: output?.method ?? "template-api",
      status: "success",
      note: existingState ? "Workflow deploy completed" : "Initial deployment",
    },
  ]);

  const deployFacts: SealosStateArtifact = {
    version: "1.0",
    last_deploy: {
      app_name: appName,
      app_host: appHost,
      namespace,
      region,
      image,
      docker_hub_user: dockerHubUserFromImageRef(image),
      repo_name: state.input.repoName,
      url: `https://${appHost}.${region}`,
      deployed_at: completedAt,
      last_updated_at: completedAt,
    },
    history: nextHistory,
  };

  await writeStateArtifact(paths, deployFacts);
  return [paths.state];
}

async function writeUpdateSuccessArtifact(
  state: WorkflowRuntimeState,
  completedAt: string,
) {
  const paths = getArtifactPaths(state.input.workDir);
  const existingState = await readStateArtifact(paths);
  const newImage = state.imageRef;

  if (!existingState?.last_deploy || !newImage) {
    throw new FatalError("Update checkpoint requires existing last_deploy facts and a resolved image_ref.");
  }

  const previousImage = existingState.last_deploy.image;
  const nextStateArtifact: SealosStateArtifact = {
    ...existingState,
    last_deploy: {
      ...existingState.last_deploy,
      image: newImage,
      docker_hub_user: dockerHubUserFromImageRef(newImage),
      last_updated_at: completedAt,
    },
    history: trimHistory([
      ...existingState.history,
      {
        at: completedAt,
        action: "set-image",
        method: "kubectl-set-image",
        status: "success",
        image: newImage,
        previous_image: previousImage,
      },
    ]),
  };

  await writeStateArtifact(paths, nextStateArtifact);
  return [paths.state];
}

async function writeUpdateFailureArtifact(
  state: WorkflowRuntimeState,
  failedAt: string,
  note: string,
) {
  const paths = getArtifactPaths(state.input.workDir);
  const existingState = await readStateArtifact(paths);
  const newImage = state.imageRef;

  if (!existingState?.last_deploy || !newImage) {
    throw new FatalError("Terminal update failure requires existing last_deploy facts and a resolved image_ref.");
  }

  const nextStateArtifact: SealosStateArtifact = {
    ...existingState,
    history: trimHistory([
      ...existingState.history,
      {
        at: failedAt,
        action: "set-image",
        method: "kubectl-set-image",
        status: "failed",
        image: newImage,
        previous_image: existingState.last_deploy.image,
        note,
      },
    ]),
  };

  await writeStateArtifact(paths, nextStateArtifact);
  return [paths.state];
}

async function handlePostAssessHumanGates(
  state: WorkflowRuntimeState,
  workflowState: WorkflowStateArtifact,
  paths: ReturnType<typeof getArtifactPaths>,
): Promise<PendingGateResolution> {
  const pendingGate = workflowState.pending_gate;

  if (pendingGate?.name === "deployment-mode-confirmation") {
    const approval = normalizeApproval(state.resumeInput.approval);
    if (approval === "update") {
      const lastDeploy = pendingGate.payload.last_deploy as SealosStateArtifact["last_deploy"] | undefined;
      if (!lastDeploy) {
        return {
          state,
          workflowState,
          outcome: buildBlockedResult(
            state,
            "The deployment-mode-confirmation gate is missing last_deploy metadata, so update mode cannot be verified.",
            pendingGate,
          ),
        };
      }

      const verified = await verifyLiveUpdateTarget(state.input.workDir, lastDeploy);
      const nextState: WorkflowRuntimeState = verified.ok
        ? {
          ...state,
          executionMode: "update",
          executionSummary:
            `Running update mode for deployment/${lastDeploy.app_name} in namespace ${lastDeploy.namespace} after live kubectl verification.`,
          deploymentChoice: "update",
          updateTarget: verified.target,
        }
        : {
          ...state,
          executionMode: "deploy",
          executionSummary: verified.reason,
          deploymentChoice: "new-instance",
          updateTarget: null,
        };
      const clearedWorkflowState = syncWorkflowMetadata(
        clearPendingGate(workflowState, new Date().toISOString()),
        nextState,
      );
      await writeWorkflowStateArtifact(paths, clearedWorkflowState);
      return {
        state: nextState,
        workflowState: clearedWorkflowState,
      };
    }

    if (approval !== "new-instance") {
      return {
        state,
        workflowState,
        outcome: buildWaitingResult(state, pendingGate),
      };
    }

    const nextState: WorkflowRuntimeState = {
      ...state,
      executionMode: "deploy",
      executionSummary: DEFAULT_EXECUTION_SUMMARY,
      deploymentChoice: "new-instance",
      updateTarget: null,
    };
    const clearedWorkflowState = syncWorkflowMetadata(
      clearPendingGate(workflowState, new Date().toISOString()),
      nextState,
    );
    await writeWorkflowStateArtifact(paths, clearedWorkflowState);
    return {
      state: nextState,
      workflowState: clearedWorkflowState,
    };
  }

  const deployState = await readStateArtifact(paths);
  if (deployState?.last_deploy.app_name && state.deploymentChoice === null) {
    const nextPendingGate = createDeploymentModeConfirmationGate(deployState, new Date().toISOString());
    const waitingWorkflowState = syncWorkflowMetadata(
      withPendingGate(workflowState, nextPendingGate, nextPendingGate.created_at),
      state,
    );
    await writeWorkflowStateArtifact(paths, waitingWorkflowState);
    return {
      state,
      workflowState: waitingWorkflowState,
      outcome: buildWaitingResult(state, nextPendingGate),
    };
  }

  if (state.executionMode === "update") {
    return { state, workflowState };
  }

  if (pendingGate?.name === "deploy-inputs") {
    const gatePayload = pendingGate.payload as unknown as DeployInputsGatePayload;
    const nextState = await applyResumeOverrides(state, paths);
    const nextPayload = getDeployInputPayload(nextState, nextState.config ?? null);
    const missingRequiredEnv = nextPayload.required_env.filter((name) => !nextPayload.env_overrides[name]);
    const hasMissingFields = nextPayload.unresolved_fields.length > 0 || missingRequiredEnv.length > 0;

    if (gatePayload.analysis_generated_at !== (nextState.analysis?.generated_at ?? null)) {
      return {
        state: nextState,
        workflowState,
        outcome: buildBlockedResult(
          nextState,
          "The pending deploy-inputs gate is stale because the analysis snapshot changed. Restart the workflow to regenerate the required inputs.",
          pendingGate,
        ),
      };
    }

    if (hasMissingFields) {
      const refreshedGate = createDeployInputsGate(nextPayload, pendingGate.created_at);
      const waitingWorkflowState = syncWorkflowMetadata(
        withPendingGate(workflowState, refreshedGate, new Date().toISOString()),
        nextState,
      );
      await writeWorkflowStateArtifact(paths, waitingWorkflowState);
      return {
        state: nextState,
        workflowState: waitingWorkflowState,
        outcome: buildWaitingResult(nextState, refreshedGate),
      };
    }

    const clearedWorkflowState = syncWorkflowMetadata(
      clearPendingGate(workflowState, new Date().toISOString()),
      nextState,
    );
    await writeWorkflowStateArtifact(paths, clearedWorkflowState);
    return {
      state: nextState,
      workflowState: clearedWorkflowState,
    };
  }

  if (state.imageRef) {
    return { state, workflowState };
  }

  if (!state.stepsCompleted.includes("detect-image")) {
    return { state, workflowState };
  }

  const payload = getDeployInputPayload(state, state.config ?? null);
  if (payload.unresolved_fields.length === 0) {
    return { state, workflowState };
  }

  const nextPendingGate = createDeployInputsGate(payload, new Date().toISOString());
  const waitingWorkflowState = syncWorkflowMetadata(
    withPendingGate(workflowState, nextPendingGate, nextPendingGate.created_at),
    state,
  );
  await writeWorkflowStateArtifact(paths, waitingWorkflowState);
  return {
    state,
    workflowState: waitingWorkflowState,
    outcome: buildWaitingResult(state, nextPendingGate),
  };
}

async function handlePreDeployHumanGates(
  state: WorkflowRuntimeState,
  workflowState: WorkflowStateArtifact,
  paths: ReturnType<typeof getArtifactPaths>,
): Promise<PendingGateResolution> {
  const pendingGate = workflowState.pending_gate;

  if (pendingGate?.name === "deploy-apply-confirmation") {
    if (isRejected(state.resumeInput.approval)) {
      return {
        state,
        workflowState,
        outcome: buildBlockedResult(
          state,
          "Deployment apply was not approved. Resume with approval when you are ready to continue.",
          pendingGate,
        ),
      };
    }

    if (!isApproved(state.resumeInput.approval)) {
      return {
        state,
        workflowState,
        outcome: buildWaitingResult(state, pendingGate),
      };
    }

    const clearedWorkflowState = syncWorkflowMetadata(
      clearPendingGate(workflowState, new Date().toISOString()),
      state,
    );
    await writeWorkflowStateArtifact(paths, clearedWorkflowState);
    return {
      state,
      workflowState: clearedWorkflowState,
    };
  }

  if (isApproved(state.resumeInput.approval)) {
    return { state, workflowState };
  }

  const nextPendingGate = createDeployApplyConfirmationGate(state, new Date().toISOString());
  const waitingWorkflowState = syncWorkflowMetadata(
    withPendingGate(workflowState, nextPendingGate, nextPendingGate.created_at),
    state,
  );
  await writeWorkflowStateArtifact(paths, waitingWorkflowState);
  return {
    state,
    workflowState: waitingWorkflowState,
    outcome: buildWaitingResult(state, nextPendingGate),
  };
}

export async function executeUpdateDeployStep(
  state: WorkflowRuntimeState,
  workflowState: WorkflowStateArtifact,
  paths: ReturnType<typeof getArtifactPaths>,
): Promise<{
  state: WorkflowRuntimeState;
  workflowState: WorkflowStateArtifact;
  result: WorkflowStepResult<{
    success: boolean;
    action: "set-image";
    namespace: string;
    app_name: string;
    image: string;
    previous_image: string;
    verified_with: string;
    pull_secret?: { ensured: boolean; command: string[] };
  }>;
}> {
  if (!state.updateTarget) {
    throw new FatalError("Update-mode deploy requires a verified updateTarget.");
  }

  if (!state.imageRef) {
    throw new FatalError("Update-mode deploy requires a built image_ref before kubectl set image.");
  }

  const target = state.updateTarget;
  const previousImage = target.image;
  if (state.input.dryRun) {
    return {
      state: {
        ...state,
        executionSummary:
          `Dry-run update mode verified deployment/${target.app_name} and would run ${KUBECTL_SET_IMAGE_HINT} followed by ${KUBECTL_ROLLOUT_STATUS_HINT}.`,
      },
      workflowState,
      result: {
        step: "deploy",
        status: "dry-run",
        summary: `Dry-run mode skipped kubectl set image for deployment/${target.app_name}.`,
        warnings: [
          "Dry-run update mode does not contact kubectl or mutate the live deployment.",
        ],
        artifactPaths: [],
        stdoutJson: {
          success: true,
          action: "set-image",
          namespace: target.namespace,
          app_name: target.app_name,
          image: state.imageRef,
          previous_image: previousImage,
          verified_with: KUBECTL_VERIFY_DEPLOYMENT_HINT,
        },
      },
    };
  }

  const warnings: string[] = [];
  const commandLog: string[] = [];
  const priorRetryState = workflowState.update_attempt;
  const startAttempt = priorRetryState && !priorRetryState.terminal_failure
    ? Math.min(priorRetryState.attempt + 1, UPDATE_DEPLOY_MAX_ATTEMPTS)
    : 1;

  for (let attempt = startAttempt; attempt <= UPDATE_DEPLOY_MAX_ATTEMPTS; attempt += 1) {
    const attemptStartedAt = new Date().toISOString();
    const attemptLabel = `${attempt}/${UPDATE_DEPLOY_MAX_ATTEMPTS}`;
    workflowState = withWorkflowUpdateRetry(
      workflowState,
      createWorkflowUpdateRetryRecord({
        attempt,
        maxAttempts: UPDATE_DEPLOY_MAX_ATTEMPTS,
        lastAttemptStartedAt: attemptStartedAt,
        lastOutcomeStatus: attempt === 1 ? "running" : "retrying",
        lastOutcomeMessage:
          attempt === 1
            ? `Started workflow retry policy for update apply and rollout verification (attempt ${attemptLabel}).`
            : `Retrying update apply and rollout verification on attempt ${attemptLabel}.`,
        lastFailureAt: workflowState.update_attempt?.last_failure_at ?? null,
        lastFailureMessage: workflowState.update_attempt?.last_failure_message ?? null,
      }),
      attemptStartedAt,
    );
    await writeWorkflowStateArtifact(paths, workflowState);

    let pullSecretCommand: string[] | undefined;

    try {
      if (state.imageRef.startsWith("ghcr.io/")) {
        const pullSecretResult = await runNodeScript<{
          success: boolean;
          error?: string;
        }>(
          "scripts/ensure-image-pull-secret.mjs",
          [target.namespace, target.app_name, state.imageRef, target.app_name],
          { cwd: state.input.workDir },
        );
        pullSecretCommand = pullSecretResult.command;
        commandLog.push(pullSecretResult.command.join(" "));
        if (!pullSecretResult.stdoutJson.success) {
          throw new FatalError(
            pullSecretResult.stdoutJson.error
            ?? `Failed to ensure the app-scoped GHCR pull secret before ${KUBECTL_SET_IMAGE_HINT}.`,
          );
        }
      }

      const setImageArgs = [
        "set",
        "image",
        `deployment/${target.app_name}`,
        `${target.app_name}=${state.imageRef}`,
        "-n",
        target.namespace,
      ];
      const setImageResult = await runKubectl(setImageArgs, state.input.workDir);
      commandLog.push(["kubectl", "--insecure-skip-tls-verify", ...setImageArgs].join(" "));

      const rolloutStatusArgs = [
        "rollout",
        "status",
        `deployment/${target.app_name}`,
        "-n",
        target.namespace,
        "--timeout=120s",
      ];
      const rolloutResult = await runKubectl(rolloutStatusArgs, state.input.workDir);
      commandLog.push(["kubectl", "--insecure-skip-tls-verify", ...rolloutStatusArgs].join(" "));

      const succeededAt = new Date().toISOString();
      workflowState = withWorkflowUpdateRetry(
        workflowState,
        createWorkflowUpdateRetryRecord({
          attempt,
          maxAttempts: UPDATE_DEPLOY_MAX_ATTEMPTS,
          lastAttemptStartedAt: attemptStartedAt,
          lastOutcomeStatus: "succeeded",
          lastOutcomeAt: succeededAt,
          lastOutcomeMessage:
            attempt === 1
              ? `Update apply and rollout verification succeeded on attempt ${attemptLabel}.`
              : `Update apply and rollout verification succeeded on attempt ${attemptLabel} after ${attempt - 1} retr${attempt === 2 ? "y" : "ies"}.`,
          lastFailureAt: workflowState.update_attempt?.last_failure_at ?? null,
          lastFailureMessage: workflowState.update_attempt?.last_failure_message ?? null,
        }),
        succeededAt,
      );
      await writeWorkflowStateArtifact(paths, workflowState);

      return {
        state: {
          ...state,
          executionSummary:
            `Update mode successfully applied ${state.imageRef} to deployment/${target.app_name} in namespace ${target.namespace} using workflow retry attempt ${attemptLabel}.`,
          updateTarget: {
            ...target,
            image: state.imageRef,
          },
        },
        workflowState,
        result: {
          step: "deploy",
          status: "success",
          summary:
            attempt === 1
              ? `Updated deployment/${target.app_name} to ${state.imageRef} and verified rollout status on the first attempt.`
              : `Updated deployment/${target.app_name} to ${state.imageRef} and verified rollout status after ${attempt} workflow retry attempts.`,
          command: ["kubectl", "set", "image", `deployment/${target.app_name}`],
          stdoutText: [setImageResult.stdoutText, rolloutResult.stdoutText].filter(Boolean).join("\n"),
          stderrText: [setImageResult.stderrText, rolloutResult.stderrText].filter(Boolean).join("\n"),
          warnings,
          artifactPaths: [],
          stdoutJson: {
            success: true,
            action: "set-image",
            namespace: target.namespace,
            app_name: target.app_name,
            image: state.imageRef,
            previous_image: previousImage,
            verified_with: KUBECTL_VERIFY_DEPLOYMENT_HINT,
            ...(pullSecretCommand ? {
              pull_secret: {
                ensured: true,
                command: pullSecretCommand,
              },
            } : {}),
          },
        },
      };
    } catch (error) {
      const failedAt = new Date().toISOString();
      const terminalFailure = attempt >= UPDATE_DEPLOY_MAX_ATTEMPTS;
      const failureMessage =
        `Update rollout failed for deployment/${target.app_name} on workflow retry attempt ${attemptLabel} after ${KUBECTL_SET_IMAGE_HINT} and ${KUBECTL_ROLLOUT_STATUS_HINT}. ` +
        `Original error: ${toErrorMessage(error)}`;

      if (!terminalFailure) {
        warnings.push(failureMessage);
        workflowState = withWorkflowUpdateRetry(
          workflowState,
          createWorkflowUpdateRetryRecord({
            attempt,
            maxAttempts: UPDATE_DEPLOY_MAX_ATTEMPTS,
            lastAttemptStartedAt: attemptStartedAt,
            lastOutcomeStatus: "retrying",
            lastOutcomeAt: failedAt,
            lastOutcomeMessage:
              `Attempt ${attemptLabel} failed; the workflow will retry update apply and rollout verification.`,
            lastFailureAt: failedAt,
            lastFailureMessage: failureMessage,
          }),
          failedAt,
        );
        await writeWorkflowStateArtifact(paths, workflowState);
        continue;
      }

      let rollbackCompletedAt: string | null = null;
      let rollbackNote = `Rollout failed and rollback completed via ${KUBECTL_ROLLOUT_UNDO_HINT}.`;

      try {
        const rollbackArgs = [
          "rollout",
          "undo",
          `deployment/${target.app_name}`,
          "-n",
          target.namespace,
        ];
        await runKubectl(rollbackArgs, state.input.workDir);
        commandLog.push(["kubectl", "--insecure-skip-tls-verify", ...rollbackArgs].join(" "));
        rollbackCompletedAt = new Date().toISOString();
      } catch (rollbackError) {
        rollbackNote =
          `Rollout failed and rollback via ${KUBECTL_ROLLOUT_UNDO_HINT} also failed: ${toErrorMessage(rollbackError)}`;
      }

      const terminalMessage =
        `${failureMessage} Attempt ${attemptLabel} exhausted the workflow retry policy and triggered ${KUBECTL_ROLLOUT_UNDO_HINT}. ${rollbackNote}`;

      workflowState = withWorkflowUpdateRetry(
        workflowState,
        createWorkflowUpdateRetryRecord({
          attempt,
          maxAttempts: UPDATE_DEPLOY_MAX_ATTEMPTS,
          lastAttemptStartedAt: attemptStartedAt,
          lastOutcomeStatus: "failed",
          lastOutcomeAt: rollbackCompletedAt ?? failedAt,
          lastOutcomeMessage: `Attempt ${attemptLabel} exhausted the workflow retry policy and ended in terminal failure.`,
          lastFailureAt: failedAt,
          lastFailureMessage: terminalMessage,
          exhausted: true,
          terminalFailure: true,
          rollbackCompletedAt,
        }),
        rollbackCompletedAt ?? failedAt,
      );
      await writeWorkflowStateArtifact(paths, workflowState);
      await writeUpdateFailureArtifact(
        state,
        rollbackCompletedAt ?? failedAt,
        rollbackNote,
      );

      throw new FatalError(terminalMessage);
    }
  }

  throw new FatalError("Update retry policy exhausted without returning a terminal update result.");
}

export async function prepareWorkflowExecution(
  input: SealosDeployWorkflowInput,
  runOptions: WorkflowRunOptions = {},
): Promise<PreparedExecution> {
  const paths = getArtifactPaths(input.workDir);
  const startMode = runOptions.startMode ?? "auto";
  const runId = runOptions.runId ?? randomUUID();
  const resumeInput = runOptions.resumeInput ?? {};

  if (startMode === "restart") {
    await deleteWorkflowStateArtifact(paths);
    const now = new Date().toISOString();
    return {
      runtimeState: createInitialRuntimeState(input, resumeInput),
      workflowState: createWorkflowStateArtifact(runId, now),
      resumeFromStep: null,
    };
  }

  const existingWorkflowState = await readWorkflowStateArtifact(paths);
  if (!existingWorkflowState) {
    if (startMode === "resume") {
      throw new FatalError("Cannot resume: .sealos/workflow-state.json does not exist.");
    }

    const now = new Date().toISOString();
    return {
      runtimeState: createInitialRuntimeState(input, resumeInput),
      workflowState: createWorkflowStateArtifact(runId, now),
      resumeFromStep: null,
    };
  }

  const validation = await validateWorkflowResumeState(paths, existingWorkflowState);
  const waitingStatus =
    existingWorkflowState.status === "waiting" && existingWorkflowState.pending_gate !== null;
  const resumableStatus =
    existingWorkflowState.status === "resumable"
    || existingWorkflowState.status === "failed"
    || waitingStatus;
  const artifactPresenceBridgeLaunch =
    existingWorkflowState.resume.migration_source === "artifact-presence-bridge"
    && existingWorkflowState.run_id === runId
    && existingWorkflowState.resume.resume_count === 0
    && existingWorkflowState.resume.last_resumed_at === null;

  if (startMode === "resume" && !resumableStatus) {
    throw new FatalError(
      "Cannot resume: .sealos/workflow-state.json does not describe a resumable or failed run.",
    );
  }

  if (!validation.canResume) {
    const restartedAt = new Date().toISOString();
    const restartGate = createRestartConfirmationGate(
      `${validation.message ?? "Workflow-state checkpoint mismatch."} Restart is required before this run can continue.`,
      validation.failedCheckpoint,
      restartedAt,
    );
    const restartWorkflowState = withPendingGate(
      {
        ...existingWorkflowState,
        run_id: runId,
      },
      restartGate,
      restartedAt,
    );
    await writeWorkflowStateArtifact(paths, restartWorkflowState);

    return {
      runtimeState: await hydrateRuntimeState(input, restartWorkflowState, resumeInput),
      workflowState: restartWorkflowState,
      resumeFromStep: null,
    };
  }

  if (startMode === "resume" && validation.resumeFromStep === null && !waitingStatus) {
    throw new FatalError(
      "Cannot resume: all resumable checkpoints are already complete. Use --restart for a fresh run.",
    );
  }

  if (startMode === "auto") {
    if (existingWorkflowState.status === "completed") {
      const now = new Date().toISOString();
      return {
        runtimeState: createInitialRuntimeState(input, resumeInput),
        workflowState: createWorkflowStateArtifact(runId, now),
        resumeFromStep: null,
      };
    }

    if (!validation.resumeFromStep && !waitingStatus) {
      const now = new Date().toISOString();
      return {
        runtimeState: createInitialRuntimeState(input, resumeInput),
        workflowState: createWorkflowStateArtifact(runId, now),
        resumeFromStep: null,
      };
    }
  }

  const resumedAt = new Date().toISOString();
  const resumedWorkflowState: WorkflowStateArtifact = {
    ...existingWorkflowState,
    run_id: runId,
    status: waitingStatus ? "waiting" : resumableStatus ? existingWorkflowState.status : "resumable",
    current_step: waitingStatus ? existingWorkflowState.current_step : null,
    completed_at: null,
    pending_gate: existingWorkflowState.pending_gate,
    updated_at: resumedAt,
    resume: {
      ...existingWorkflowState.resume,
      resume_from_step: validation.resumeFromStep,
      resume_count: artifactPresenceBridgeLaunch
        ? existingWorkflowState.resume.resume_count
        : existingWorkflowState.resume.resume_count + 1,
      last_resumed_at: artifactPresenceBridgeLaunch
        ? existingWorkflowState.resume.last_resumed_at
        : resumedAt,
    },
  };

  return {
    runtimeState: await hydrateRuntimeState(input, resumedWorkflowState, resumeInput),
    workflowState: resumedWorkflowState,
    resumeFromStep: validation.resumeFromStep,
  };
}

export async function sealosDeployWorkflow(
  input: SealosDeployWorkflowInput,
  runOptions: WorkflowRunOptions = {},
): Promise<SealosDeployWorkflowResult> {
  "use workflow";

  const paths = getArtifactPaths(input.workDir);
  let activeStep: WorkflowStepName | null = null;
  const prepared = await prepareWorkflowExecution(input, runOptions);
  let state = prepared.runtimeState;
  let workflowState = prepared.workflowState;
  const resumeFromStep = prepared.resumeFromStep;

  await writeWorkflowStateArtifact(paths, syncWorkflowMetadata(workflowState, state));

  try {
    for (const { step, execute } of STEP_CHAIN) {
      if (
        step === "preflight"
        && (!state.input.dryRun || workflowState.pending_gate?.name === "restart-confirmation")
      ) {
        const gateResolution = await handlePreflightHumanGates(state, workflowState, runOptions, paths);
        state = gateResolution.state;
        workflowState = gateResolution.workflowState;
        if (gateResolution.outcome) {
          return gateResolution.outcome;
        }
      }

      if (
        (step === "detect-image" || step === "dockerfile" || step === "build-push")
        && !state.input.dryRun
        && !shouldSkipForResume(step, resumeFromStep)
      ) {
        const gateResolution = await handlePostAssessHumanGates(state, workflowState, paths);
        state = gateResolution.state;
        workflowState = gateResolution.workflowState;
        if (gateResolution.outcome) {
          return gateResolution.outcome;
        }
      }

      if (step === "deploy" && !state.input.dryRun) {
        const gateResolution = await handlePreDeployHumanGates(state, workflowState, paths);
        state = gateResolution.state;
        workflowState = gateResolution.workflowState;
        if (gateResolution.outcome) {
          return gateResolution.outcome;
        }
      }

      const checkpoint = workflowState.checkpoints.find((entry) => entry.step === step);
      if (checkpoint && shouldSkipForResume(step, resumeFromStep)) {
        state = {
          ...state,
          stepResults: [...state.stepResults, checkpointSkipResult(checkpoint)],
        };
        continue;
      }

      if (state.executionMode === "update" && UPDATE_MODE_SKIPPED_STEPS.has(step)) {
        const summary = `Skipped ${step} because update mode reuses the existing deployment and only applies a new image.`;
        state = {
          ...state,
          stepResults: [
            ...state.stepResults,
            {
              step,
              status: "skipped",
              summary,
              warnings: [],
              artifactPaths: [],
              stdoutJson: {
                execution_mode: "update",
                skipped_for_update_mode: true,
              },
            },
          ],
        };
        continue;
      }

      activeStep = step;
      workflowState = syncWorkflowMetadata(
        markWorkflowStepRunning(workflowState, step, new Date().toISOString()),
        state,
      );
      await writeWorkflowStateArtifact(paths, workflowState);

      let nextState: WorkflowRuntimeState;
      let result: WorkflowStepResult;
      if (step === "deploy" && state.executionMode === "update") {
        const updateExecution = await executeUpdateDeployStep(state, workflowState, paths);
        nextState = updateExecution.state;
        workflowState = updateExecution.workflowState;
        result = updateExecution.result;
      } else {
        const execution = await execute(state);
        nextState = execution.state;
        result = execution.result;
      }
      state = {
        ...nextState,
        stepResults: [...state.stepResults, result],
        stepsCompleted:
          result.status === "skipped"
            ? state.stepsCompleted
            : uniqueSteps([...state.stepsCompleted, result.step]),
      };

      if (isResumableStep(result.step) && result.status !== "skipped") {
        const completedAt = new Date().toISOString();
        const extraArtifactPaths =
          result.step === "deploy"
            ? state.executionMode === "update"
              ? await writeUpdateSuccessArtifact(state, completedAt)
              : await writeDeployFactsArtifact(state, result as WorkflowStepResult<DeployTemplateOutput>, completedAt)
            : [];

        workflowState = syncWorkflowMetadata(
          applyWorkflowCheckpoint(
            workflowState,
            buildCheckpointRecord(result, completedAt, state.imageRef, extraArtifactPaths),
            completedAt,
          ),
          state,
        );
        await writeWorkflowStateArtifact(paths, workflowState);
      } else if (REPLAY_ONLY_STEPS.has(result.step)) {
        workflowState = syncWorkflowMetadata({
          ...workflowState,
          current_step: null,
          updated_at: new Date().toISOString(),
        }, state);
        await writeWorkflowStateArtifact(paths, workflowState);
      }

      activeStep = null;
    }

    workflowState = syncWorkflowMetadata(
      markWorkflowCompleted(workflowState, new Date().toISOString()),
      state,
    );
    await writeWorkflowStateArtifact(paths, workflowState);

    return {
      status: "success",
      ...buildWorkflowResultBase(state),
    };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const persistedWorkflowState = await readWorkflowStateArtifact(paths);
    if (persistedWorkflowState?.run_id === workflowState.run_id) {
      workflowState = persistedWorkflowState;
    }
    const failedStep = activeStep ?? workflowState.current_step ?? resumeFromStep ?? "preflight";
    workflowState = syncWorkflowMetadata(
      markWorkflowFailed(workflowState, failedStep, toErrorMessage(error), failedAt),
      state,
    );

    try {
      await writeWorkflowStateArtifact(paths, workflowState);
    } catch {
      // Preserve the original workflow failure if the failure marker cannot be persisted.
    }

    throw error;
  }
}
