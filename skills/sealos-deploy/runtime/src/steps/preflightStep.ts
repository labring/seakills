import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { FatalError } from "workflow";

import type { WorkflowRuntimeState, WorkflowStepResult } from "../types";
import { runNodeScript } from "../lib/runNodeScript";

const execFileAsync = promisify(execFile);

type ToolStatus = { available: boolean; output: string | null };
type ToolMap = {
  git: ToolStatus;
  curl: ToolStatus;
  docker: ToolStatus;
  python3: ToolStatus;
  gh: ToolStatus;
};

async function checkTool(command: string, args: string[] = ["--version"]) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      maxBuffer: 1024 * 1024,
    });
    return {
      available: true,
      output: (stdout || stderr).trim(),
    };
  } catch {
    return {
      available: false,
      output: null,
    };
  }
}

export function evaluatePreflightTools(tools: ToolMap, dryRun: boolean) {
  const warnings: string[] = [];
  const blockingTools = ["git", "curl"] as const;
  const missingBlockingTools = blockingTools.filter((tool) => !tools[tool].available);

  if (missingBlockingTools.length > 0) {
    const message = `Missing required preflight tools: ${missingBlockingTools.join(", ")}`;
    if (dryRun) {
      warnings.push(`${message}. Dry-run mode will continue with synthetic side effects.`);
    } else {
      return { fatalMessage: message, warnings };
    }
  }

  if (!tools.docker.available) {
    warnings.push("Docker CLI is not available; this is OK if detect-image finds a reusable image. Docker is deferred until local image build/push is required.");
  }

  if (!tools.python3.available) {
    warnings.push("python3 is not available; template validation helpers may be limited in later phases.");
  }

  if (!tools.gh.available) {
    warnings.push("gh CLI is not available; GHCR auto-detection may be limited.");
  }

  return { fatalMessage: null, warnings };
}

export async function preflightStep(state: WorkflowRuntimeState): Promise<{
  state: WorkflowRuntimeState;
  result: WorkflowStepResult<{
    tools: Record<string, { available: boolean; output: string | null }>;
    auth: { authenticated: boolean; region?: string; workspace?: string };
    selected_region: string | null;
  }>;
}> {
  "use step";

  const tools: ToolMap = {
    git: await checkTool("git"),
    curl: await checkTool("curl", ["--version"]),
    docker: await checkTool("docker"),
    python3: await checkTool("python3", ["--version"]),
    gh: await checkTool("gh", ["--version"]),
  };

  const authCheck = state.input.dryRun
    ? null
    : await runNodeScript<{
      authenticated: boolean;
      region?: string;
      workspace?: string;
    }>("scripts/sealos-auth.mjs", ["check"], {
      cwd: state.input.workDir,
    });
  const auth = authCheck?.stdoutJson ?? { authenticated: false };

  const { fatalMessage, warnings } = evaluatePreflightTools(tools, state.input.dryRun);
  if (fatalMessage) {
    throw new FatalError(fatalMessage);
  }

  if (!auth.authenticated) {
    const message = "Sealos authentication is not ready for the workflow path.";
    if (state.input.dryRun) {
      warnings.push(`${message} Dry-run mode stays local-only and will skip auth-dependent workflow gates.`);
    } else {
      throw new FatalError(message);
    }
  }

  return {
    state: {
      ...state,
      region: state.region ?? auth.region ?? null,
      workspace: state.workspace ?? auth.workspace ?? null,
    },
    result: {
      step: "preflight",
      status: "success",
      summary: state.input.dryRun
        ? `Preflight checked git/curl/docker/python3/gh for ${state.input.repoName} and skipped live Sealos auth checks in dry-run mode.`
        : `Preflight checked git/curl/docker/python3/gh and auth readiness for ${state.input.repoName} in ${state.region ?? auth.region ?? "unknown-region"}.`,
      command: authCheck?.command,
      stdoutText: authCheck?.stdoutText,
      stderrText: authCheck?.stderrText,
      stdoutJson: {
        tools,
        auth,
        selected_region: state.region ?? null,
      },
      warnings,
      artifactPaths: [],
    },
  };
}
