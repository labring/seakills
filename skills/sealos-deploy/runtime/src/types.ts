export const DEFAULT_RUNTIME_PORT = 4318;

export type WorkflowStepName =
  | "preflight"
  | "assess"
  | "detect-image"
  | "dockerfile"
  | "build-push"
  | "template"
  | "deploy"
  | "validate-artifacts";

export type WorkflowStepStatus = "success" | "skipped" | "dry-run";

export type WorkflowRuntimeStatus = "running" | "waiting" | "resumable" | "failed" | "completed";
export type WorkflowStartMode = "auto" | "resume" | "restart";
export type WorkflowExecutionMode = "deploy" | "update";
export type WorkflowPendingGateKind = "auth" | "input" | "confirmation";
export type WorkflowPendingGateStatus = "waiting";
export type WorkflowPendingGateName =
  | "region-selection"
  | "sealos-auth"
  | "workspace-selection"
  | "workspace-change-confirmation"
  | "deploy-inputs"
  | "restart-confirmation"
  | "deploy-apply-confirmation"
  | "deployment-mode-confirmation";

export type LanguageKind =
  | "go"
  | "rust"
  | "java"
  | "node"
  | "python"
  | "php"
  | "ruby"
  | "dotnet";

export type PackageManagerKind =
  | "npm"
  | "yarn"
  | "pnpm"
  | "bun"
  | "pip"
  | "pipenv"
  | "go"
  | "cargo"
  | "maven"
  | "gradle"
  | "composer"
  | "bundler";

export type DatabaseKind = "postgres" | "mysql" | "mongodb" | "redis" | "sqlite";

export interface ScriptExecutionResult<T = unknown> {
  command: string[];
  stdoutText: string;
  stderrText: string;
  stdoutJson: T;
}

export interface WorkflowStepResult<T = unknown> {
  step: WorkflowStepName;
  status: WorkflowStepStatus;
  summary: string;
  command?: string[];
  stdoutText?: string;
  stderrText?: string;
  stdoutJson?: T;
  warnings: string[];
  artifactPaths: string[];
}

export interface WorkflowCheckpointRecord {
  step: WorkflowStepName;
  status: WorkflowStepStatus;
  completed_at: string;
  artifact_paths: string[];
  summary: string;
  image_ref?: string;
}

export interface WorkflowResumeMetadata {
  resume_from_step: WorkflowStepName | null;
  resume_count: number;
  last_resumed_at: string | null;
  migration_source: string | null;
}

export interface WorkflowFailureRecord {
  step: WorkflowStepName;
  message: string;
  at: string;
}

export type WorkflowUpdateAttemptOutcome = "running" | "retrying" | "succeeded" | "failed";

export interface WorkflowUpdateAttemptRecord {
  attempt: number;
  max_attempts: number;
  last_attempt_started_at?: string | null;
  last_outcome_status?: WorkflowUpdateAttemptOutcome;
  last_outcome_at?: string | null;
  last_outcome_message?: string | null;
  last_failure_at: string | null;
  last_failure_message: string | null;
  exhausted?: boolean;
  terminal_failure: boolean;
  rollback_completed_at: string | null;
}

export interface WorkflowStatusPendingGateSummary {
  kind: WorkflowPendingGateKind;
  name: WorkflowPendingGateName;
  step?: WorkflowStepName;
  status: WorkflowPendingGateStatus;
  prompt: string;
  created_at: string;
  expires_at: string | null;
  resume_hint: string;
}

export interface WorkflowStatusRetrySummary {
  attempt: number;
  max_attempts: number;
  remaining_attempts: number;
  last_attempt_started_at: string | null;
  last_outcome_status: WorkflowUpdateAttemptOutcome;
  last_outcome_at: string | null;
  last_outcome_message: string | null;
  last_failure_at: string | null;
  last_failure_message: string | null;
  exhausted: boolean;
  terminal_failure: boolean;
  rollback_completed_at: string | null;
  summary: string;
}

export interface WorkflowPendingGate {
  kind: WorkflowPendingGateKind;
  name: WorkflowPendingGateName;
  step?: WorkflowStepName;
  status: WorkflowPendingGateStatus;
  prompt: string;
  payload: Record<string, unknown>;
  created_at: string;
  expires_at: string | null;
  resume_hint: string;
}

