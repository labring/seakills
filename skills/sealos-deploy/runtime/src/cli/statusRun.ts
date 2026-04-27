import { exit } from "node:process";
import { fileURLToPath } from "node:url";

import { readWorkflowStatusSummaryForDir } from "../lib/artifacts";
import { buildRecoveryCommand, buildRestartCommand } from "../lib/operatorGuidance";
import type { WorkflowStatusSummary } from "../types";

interface CliOptions {
  workDir: string | null;
  help: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    workDir: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if ((arg === "--dir" || arg === "-d") && argv[index + 1]) {
      options.workDir = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

function formatRuntimeStatus(summary: WorkflowStatusSummary) {
  if (!summary.runtime_status) {
    return "not available";
  }

  const details: string[] = [];
  if (summary.resume) {
    details.push(`resume count ${summary.resume.resume_count}`);
    if (summary.resume.last_resumed_at) {
      details.push(`last resumed ${summary.resume.last_resumed_at}`);
    }
    if (summary.resume.resume_from_step) {
      details.push(`resume from ${summary.resume.resume_from_step}`);
    }
  }

  return details.length > 0
    ? `${summary.runtime_status} (${details.join("; ")})`
    : summary.runtime_status;
}

function formatPendingGate(summary: WorkflowStatusSummary) {
  if (!summary.pending_gate) {
    return "none";
  }

  return `${summary.pending_gate.name} (${summary.pending_gate.resume_hint})`;
}

function formatLastFailure(summary: WorkflowStatusSummary) {
  if (!summary.last_error) {
    return "none";
  }

  return `${summary.last_error.message} @ ${summary.last_error.at}`;
}

function formatRetryState(summary: WorkflowStatusSummary) {
  if (!summary.retry) {
    return "none";
  }

  const details = [summary.retry.summary];
  if (summary.retry.last_outcome_message && summary.retry.last_outcome_message !== summary.retry.summary) {
    details.push(summary.retry.last_outcome_message);
  }
  if (summary.retry.last_failure_at) {
    details.push(`last failure ${summary.retry.last_failure_at}`);
  }

  return details.join("; ");
}

function formatLastDeploy(summary: WorkflowStatusSummary) {
  if (!summary.last_deploy) {
    return "none";
  }

  return [
    `${summary.last_deploy.app_name} in ${summary.last_deploy.namespace}`,
    `region ${summary.last_deploy.region}`,
    `image ${summary.last_deploy.image}`,
    `url ${summary.last_deploy.url}`,
  ].join(" | ");
}

function formatRecovery(workDir: string, summary: WorkflowStatusSummary) {
  if (summary.pending_gate) {
    return buildRecoveryCommand(workDir, summary.pending_gate);
  }

  if (summary.last_error) {
    return buildRestartCommand(workDir);
  }

  return "Run status:run again after the next workflow action. Legacy fallback is disabled.";
}

export function formatStatusReport(workDir: string, summary: WorkflowStatusSummary) {
  return [
    `Workflow: ${summary.workflow}`,
    `Directory: ${workDir}`,
    `Mode: ${summary.mode ?? "not available"}`,
    `Runtime status: ${formatRuntimeStatus(summary)}`,
    `Current step: ${summary.current_step ?? "none"}`,
    `Pending gate: ${formatPendingGate(summary)}`,
    `Latest failure: ${formatLastFailure(summary)}`,
    `Retry state: ${formatRetryState(summary)}`,
    `Last deploy: ${formatLastDeploy(summary)}`,
    `Recovery: ${formatRecovery(workDir, summary)}`,
  ].join("\n");
}

export async function readAndFormatStatusReport(workDir: string) {
  const summary = await readWorkflowStatusSummaryForDir(workDir);
  return formatStatusReport(workDir, summary);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: pnpm status:run --dir <work-dir>");
    return;
  }
  if (!options.workDir) {
    console.error("Usage: pnpm status:run --dir <work-dir>");
    exit(1);
  }

  console.log(await readAndFormatStatusReport(options.workDir));
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
