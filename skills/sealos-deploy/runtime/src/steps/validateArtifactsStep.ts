import { access } from "node:fs/promises";

import type {
  ValidateArtifactsOutput,
  WorkflowRuntimeState,
  WorkflowStepResult,
} from "../types";
import { getArtifactPaths, validateArtifacts } from "../lib/artifacts";

export async function validateArtifactsStep(state: WorkflowRuntimeState): Promise<{
  state: WorkflowRuntimeState;
  result: WorkflowStepResult<ValidateArtifactsOutput>;
}> {
  "use step";

  const paths = getArtifactPaths(state.input.workDir);
  await access(paths.analysis);
  if (state.executionMode === "update") {
    await access(paths.buildResult);
    await access(paths.state);
  } else {
    await access(paths.templateFile);
  }

  const validation = await validateArtifacts(paths.workDir);
  const artifactPaths = state.executionMode === "update"
    ? [paths.analysis, paths.buildResult, paths.state, paths.workflowState]
    : [paths.analysis, paths.buildResult, paths.templateFile];

  return {
    state,
    result: {
      step: "validate-artifacts",
      status: "success",
      summary: state.executionMode === "update"
        ? "Validated update-mode .sealos JSON artifacts without requiring template output."
        : "Validated .sealos JSON artifacts and confirmed template output exists.",
      command: validation.command,
      stdoutText: validation.stdoutText,
      stderrText: validation.stderrText,
      stdoutJson: validation.stdoutJson,
      warnings: validation.stdoutJson.valid
        ? []
        : ["validate-artifacts.mjs reported schema problems."],
      artifactPaths,
    },
  };
}
