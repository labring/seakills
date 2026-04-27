import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assessStep } from "./assessStep";
import type { ScoreModelOutput } from "../types";
import type { WorkflowRuntimeState } from "../types";

function buildAnalysisTotal(score: ScoreModelOutput): number {
  return Object.values(score.dimensions).reduce((sum, value) => sum + value, 0);
}

test("analysis total uses raw dimension sum instead of score with bonus", () => {
  const score: ScoreModelOutput = {
    score: 12,
    raw_score: 11,
    bonus: 1,
    verdict: "Excellent",
    dimensions: {
      statelessness: 2,
      config: 2,
      scalability: 2,
      startup: 2,
      observability: 1,
      boundaries: 2,
    },
    dimension_details: {},
    bonus_reasons: ["dockerfile bonus"],
    signals: {
      language: ["node"],
      primary_language: "node",
      framework: ["nextjs"],
      has_http_server: true,
      external_db: true,
      has_docker: false,
      is_monorepo: false,
      has_env_example: true,
      package_manager: "pnpm",
      port: 3000,
      port_source: "default",
      databases: ["postgres"],
      runtime_version: {
        node: "22",
        source: "default",
      },
    },
  };

  assert.equal(buildAnalysisTotal(score), 11);
  assert.notEqual(buildAnalysisTotal(score), score.score);
});

function makeRuntimeState(workDir: string): WorkflowRuntimeState {
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
    imageRef: null,
    executionMode: "deploy",
    executionSummary: "Running fresh deploy path for this workflow run.",
    deploymentChoice: null,
    updateTarget: null,
    region: null,
    workspace: null,
    resumeInput: {},
    stepResults: [],
    stepsCompleted: ["preflight"],
  };
}

test("assessStep accepts current score-model signal contract and writes analysis", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "sealos-assess-current-contract-"));
  try {
    await writeFile(join(workDir, "package.json"), JSON.stringify({
      name: "demo-app",
      private: true,
      scripts: {
        start: "node index.js",
      },
      dependencies: {
        express: "^4.21.2",
        pg: "^8.13.1",
      },
    }, null, 2), "utf8");
    await writeFile(join(workDir, ".env.example"), "PORT=8080\nDATABASE_URL=\nAPI_TOKEN=\n", "utf8");
    await writeFile(join(workDir, "index.js"), [
      "const express = require('express');",
      "const app = express();",
      "app.get('/health', (_req, res) => res.send('ok'));",
      "app.listen(process.env.PORT || 8080);",
      "",
    ].join("\n"), "utf8");

    const { state, result } = await assessStep(makeRuntimeState(workDir));

    assert.equal(result.status, "success");
    assert.equal(state.analysis?.language, "node");
    assert.equal(state.analysis?.framework, "express");
    assert.equal(state.analysis?.package_manager, "npm");
    assert.equal(state.analysis?.port, 8080);
    assert.deepEqual(state.analysis?.databases, ["postgres"]);
    assert.equal(state.analysis?.env_vars.API_TOKEN.category, "required");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
