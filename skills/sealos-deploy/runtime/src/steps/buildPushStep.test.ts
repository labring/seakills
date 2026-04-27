import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildPushStep } from "./buildPushStep";
import { getArtifactPaths, writeJsonFile } from "../lib/artifacts";
import type { AnalysisArtifact, WorkflowConfigArtifact, WorkflowRuntimeState } from "../types";

function makeAnalysis(workDir: string): AnalysisArtifact {
  return {
    generated_at: "2026-04-25T10:00:00.000Z",
    project: {
      github_url: null,
      work_dir: workDir,
      repo_name: "demo-app",
      branch: "main",
    },
    score: {
      total: 8,
      verdict: "Good",
      dimensions: {
        statelessness: 2,
        config: 1,
        scalability: 1,
        startup: 1,
        observability: 1,
        boundaries: 2,
      },
    },
    language: "node",
    all_languages: ["node"],
    framework: "express",
    package_manager: "pnpm",
    port: 3000,
    databases: [],
    runtime_version: {
      node: "22",
      source: "test",
    },
    env_vars: {},
    has_dockerfile: true,
    complexity_tier: "L1",
    image_ref: null,
  };
}

function makeRuntimeState(workDir: string): WorkflowRuntimeState {
  const analysis = makeAnalysis(workDir);
  return {
    input: {
      workDir,
      repoName: "Demo App",
      githubUrl: null,
      branch: "main",
      dryRun: false,
      title: "Demo App",
      description: "test",
      url: undefined,
      author: "Seakills",
      categories: ["backend"],
    },
    analysis,
    config: {
      docker_hub_user: "demo-user",
    } as WorkflowConfigArtifact,
    imageRef: null,
    executionMode: "deploy",
    executionSummary: "Running fresh deploy path for this workflow run.",
    deploymentChoice: null,
    updateTarget: null,
    region: null,
    workspace: null,
    resumeInput: {},
    stepResults: [],
    stepsCompleted: ["preflight", "assess", "detect-image", "dockerfile"],
  };
}

async function writeFakeDockerBin(rootDir: string) {
  const binDir = join(rootDir, "bin");
  await mkdir(binDir, { recursive: true });
  const dockerPath = join(binDir, "docker");
  await writeFile(dockerPath, [
    "#!/bin/sh",
    "printf '%s\\n' \"$@\" > \"$PWD/.docker-args\"",
    "exit 0",
    "",
  ].join("\n"), "utf8");
  await chmod(dockerPath, 0o755);
  return binDir;
}

test("buildPushStep passes docker_hub_user and validates the script artifact contract", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "sealos-build-step-"));
  const previousPath = process.env.PATH;
  try {
    const paths = getArtifactPaths(workDir);
    const fakeBin = await writeFakeDockerBin(workDir);
    process.env.PATH = `${fakeBin}:${previousPath ?? ""}`;

    await writeFile(join(workDir, "Dockerfile"), "FROM scratch\n", "utf8");
    await writeJsonFile(paths.analysis, makeAnalysis(workDir));

    const { state, result } = await buildPushStep(makeRuntimeState(workDir));

    assert.equal(result.status, "success");
    assert.equal(state.imageRef, result.stdoutJson?.image);
    assert.match(result.stdoutJson?.image ?? "", /^demo-user\/demo-app:/);

    const artifact = JSON.parse(await readFile(paths.buildResult, "utf8"));
    assert.equal(artifact.outcome, "success");
    assert.equal(artifact.registry, "dockerhub");
    assert.equal(artifact.push.remote_image, state.imageRef);
  } finally {
    process.env.PATH = previousPath;
    await rm(workDir, { recursive: true, force: true });
  }
});