export interface WorkflowStateArtifact {
  version: "1.0";
  workflow: "sealos-deploy";
  run_id: string;
  status: WorkflowRuntimeStatus;
  execution_mode: WorkflowExecutionMode;
  execution_summary: string;
  deployment_choice: "new-instance" | "update" | null;
  update_target: WorkflowUpdateTarget | null;
  update_attempt: WorkflowUpdateAttemptRecord | null;
  current_step: WorkflowStepName | null;
  steps_completed: WorkflowStepName[];
  checkpoints: WorkflowCheckpointRecord[];
  resume: WorkflowResumeMetadata;
  last_error: WorkflowFailureRecord | null;
  pending_gate: WorkflowPendingGate | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface WorkflowResumeValidationResult {
  canResume: boolean;
  resumeFromStep: WorkflowStepName | null;
  failedCheckpoint?: WorkflowStepName;
  message?: string;
}

export interface EnvVarDescriptor {
  category: "auto" | "required" | "optional";
  description?: string;
  default?: string;
}

export interface AnalysisArtifact {
  generated_at: string;
  project: {
    github_url: string | null;
    work_dir: string;
    repo_name: string;
    branch: string | null;
  };
  score: {
    total: number;
    verdict: string;
    dimensions: {
      statelessness: number;
      config: number;
      scalability: number;
      startup: number;
      observability: number;
      boundaries: number;
    };
  };
  language: LanguageKind;
  all_languages: LanguageKind[];
  framework: string;
  package_manager: PackageManagerKind;
  port: number;
  databases: DatabaseKind[];
  runtime_version: Record<string, string>;
  env_vars: Record<string, EnvVarDescriptor>;
  has_dockerfile: boolean;
  complexity_tier: "L1" | "L2" | "L3";
  image_ref: string | null;
}

export interface ScoreModelOutput {
  score: number;
  raw_score: number;
  bonus: number;
  verdict: string;
  dimensions: AnalysisArtifact["score"]["dimensions"];
  dimension_details: Record<string, string>;
  bonus_reasons: string[];
  signals: {
    language: LanguageKind[];
    primary_language: LanguageKind | null;
    framework: string[];
    has_http_server: boolean;
    external_db: boolean;
    has_docker: boolean;
    is_monorepo: boolean;
    has_env_example: boolean;
    package_manager: PackageManagerKind;
    port: number | null;
    port_source: string;
    databases: DatabaseKind[];
    runtime_version: Record<string, string>;
  };
}

export interface DetectImageOutput {
  found: boolean;
  image?: string;
  tag?: string | null;
  source?: string;
  platforms?: string[];
  error?: string;
}

export interface BuildPushOutput {
  success: boolean;
  image?: string;
  registry?: string;
  warning?: string;
  requires_image_pull_secret?: boolean;
  error?: string;
}

export type SealosHistoryAction = "deploy" | "set-image" | "set-env" | "patch" | "restart";
export type SealosHistoryMethod =
  | "template-api"
  | "kubectl-apply"
  | "kubectl-set-image"
  | "kubectl-set-env"
  | "kubectl-patch"
  | "kubectl-rollout-restart";

export interface SealosLastDeployRecord {
  app_name: string;
  app_host: string;
  namespace: string;
  region: string;
  image: string;
  docker_hub_user: string | null;
  repo_name: string;
  url: string;
  deployed_at: string;
  last_updated_at: string;
}

export interface WorkflowStatusSummary {
  workflow: "sealos-deploy";
  mode: WorkflowExecutionMode | null;
  runtime_status: WorkflowRuntimeStatus | null;
  current_step: WorkflowStepName | null;
  pending_gate: WorkflowStatusPendingGateSummary | null;
  last_error: WorkflowFailureRecord | null;
  resume: WorkflowResumeMetadata | null;
  retry: WorkflowStatusRetrySummary | null;
  last_deploy: SealosLastDeployRecord | null;
}

export interface SealosHistoryEntry {
  at: string;
  action: SealosHistoryAction;
  method: SealosHistoryMethod;
  status: "success" | "failed";
  image?: string;
  previous_image?: string;
  changes?: string[];
  note?: string;
}

export interface SealosStateArtifact {
  version: "1.0";
  last_deploy: SealosLastDeployRecord;
  history: SealosHistoryEntry[];
}

export interface DeployTemplateOutput {
  success: boolean;
  dry_run: boolean;
  app_name?: string;
  app_host?: string;
  namespace?: string;
  method?: "template-api" | "kubectl-apply";
  region?: string;
  region_domain?: string;
  deploy_url?: string;
  template_path?: string;
  args?: Record<string, string>;
  status?: number;
  response?: unknown;
}

export interface ValidateArtifactsOutput {
  valid: boolean;
  results?: Array<{
    file: string;
    valid: boolean;
    errors?: Array<{ path: string; message: string }>;
  }>;
  error?: string;
}

export interface ArtifactPaths {
  workDir: string;
  sealosDir: string;
  config: string;
  dockerfile: string;
  analysis: string;
  buildDir: string;
  buildResult: string;
  templateDir: string;
  templateFile: string;
  state: string;
  workflowState: string;
}

export interface WorkflowConfigArtifact {
  port?: number;
  node_version?: string;
  start_command?: string;
  build_command?: string;
  system_deps?: string[];
  base_image?: string;
  docker_hub_user?: string;
  env_overrides?: Record<string, string>;
  skip_phases?: string[];
}

export interface SealosDeployWorkflowInput {
  workDir: string;
  repoName: string;
  githubUrl: string | null;
  branch: string | null;
  dryRun: boolean;
  title?: string;
  description?: string;
  url?: string;
  author: string;
  categories: string[];
}

export interface WorkflowRunOptions {
  startMode?: WorkflowStartMode;
  runId?: string;
  resumeInput?: WorkflowResumeInput;
}

export interface WorkflowResumeInput {
  region?: string;
  workspace?: string;
  config_overrides?: Record<string, unknown>;
  env_overrides?: Record<string, string>;
  approval?: string;
}

export interface WorkflowRunRequest extends Partial<SealosDeployWorkflowInput> {
  workDir: string;
  wait?: boolean;
  resume?: boolean;
  restart?: boolean;
  region?: string;
  workspace?: string;
  config_overrides?: Record<string, unknown>;
  env_overrides?: Record<string, string>;
  approval?: string;
}

export interface WorkflowUpdateTarget {
  app_name: string;
  namespace: string;
  region: string;
  image: string;
  repo_name: string;
  url: string;
}

export interface WorkflowRuntimeState {
  input: SealosDeployWorkflowInput;
  config?: WorkflowConfigArtifact;
  analysis?: AnalysisArtifact;
  imageRef: string | null;
  executionMode: WorkflowExecutionMode;
  executionSummary: string;
  deploymentChoice: "new-instance" | "update" | null;
  updateTarget: WorkflowUpdateTarget | null;
  region: string | null;
  workspace: string | null;
  resumeInput: WorkflowResumeInput;
  stepResults: WorkflowStepResult[];
  stepsCompleted: WorkflowStepName[];
}

export interface SealosDeployWorkflowSuccessResult {
  status: "success";
  workDir: string;
  artifactDir: string;
  imageRef: string | null;
  executionMode: WorkflowExecutionMode;
  executionSummary: string;
  updateTarget: WorkflowUpdateTarget | null;
  stepsCompleted: WorkflowStepName[];
  stepResults: WorkflowStepResult[];
}

export interface SealosDeployWorkflowWaitingResult {
  status: "waiting";
  workDir: string;
  artifactDir: string;
  imageRef: string | null;
  executionMode: WorkflowExecutionMode;
  executionSummary: string;
  updateTarget: WorkflowUpdateTarget | null;
  stepsCompleted: WorkflowStepName[];
  stepResults: WorkflowStepResult[];
  pendingGate: WorkflowPendingGate;
}

export interface SealosDeployWorkflowBlockedResult {
  status: "blocked";
  workDir: string;
  artifactDir: string;
  imageRef: string | null;
  executionMode: WorkflowExecutionMode;
  executionSummary: string;
  updateTarget: WorkflowUpdateTarget | null;
  stepsCompleted: WorkflowStepName[];
  stepResults: WorkflowStepResult[];
  message: string;
  pendingGate: WorkflowPendingGate | null;
}

export type SealosDeployWorkflowResult =
  | SealosDeployWorkflowSuccessResult
  | SealosDeployWorkflowWaitingResult
  | SealosDeployWorkflowBlockedResult;

export interface WorkflowApiRunResponse {
  status: "started" | "completed";
  runId?: string;
  wait: boolean;
  workflow: string;
  healthPath: string;
  executionMode?: WorkflowExecutionMode;
  executionSummary?: string;
  updateTarget?: WorkflowUpdateTarget | null;
  result?: SealosDeployWorkflowResult;
  pendingGate?: WorkflowPendingGate | null;
}
