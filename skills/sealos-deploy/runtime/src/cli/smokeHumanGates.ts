import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exit } from "node:process";

import { writeJsonFile } from "../lib/artifacts";
import { normalizeWorkflowInput, runSealosDeployDirect } from "../server";
import { createWorkflowStateArtifact } from "../workflows/sealosDeploy";

async function makeFixtureRoot() {
  return mkdtemp(join(tmpdir(), "sealos-smoke-human-gates-"));
}

function futureTimestamp(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function runExpiredAuthScenario() {
  const workDir = await makeFixtureRoot();
  try {
    await writeFile(join(workDir, "package.json"), JSON.stringify({ name: "demo-app", version: "0.0.1" }), "utf8");
    await mkdir(join(workDir, ".sealos"), { recursive: true });

    const workflowState = createWorkflowStateArtifact("smoke-human-gates", "2026-04-15T09:00:00.000Z");
    workflowState.status = "waiting";
    workflowState.pending_gate = {
      kind: "auth",
      name: "sealos-auth",
      status: "waiting",
      prompt: "Authorize Sealos access",
      payload: {
        region: "https://cloud.example.com",
        device_code: "device-123",
      },
      created_at: "2026-04-15T09:00:00.000Z",
      expires_at: "2020-04-15T09:00:30.000Z",
      resume_hint: "resume",
    };
    await writeJsonFile(join(workDir, ".sealos", "workflow-state.json"), workflowState);

    const result = await runSealosDeployDirect(
      normalizeWorkflowInput({ workDir, dryRun: false, categories: ["backend"] }),
      { startMode: "resume", runId: "smoke-human-gates" },
    );

    assert.equal(result.status, "blocked");
    assert.equal(result.pendingGate?.name, "sealos-auth");
    assert.match(result.message, /expired/i);
    assert.match(result.pendingGate?.resume_hint ?? "", /resume/i);

    return {
      scenario: "expired auth gate blocks resume",
      status: "passed",
      result: result.status,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function runRegionMismatchScenario() {
  const workDir = await makeFixtureRoot();
  try {
    await writeFile(join(workDir, "package.json"), JSON.stringify({ name: "demo-app", version: "0.0.1" }), "utf8");
    await mkdir(join(workDir, ".sealos"), { recursive: true });

    const workflowState = createWorkflowStateArtifact("smoke-human-gates-region", "2026-04-15T09:00:00.000Z");
    workflowState.status = "waiting";
    workflowState.pending_gate = {
      kind: "auth",
      name: "sealos-auth",
      status: "waiting",
      prompt: "Authorize Sealos access",
      payload: {
        region: "https://cloud.example.com",
        device_code: "device-123",
      },
      created_at: "2026-04-15T09:00:00.000Z",
      expires_at: futureTimestamp(),
      resume_hint: "resume",
    };
    await writeJsonFile(join(workDir, ".sealos", "workflow-state.json"), workflowState);

    const result = await runSealosDeployDirect(
      normalizeWorkflowInput({ workDir, dryRun: false, categories: ["backend"] }),
      {
        startMode: "resume",
        runId: "smoke-human-gates-region",
        resumeInput: {
          region: "https://other.example.com",
        },
      },
    );

    assert.equal(result.status, "blocked");
    assert.equal(result.pendingGate?.name, "sealos-auth");
    assert.match(result.message, /created for/i);

    return {
      scenario: "stale auth gate with region mismatch blocks resume",
      status: "passed",
      result: result.status,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const results = [
    await runExpiredAuthScenario(),
    await runRegionMismatchScenario(),
  ];

  const recoveryContract = [
    "status:run",
    "--resume",
    "--restart",
    "<SKILL_DIR>/docs/sealos-deploy-workflow.md",
    "silent fallback",
  ];

  console.log(JSON.stringify({
    smoke: "human-gates",
    status: "passed",
    results,
    recoveryContract,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
