import { readFile, writeFile } from "node:fs/promises";

import { FatalError } from "workflow";

import type {
  WorkflowRuntimeState,
  WorkflowStepResult,
} from "../types";
import { getArtifactPaths } from "../lib/artifacts";
import { runNodeScript, ScriptExecutionError } from "../lib/runNodeScript";
import { configuredPort, renderDockerfileForAnalysis } from "./dockerfileRender";

interface DockerfileValidationOutput {
  valid: boolean;
  errors: number;
  warnings: number;
  issues: Array<{ severity: string; rule: string; msg: string }>;
}

function validationWarnings(validation: DockerfileValidationOutput): string[] {
  return validation.issues.map((issue) => issue.msg);
}

function parseValidationError(error: ScriptExecutionError): DockerfileValidationOutput | null {
  if (!error.stdoutText) {
    return null;
  }

  try {
    return JSON.parse(error.stdoutText) as DockerfileValidationOutput;
  } catch {
    return null;
  }
}

async function validateExistingDockerfile(
  dockerfilePath: string,
  dockerPort: number,
  workDir: string,
): Promise<{
  command?: string[];
  stdoutText?: string;
  stderrText?: string;
  stdoutJson: DockerfileValidationOutput;
}> {
  try {
    return await runNodeScript<DockerfileValidationOutput>(
      "skills/dockerfile-skill/scripts/validate-dockerfile.mjs",
      [dockerfilePath, `--port=${dockerPort}`, "--json"],
      { cwd: workDir },
    );
  } catch (error) {
    if (error instanceof ScriptExecutionError) {
      const parsed = parseValidationError(error);
      if (parsed) {
        return {
          command: error.command,
          stdoutText: error.stdoutText,
          stderrText: error.stderrText,
          stdoutJson: parsed,
        };
      }
    }

    throw error;
  }
}

export async function prepareDockerfileStep(state: WorkflowRuntimeState): Promise<{
  state: WorkflowRuntimeState;
  result: WorkflowStepResult<{
    template?: string;
    reused: boolean;
    validated: boolean;
  }>;
}> {
  "use step";

  const paths = getArtifactPaths(state.input.workDir);
  if (state.imageRef) {
    return {
      state,
      result: {
        step: "dockerfile",
        status: "skipped",
        summary: `Image reuse (${state.imageRef}) makes Dockerfile generation unnecessary for this run.`,
        warnings: [],
        artifactPaths: [],
        stdoutJson: {
          reused: true,
          validated: false,
        },
      },
    };
  }

  if (!state.analysis) {
    throw new FatalError("prepareDockerfileStep requires analysis.json from the assess step.");
  }

  try {
    await readFile(paths.dockerfile, "utf8");
    const dockerPort = configuredPort(state.analysis, state.config);
    const validation = await validateExistingDockerfile(
      paths.dockerfile,
      dockerPort,
      state.input.workDir,
    );
    return {
      state,
      result: {
        step: "dockerfile",
        status: "success",
        summary: validation.stdoutJson.valid
          ? "Reused the existing project Dockerfile after warn-only validation."
          : "Reused the existing project Dockerfile, but warn-only validation reported issues.",
        command: validation.command,
        stdoutText: validation.stdoutText,
        stderrText: validation.stderrText,
        warnings: validationWarnings(validation.stdoutJson),
        artifactPaths: [paths.dockerfile],
        stdoutJson: {
          reused: true,
          validated: validation.stdoutJson.valid,
        },
      },
    };
  } catch {
    // Continue into generation.
  }

  const rendered = await renderDockerfileForAnalysis(
    state.analysis,
    state.input.repoName,
    state.input.githubUrl ?? "",
    state.config,
  );
  await writeFile(paths.dockerfile, rendered.dockerfile, "utf8");
  const dockerPort = configuredPort(state.analysis, state.config);

  const validation = await runNodeScript<DockerfileValidationOutput>(
    "skills/dockerfile-skill/scripts/validate-dockerfile.mjs",
    [paths.dockerfile, `--port=${dockerPort}`, "--json"],
    { cwd: state.input.workDir },
  );

  return {
    state: {
      ...state,
      analysis: {
        ...state.analysis,
        port: dockerPort,
        has_dockerfile: true,
      },
    },
    result: {
      step: "dockerfile",
      status: "success",
      summary: `Generated Dockerfile from ${rendered.templateName} and validated it for port ${dockerPort}.`,
      command: validation.command,
      stdoutText: validation.stdoutText,
      stderrText: validation.stderrText,
      stdoutJson: {
        template: rendered.templateName,
        reused: false,
        validated: validation.stdoutJson.valid,
      },
      warnings: validation.stdoutJson.issues.map((issue) => issue.msg),
      artifactPaths: [paths.dockerfile],
    },
  };
}
