import { fileURLToPath } from "node:url";

import type { WorkflowPendingGate } from "../types";

const RUNTIME_DIR = fileURLToPath(new URL("../..", import.meta.url));
const GUIDE_PATH = fileURLToPath(new URL("../../../docs/sealos-deploy-workflow.md", import.meta.url));

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildStartCommand(workDir: string) {
  return `pnpm --dir ${shellQuote(RUNTIME_DIR)} start:run --dir ${shellQuote(workDir)}`;
}

export function getOperatorGuidePath() {
  return GUIDE_PATH;
}

export function buildStatusCommand(workDir: string) {
  return `pnpm --dir ${shellQuote(RUNTIME_DIR)} status:run --dir ${shellQuote(workDir)}`;
}

export function buildRestartCommand(workDir: string) {
  return `${buildStartCommand(workDir)} --restart`;
}

export function buildRecoveryCommand(
  workDir: string,
  pendingGate?: Pick<WorkflowPendingGate, "name"> | null,
) {
  switch (pendingGate?.name) {
    case "restart-confirmation":
      return buildRestartCommand(workDir);
    case "region-selection":
      return `${buildStartCommand(workDir)} --resume --region <region>`;
    case "sealos-auth":
      return `${buildStartCommand(workDir)} --resume`;
    case "workspace-selection":
      return `${buildStartCommand(workDir)} --resume --workspace <workspace-id>`;
    case "workspace-change-confirmation":
      return `${buildStartCommand(workDir)} --resume --approval approve`;
    case "deploy-inputs":
      return `${buildStartCommand(workDir)} --resume --config-overrides '<json>' --env-overrides '<json>'`;
    case "deploy-apply-confirmation":
      return `${buildStartCommand(workDir)} --resume --approval approve`;
    case "deployment-mode-confirmation":
      return `${buildStartCommand(workDir)} --resume --approval <update|new-instance>`;
    default:
      return buildStatusCommand(workDir);
  }
}
