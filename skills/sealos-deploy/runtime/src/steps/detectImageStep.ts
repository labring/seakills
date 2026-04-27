import type {
  DetectImageOutput,
  WorkflowRuntimeState,
  WorkflowStepResult,
} from "../types";
import { getArtifactPaths, updateAnalysisArtifact } from "../lib/artifacts";
import { runNodeScript } from "../lib/runNodeScript";

function toImageRef(result: DetectImageOutput): string | null {
  if (!result.found || !result.image) {
    return null;
  }
  return result.tag ? `${result.image}:${result.tag}` : result.image;
}

export async function detectImageStep(state: WorkflowRuntimeState): Promise<{
  state: WorkflowRuntimeState;
  result: WorkflowStepResult<DetectImageOutput>;
}> {
  "use step";

  const detectResult = await runNodeScript<DetectImageOutput>(
    "scripts/detect-image.mjs",
    [state.input.workDir],
    { cwd: state.input.workDir },
  );
  const imageRef = toImageRef(detectResult.stdoutJson);
  const paths = getArtifactPaths(state.input.workDir);

  if (imageRef) {
    await updateAnalysisArtifact(paths, (analysis) => ({
      ...analysis,
      image_ref: imageRef,
    }));
  }

  return {
    state: {
      ...state,
      analysis: state.analysis ? { ...state.analysis, image_ref: imageRef } : state.analysis,
      imageRef,
    },
    result: {
      step: "detect-image",
      status: "success",
      summary: imageRef
        ? `Detected reusable image ${imageRef} (${detectResult.stdoutJson.source ?? "unknown source"}).`
        : "No reusable image was detected; workflow will continue through Dockerfile/build path.",
      command: detectResult.command,
      stdoutText: detectResult.stdoutText,
      stderrText: detectResult.stderrText,
      stdoutJson: detectResult.stdoutJson,
      warnings: [],
      artifactPaths: imageRef ? [paths.analysis] : [],
    },
  };
}
