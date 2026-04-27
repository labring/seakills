import { FatalError } from "workflow";

import type {
  BuildPushOutput,
  WorkflowRuntimeState,
  WorkflowStepResult,
} from "../types";
import {
  ensureBuildDir,
  getArtifactPaths,
  updateAnalysisArtifact,
  validateArtifacts,
  writeJsonFile,
} from "../lib/artifacts";
import { runNodeScript } from "../lib/runNodeScript";

function sanitizeRepoName(repoName: string): string {
  return repoName.toLowerCase().replace(/[^a-z0-9_.-]/g, "-");
}

function isDockerHubUser(value: string): boolean {
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value);
}

function resolveDockerHubUser(state: WorkflowRuntimeState): string {
  const configured = state.config?.docker_hub_user ?? process.env.DOCKER_HUB_USER;
  const dockerHubUser = configured?.trim();
  if (!dockerHubUser) {
    throw new FatalError(
      "buildPushStep requires config.docker_hub_user or DOCKER_HUB_USER before running build-push.mjs.",
    );
  }
  if (!isDockerHubUser(dockerHubUser)) {
    throw new FatalError(`Invalid Docker Hub user: ${dockerHubUser}`);
  }
  return dockerHubUser;
}

export async function buildPushStep(state: WorkflowRuntimeState): Promise<{
  state: WorkflowRuntimeState;
  result: WorkflowStepResult<BuildPushOutput>;
}> {
  "use step";

  const paths = getArtifactPaths(state.input.workDir);
  if (state.imageRef) {
    return {
      state,
      result: {
        step: "build-push",
        status: "skipped",
        summary: `Skipped build/push because detect-image already resolved ${state.imageRef}.`,
        warnings: [],
        artifactPaths: [],
        stdoutJson: {
          success: true,
          image: state.imageRef,
        },
      },
    };
  }

  if (!state.analysis) {
    throw new FatalError("buildPushStep requires analysis from the assess step.");
  }

  if (state.input.dryRun) {
    const startedAt = new Date().toISOString();
    const image = `ghcr.io/dry-run/${sanitizeRepoName(state.input.repoName)}:phase1`;
    await ensureBuildDir(paths);
    await writeJsonFile(paths.buildResult, {
      outcome: "success",
      registry: "ghcr",
      build: {
        image_name: sanitizeRepoName(state.input.repoName),
        started_at: startedAt,
      },
      push: {
        remote_image: image,
        pushed_at: startedAt,
      },
      finished_at: startedAt,
    });
    await updateAnalysisArtifact(paths, (analysis) => ({
      ...analysis,
      image_ref: image,
    }));
    await validateArtifacts(paths.workDir);

    return {
      state: {
        ...state,
        analysis: {
          ...state.analysis,
          image_ref: image,
        },
        imageRef: image,
      },
      result: {
        step: "build-push",
        status: "dry-run",
        summary: `Dry-run mode skipped docker buildx and wrote a synthetic build-result for ${image}.`,
        warnings: ["Dry-run mode does not contact Docker or a real registry."],
        artifactPaths: [paths.buildResult, paths.analysis],
        stdoutJson: {
          success: true,
          image,
          registry: "ghcr",
        },
      },
    };
  }

  const dockerHubUser = resolveDockerHubUser(state);
  const buildResult = await runNodeScript<BuildPushOutput>(
    "scripts/build-push.mjs",
    [state.input.workDir, dockerHubUser, state.input.repoName],
    { cwd: state.input.workDir },
  );
  if (!buildResult.stdoutJson.success || !buildResult.stdoutJson.image) {
    throw new FatalError(buildResult.stdoutJson.error ?? "build-push.mjs did not return a successful image.");
  }

  await updateAnalysisArtifact(paths, (analysis) => ({
    ...analysis,
    image_ref: buildResult.stdoutJson.image ?? null,
  }));

  return {
    state: {
      ...state,
      analysis: {
        ...state.analysis,
        image_ref: buildResult.stdoutJson.image,
      },
      imageRef: buildResult.stdoutJson.image,
    },
    result: {
      step: "build-push",
      status: "success",
      summary: `Built and pushed ${buildResult.stdoutJson.image} through build-push.mjs.`,
      command: buildResult.command,
      stdoutText: buildResult.stdoutText,
      stderrText: buildResult.stderrText,
      stdoutJson: buildResult.stdoutJson,
      warnings: buildResult.stdoutJson.warning ? [buildResult.stdoutJson.warning] : [],
      artifactPaths: [paths.buildResult, paths.analysis],
    },
  };
}
