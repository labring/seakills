import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";

import { start } from "workflow/api";

import {
  DEFAULT_RUNTIME_PORT,
  type WorkflowRunOptions,
  type WorkflowRunRequest,
  type SealosDeployWorkflowInput,
  type WorkflowApiRunResponse,
} from "./types";
import {
  buildWorkflowStatusSummary,
  getArtifactPaths,
  readWorkflowStatusSummaryForDir,
  readWorkflowStateArtifact,
  seedWorkflowStateFromLegacyArtifacts,
} from "./lib/artifacts";
import { sealosDeployWorkflow } from "./workflows/sealosDeploy";

function readGitValue(workDir: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", workDir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

export function normalizeWorkflowInput(
  input: Partial<SealosDeployWorkflowInput> & { workDir: string },
): SealosDeployWorkflowInput {
  const workDir = resolve(input.workDir);
  const repoName = input.repoName ?? basename(workDir);
  const githubUrl = input.githubUrl ?? readGitValue(workDir, ["remote", "get-url", "origin"]);
  const branch = input.branch ?? readGitValue(workDir, ["branch", "--show-current"]);

  return {
    workDir,
    repoName,
    githubUrl,
    branch,
    dryRun: input.dryRun ?? false,
    title: input.title ?? repoName,
    description: input.description,
    url: input.url,
    author: input.author ?? "Seakills",
    categories: input.categories?.length ? input.categories : ["backend"],
  };
}

export function normalizeWorkflowRunOptions(
  input: Pick<
    WorkflowRunRequest,
    "resume" | "restart" | "region" | "workspace" | "config_overrides" | "env_overrides" | "approval"
  >,
  options: { runId?: string } = {},
): WorkflowRunOptions {
  if (input.resume && input.restart) {
    throw new Error("resume and restart cannot both be true");
  }

  return {
    startMode: input.restart ? "restart" : input.resume ? "resume" : "auto",
    runId: options.runId ?? randomUUID(),
    resumeInput: {
      ...(input.region ? { region: input.region } : {}),
      ...(input.workspace ? { workspace: input.workspace } : {}),
      ...(input.config_overrides ? { config_overrides: input.config_overrides } : {}),
      ...(input.env_overrides ? { env_overrides: input.env_overrides } : {}),
      ...(input.approval ? { approval: input.approval } : {}),
    },
  };
}

export async function prepareWorkflowLaunch(
  input: SealosDeployWorkflowInput,
  runOptions: WorkflowRunOptions = {},
) {
  const normalizedRunOptions = {
    startMode: runOptions.startMode ?? "auto",
    runId: runOptions.runId ?? randomUUID(),
    resumeInput: runOptions.resumeInput ?? {},
  } satisfies WorkflowRunOptions;

  // Default no-flag starts may seed artifact-presence-bridge when only legacy .sealos artifacts exist.
  if (normalizedRunOptions.startMode === "auto") {
    const paths = getArtifactPaths(input.workDir);
    const existingWorkflowState = await readWorkflowStateArtifact(paths);
    if (!existingWorkflowState) {
      await seedWorkflowStateFromLegacyArtifacts(paths, normalizedRunOptions.runId!);
    }
  }

  return normalizedRunOptions;
}

export async function health(workDir?: string | null) {
  const status_summary = workDir
    ? await readWorkflowStatusSummaryForDir(workDir)
    : buildWorkflowStatusSummary(null, null);

  return {
    status: "ok",
    workflow: sealosDeployWorkflow.name,
    scope: "preflight -> assess -> deployment-mode -> build-path -> deploy/update",
    note: "Maintainer runtime now supports fresh deploys plus the Phase 4 image-update path for verified live deployments.",
    endpoints: {
      health: "/api/health",
      runs: "/api/runs",
    },
    port: Number(process.env.PORT ?? DEFAULT_RUNTIME_PORT),
    retry: status_summary.retry,
    status_summary,
  };
}

export async function startSealosDeployRun(
  input: SealosDeployWorkflowInput,
  options: { wait?: boolean; runOptions?: WorkflowRunOptions } = {},
): Promise<WorkflowApiRunResponse> {
  const runOptions = await prepareWorkflowLaunch(input, options.runOptions);
  const run = await start(sealosDeployWorkflow, [input, runOptions]);
  if (options.wait) {
    const result = await run.returnValue;
    const pendingGate = result.status === "success" ? undefined : result.pendingGate;
    return {
      status: "completed",
      runId: runOptions.runId,
      wait: true,
      workflow: sealosDeployWorkflow.name,
      healthPath: "/api/health",
      executionMode: result.executionMode,
      executionSummary: result.executionSummary,
      updateTarget: result.updateTarget,
      result,
      ...(pendingGate !== undefined ? { pendingGate } : {}),
    };
  }

  return {
    status: "started",
    runId: runOptions.runId,
    wait: false,
    workflow: sealosDeployWorkflow.name,
    healthPath: "/api/health",
  };
}

export async function runSealosDeployDirect(
  input: SealosDeployWorkflowInput,
  runOptions?: WorkflowRunOptions,
) {
  const preparedRunOptions = await prepareWorkflowLaunch(input, runOptions);
  return sealosDeployWorkflow(input, preparedRunOptions);
}
