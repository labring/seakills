import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exit } from "node:process";

import { sealosDeployWorkflow } from "../workflows/sealosDeploy";
import { normalizeWorkflowInput } from "../server";
import { runNodeScript } from "../lib/runNodeScript";
import type { ValidateArtifactsOutput } from "../types";

async function createFixtureProject(): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), "sealos-workflow-smoke-"));
  await mkdir(join(workDir, "src"), { recursive: true });

  await writeFile(join(workDir, "package.json"), JSON.stringify({
    name: "phase1-smoke-app",
    version: "0.0.1",
    private: true,
    scripts: {
      build: "node -e \"console.log('build placeholder')\"",
      start: "node dist/index.js",
    },
    dependencies: {
      express: "^4.21.2",
    },
  }, null, 2));

  await writeFile(join(workDir, ".env.example"), "PORT=3000\nAPI_TOKEN=\n");
  await writeFile(join(workDir, "src", "index.js"), [
    "const http = require('http');",
    "const port = process.env.PORT || 3000;",
    "http.createServer((req, res) => {",
    "  if (req.url === '/health') {",
    "    res.writeHead(200);",
    "    res.end('ok');",
    "    return;",
    "  }",
    "  res.writeHead(200);",
    "  res.end('phase1 smoke');",
    "}).listen(port);",
    "",
  ].join("\n"));

  return workDir;
}

async function main() {
  const workDir = await createFixtureProject();

  try {
    const input = normalizeWorkflowInput({
      workDir,
      dryRun: true,
      title: "Phase 1 Smoke",
      description: "Fixture-backed smoke validation for the maintainer workflow runtime",
      categories: ["backend"],
    });

    const result = await sealosDeployWorkflow(input);
    const artifactValidation = await runNodeScript<ValidateArtifactsOutput>(
      "scripts/validate-artifacts.mjs",
      ["--dir", workDir],
      { cwd: workDir },
    );

    assert.equal(result.status, "success");
    assert.ok(result.stepResults.some((step) => step.step === "deploy" && step.status === "dry-run"));
    assert.equal(artifactValidation.stdoutJson.valid, true);

    console.log(JSON.stringify({
      workflow: sealosDeployWorkflow.name,
      workDir,
      result,
      artifactValidation: artifactValidation.stdoutJson,
    }, null, 2));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  exit(1);
});
