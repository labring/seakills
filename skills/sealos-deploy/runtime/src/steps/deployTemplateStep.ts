import { access, readFile } from "node:fs/promises";

import type {
  DeployTemplateOutput,
  WorkflowRuntimeState,
  WorkflowStepResult,
} from "../types";
import { getArtifactPaths } from "../lib/artifacts";
import { ScriptExecutionError, runNodeScript } from "../lib/runNodeScript";

async function readTemplateDefaults(templatePath: string): Promise<{
  appName: string | null;
  appHost: string | null;
}> {
  const content = await readFile(templatePath, "utf8");
  const lines = content.split(/\r?\n/);
  let inDefaults = false;
  let defaultsIndent = 0;
  let appName: string | null = null;
  let appHost: string | null = null;

  for (const line of lines) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();

    if (!inDefaults) {
      if (trimmed === "defaults:") {
        inDefaults = true;
        defaultsIndent = indent;
      }
      continue;
    }

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (indent <= defaultsIndent) {
      break;
    }

    const match = trimmed.match(/^([A-Za-z0-9_]+):\s*(.+)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    const value = rawValue.replace(/^["']|["']$/g, "").trim();
    if (key === "app_name") {
      appName = value;
    }
    if (key === "app_host") {
      appHost = value;
    }
  }

  return { appName, appHost };
}

function resolveNamespace(state: WorkflowRuntimeState): string {
  const preflightResult = state.stepResults.find((result) => result.step === "preflight");
  const auth = preflightResult?.stdoutJson as { auth?: { workspace?: string } } | undefined;
  return auth?.auth?.workspace ?? "default";
}

export async function deployTemplateStep(state: WorkflowRuntimeState): Promise<{
  state: WorkflowRuntimeState;
  result: WorkflowStepResult<DeployTemplateOutput>;
}> {
  "use step";

  const paths = getArtifactPaths(state.input.workDir);
  await access(paths.templateFile);
  const templateDefaults = await readTemplateDefaults(paths.templateFile);
  const appName = templateDefaults.appName ?? state.input.repoName;
  const appHost = templateDefaults.appHost ?? state.input.repoName;
  const namespace = resolveNamespace(state);

  const args = [paths.templateFile];
  if (state.input.dryRun) {
    args.push("--dry-run");
  }

  try {
    const deployResult = await runNodeScript<DeployTemplateOutput>(
      "scripts/deploy-template.mjs",
      args,
      { cwd: state.input.workDir },
    );
    const enrichedOutput: DeployTemplateOutput = {
      ...deployResult.stdoutJson,
      app_name: appName,
      app_host: appHost,
      namespace,
      method: "template-api",
    };

    return {
      state,
      result: {
        step: "deploy",
        status: state.input.dryRun ? "dry-run" : "success",
        summary: state.input.dryRun
          ? "Ran deploy-template.mjs in --dry-run mode."
          : "Posted the generated template through deploy-template.mjs.",
        command: deployResult.command,
        stdoutText: deployResult.stdoutText,
        stderrText: deployResult.stderrText,
        stdoutJson: enrichedOutput,
        warnings: [],
        artifactPaths: [paths.templateFile],
      },
    };
  } catch (error) {
    if (!state.input.dryRun || !(error instanceof ScriptExecutionError)) {
      throw error;
    }

    const synthetic: DeployTemplateOutput = {
      success: true,
      dry_run: true,
      app_name: appName,
      app_host: appHost,
      namespace,
      method: "template-api",
      region: "https://example.com",
      region_domain: "example.com",
      deploy_url: "https://template.example.com/api/v2alpha/templates/raw",
      template_path: paths.templateFile,
      response: {
        reason: "Sealos auth or kubeconfig is not available in dry-run mode.",
      },
    };

    return {
      state,
      result: {
        step: "deploy",
        status: "dry-run",
        summary: "Dry-run mode skipped the real template deploy after deploy-template.mjs hit auth prerequisites.",
        warnings: [
          "deploy-template.mjs was attempted first, then replaced with a synthetic dry-run result.",
        ],
        artifactPaths: [paths.templateFile],
        stdoutJson: synthetic,
      },
    };
  }
}
