import { exit } from "node:process";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_RUNTIME_PORT,
  type SealosDeployWorkflowInput,
  type WorkflowApiRunResponse,
  type WorkflowPendingGate,
  type WorkflowStartMode,
} from "../types";
import {
  buildRecoveryCommand,
  buildStatusCommand,
  getOperatorGuidePath,
} from "../lib/operatorGuidance";
import { normalizeWorkflowInput, normalizeWorkflowRunOptions, runSealosDeployDirect } from "../server";

interface CliOptions {
  workDir: string | null;
  dryRun: boolean;
  server: boolean;
  wait: boolean;
  baseUrl: string;
  startMode: WorkflowStartMode;
  region: string | null;
  workspace: string | null;
  approval: string | null;
  configOverrides: Record<string, unknown> | null;
  envOverrides: Record<string, string> | null;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    workDir: null,
    dryRun: false,
    server: false,
    wait: true,
    baseUrl: process.env.SEALOS_WORKFLOW_BASE_URL ?? `http://127.0.0.1:${DEFAULT_RUNTIME_PORT}`,
    startMode: "auto",
    region: null,
    workspace: null,
    approval: null,
    configOverrides: null,
    envOverrides: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === "--dir" || arg === "-d") && argv[index + 1]) {
      options.workDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--region" && argv[index + 1]) {
      options.region = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--workspace" && argv[index + 1]) {
      options.workspace = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--approval" && argv[index + 1]) {
      options.approval = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--config-overrides" && argv[index + 1]) {
      options.configOverrides = JSON.parse(argv[index + 1]) as Record<string, unknown>;
      index += 1;
      continue;
    }
    if (arg === "--env-overrides" && argv[index + 1]) {
      options.envOverrides = JSON.parse(argv[index + 1]) as Record<string, string>;
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--resume") {
      options.startMode = "resume";
      continue;
    }
    if (arg === "--restart") {
      options.startMode = "restart";
      continue;
    }
    if (arg === "--server") {
      options.server = true;
      continue;
    }
    if (arg === "--async") {
      options.wait = false;
      continue;
    }
    if (arg === "--base-url" && argv[index + 1]) {
      options.baseUrl = argv[index + 1];
      index += 1;
      continue;
    }
  }

  const resumeCount = argv.filter((arg) => arg === "--resume").length;
  const restartCount = argv.filter((arg) => arg === "--restart").length;
  if (resumeCount > 0 && restartCount > 0) {
    throw new Error("--resume and --restart cannot be used together.");
  }

  return options;
}

async function runAgainstServer(input: SealosDeployWorkflowInput, options: CliOptions) {
  const response = await fetch(`${options.baseUrl}/api/runs?wait=${options.wait ? "1" : "0"}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...input,
      resume: options.startMode === "resume",
      restart: options.startMode === "restart",
      region: options.region,
      workspace: options.workspace,
      config_overrides: options.configOverrides ?? undefined,
      env_overrides: options.envOverrides ?? undefined,
      approval: options.approval ?? undefined,
      wait: options.wait,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Server start failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<WorkflowApiRunResponse>;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.workDir) {
    console.error("Usage: pnpm start:run --dir <work-dir> [--dry-run] [--resume|--restart] [--region <region>] [--workspace <id>] [--approval <value>] [--config-overrides '{...}'] [--env-overrides '{...}'] [--server] [--async]");
    exit(1);
  }

  const input = normalizeWorkflowInput({
    workDir: options.workDir,
    dryRun: options.dryRun,
  });
  const runOptions = normalizeWorkflowRunOptions({
    resume: options.startMode === "resume",
    restart: options.startMode === "restart",
    region: options.region ?? undefined,
    workspace: options.workspace ?? undefined,
    config_overrides: options.configOverrides ?? undefined,
    env_overrides: options.envOverrides ?? undefined,
    approval: options.approval ?? undefined,
  });

  if (options.server) {
    // The server path uses the same shared launch flow and may seed artifact-presence-bridge on default auto start.
    const payload = await runAgainstServer(input, options);
    const pendingGate: WorkflowPendingGate | null | undefined =
      payload.pendingGate
      ?? (payload.result?.status === "success" ? undefined : payload.result?.pendingGate);
    console.log(JSON.stringify({
      mode: "server",
      workflow: "sealosDeployWorkflow",
      statusCommand: buildStatusCommand(input.workDir),
      recoveryCommand: buildRecoveryCommand(input.workDir, pendingGate),
      operatorGuide: getOperatorGuidePath(),
      legacyFallback: "disabled",
      payload,
    }, null, 2));
    return;
  }

  // Default direct start also flows through artifact-presence-bridge when only legacy .sealos artifacts exist.
  const result = await runSealosDeployDirect(input, runOptions);
  const pendingGate = result.status === "success" ? undefined : result.pendingGate;
  console.log(JSON.stringify({
    mode: "direct",
    workflow: "sealosDeployWorkflow",
    executionMode: result.executionMode,
    executionSummary: result.executionSummary,
    updateTarget: result.updateTarget,
    statusCommand: buildStatusCommand(input.workDir),
    recoveryCommand: buildRecoveryCommand(input.workDir, pendingGate),
    operatorGuide: getOperatorGuidePath(),
    legacyFallback: "disabled",
    result,
    ...(pendingGate !== undefined ? { pendingGate } : {}),
  }, null, 2));
}

const isMainModule = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isMainModule) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    exit(1);
  });
}
