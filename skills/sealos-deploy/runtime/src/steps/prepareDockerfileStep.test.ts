import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateTemplateStep } from "./generateTemplateStep";
import { renderDockerfileForAnalysis } from "./dockerfileRender";
import { prepareDockerfileStep } from "./prepareDockerfileStep";
import type { AnalysisArtifact, WorkflowRuntimeState } from "../types";

function makeAnalysis(workDir: string): AnalysisArtifact {
  return {
    generated_at: "2026-04-24T10:00:00.000Z",
    project: {
      github_url: null,
      work_dir: workDir,
      repo_name: "demo-app",
      branch: "main",
    },
    score: {
      total: 8,
      verdict: "deployable",
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
    has_dockerfile: false,
    complexity_tier: "L1",
    image_ref: null,
  };
}

function makeRuntimeState(workDir: string): WorkflowRuntimeState {
  const analysis = makeAnalysis(workDir);
  return {
    input: {
      workDir,
      repoName: "demo-app",
      githubUrl: null,
      branch: "main",
      dryRun: false,
      title: "demo-app",
      description: "test",
      url: undefined,
      author: "Seakills",
      categories: ["backend"],
    },
    analysis,
    config: {
      port: 8080,
      build_command: "pnpm build:prod",
      start_command: "node server.js",
      base_image: "node:22-slim",
    },
    imageRef: null,
    executionMode: "deploy",
    executionSummary: "Running fresh deploy path for this workflow run.",
    deploymentChoice: null,
    updateTarget: null,
    region: null,
    workspace: null,
    resumeInput: {},
    stepResults: [],
    stepsCompleted: ["preflight", "assess"],
  };
}

test("node dockerfile generation applies deploy-input config before build-push", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "sealos-dockerfile-config-"));
  try {
    await writeFile(join(workDir, "package.json"), JSON.stringify({
      name: "demo-app",
      private: true,
      scripts: {
        "build:prod": "tsc",
      },
    }), "utf8");

    const { state, result } = await prepareDockerfileStep(makeRuntimeState(workDir));
    const dockerfile = await readFile(join(workDir, "Dockerfile"), "utf8");

    assert.equal(result.status, "success");
    assert.equal(state.analysis?.port, 8080);
    assert.match(dockerfile, /pnpm install --frozen-lockfile --prod/);
    assert.match(dockerfile, /RUN pnpm build:prod/);
    assert.match(dockerfile, /ENV PORT=8080/);
    assert.match(dockerfile, /EXPOSE 8080/);
    assert.match(dockerfile, /CMD \["sh", "-c", "node server\.js"\]/);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("template generation uses deploy-input port override when analysis is stale", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "sealos-template-config-"));
  const previousPython = process.env.PYTHON;
  try {
    process.env.PYTHON = "python-missing-for-sealos-test";
    const baseState = makeRuntimeState(workDir);
    const state = {
      ...baseState,
      input: {
        ...baseState.input,
        dryRun: true,
      },
      imageRef: "ghcr.io/example/demo-app:configured",
    } satisfies WorkflowRuntimeState;

    const { result } = await generateTemplateStep(state);
    const template = await readFile(join(workDir, ".sealos", "template", "index.yaml"), "utf8");

    assert.equal(result.status, "dry-run");
    assert.equal(result.stdoutJson?.fallback, true);
    assert.match(template, /containerPort: 8080/);
    assert.match(template, /http:\/\/demo-app\.example\.com:8080/);
  } finally {
    process.env.PYTHON = previousPython;
    await rm(workDir, { recursive: true, force: true });
  }
});

test("existing Dockerfile reuse reports validation issues without failing the step", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "sealos-dockerfile-reuse-"));
  try {
    await writeFile(join(workDir, "Dockerfile"), [
      "FROM node:22-slim",
      "COPY . .",
      "",
    ].join("\n"), "utf8");

    const { result } = await prepareDockerfileStep(makeRuntimeState(workDir));

    assert.equal(result.status, "success");
    assert.equal(result.stdoutJson?.reused, true);
    assert.equal(result.stdoutJson?.validated, false);
    assert.match(result.warnings.join("\n"), /No CMD or ENTRYPOINT instruction found/);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("nextjs port override keeps database placeholder comments unchanged", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "sealos-dockerfile-nextjs-"));
  try {
    const analysis = {
      ...makeAnalysis(workDir),
      framework: "nextjs",
      package_manager: "pnpm",
      port: 3000,
    } satisfies AnalysisArtifact;

    const { dockerfile } = await renderDockerfileForAnalysis(
      analysis,
      "demo-app",
      "https://github.com/example/demo-app",
      { port: 8080 },
    );

    assert.match(dockerfile, /EXPOSE 8080/);
    assert.match(dockerfile, /fetch\('http:\/\/localhost:8080\/api\/health'\)/);
    assert.match(dockerfile, /postgres:\/\/placeholder:placeholder@localhost:5432\/placeholder/);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("go custom build command replaces the known build instruction exactly once", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "sealos-dockerfile-go-"));
  try {
    const analysis = {
      ...makeAnalysis(workDir),
      language: "go",
      all_languages: ["go"],
      framework: "gin",
      package_manager: "go",
      port: 8080,
      runtime_version: {
        go: "1.21.6",
        source: "test",
      },
    } satisfies AnalysisArtifact;

    const { dockerfile } = await renderDockerfileForAnalysis(
      analysis,
      "demo-app",
      "",
      { build_command: "go build -o app ./cmd/api" },
    );
    const buildCommandCount = dockerfile.match(/RUN go build -o app \.\/cmd\/api/g)?.length ?? 0;

    assert.equal(buildCommandCount, 1);
    assert.doesNotMatch(dockerfile, /CGO_ENABLED=0 GOOS=linux go build/);
    assert.doesNotMatch(dockerfile, /COPY \. \.\nRUN go build -o app \.\/cmd\/api/);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("java custom build command replaces the maven package instruction exactly once", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "sealos-dockerfile-java-"));
  try {
    const analysis = {
      ...makeAnalysis(workDir),
      language: "java",
      all_languages: ["java"],
      framework: "springboot",
      package_manager: "maven",
      port: 8080,
      runtime_version: {
        java: "21",
        source: "test",
      },
    } satisfies AnalysisArtifact;

    const { dockerfile } = await renderDockerfileForAnalysis(
      analysis,
      "demo-app",
      "",
      { build_command: "./gradlew build -x test --no-daemon" },
    );
    const buildCommandCount = dockerfile.match(/RUN \.\/gradlew build -x test --no-daemon/g)?.length ?? 0;

    assert.equal(buildCommandCount, 1);
    assert.doesNotMatch(dockerfile, /\.\/mvnw package -DskipTests -B/);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("python custom build command fails when the template has no build placeholder", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "sealos-dockerfile-python-"));
  try {
    const analysis = {
      ...makeAnalysis(workDir),
      language: "python",
      all_languages: ["python"],
      framework: "fastapi",
      package_manager: "pip",
      port: 8000,
      runtime_version: {
        python: "3.11.7",
        source: "test",
      },
    } satisfies AnalysisArtifact;

    await assert.rejects(
      () => renderDockerfileForAnalysis(
        analysis,
        "demo-app",
        "",
        { build_command: "python -m compileall ." },
      ),
      /build_command could not be applied/,
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
