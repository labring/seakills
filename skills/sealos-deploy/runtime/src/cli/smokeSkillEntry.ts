import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

const CLI_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(CLI_DIR, "../../..");

async function main() {
  const skillDoc = await readFile(resolve(SKILL_ROOT, "SKILL.md"), "utf8");
  const workflowGuide = await readFile(resolve(SKILL_ROOT, "docs/sealos-deploy-workflow.md"), "utf8");
  const runtimeReadme = await readFile(resolve(SKILL_ROOT, "runtime/README.md"), "utf8");

  const entryForms = [
    "/sealos-deploy workflow",
    "/sealos-deploy workflow <github-url>",
    "/sealos-deploy workflow <local-path>",
    "/sealos-deploy workflow --resume <target>",
    "/sealos-deploy workflow --restart <target>",
    "/sealos-deploy workflow status <target>",
  ];

  for (const form of entryForms) {
    assert.match(skillDoc, new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(workflowGuide, new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const runtimeCommands = [
    "pnpm --dir <SKILL_DIR>/runtime start:run --dir <WORK_DIR>",
    "pnpm --dir <SKILL_DIR>/runtime status:run --dir <WORK_DIR>",
  ];

  for (const command of runtimeCommands) {
    assert.match(skillDoc, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(skillDoc, /Legacy `\/sealos-deploy` remains the default path/i);
  assert.match(skillDoc, /never silently falls back/i);
  assert.match(workflowGuide, /never uses a silent fallback/i);
  assert.match(workflowGuide, /status:run/i);
  assert.match(workflowGuide, /--resume/i);
  assert.match(workflowGuide, /--restart/i);
  assert.match(runtimeReadme, /rollout guardrails/i);
  assert.match(runtimeReadme, /sealos-deploy-workflow\.md/);

  console.log(JSON.stringify({
    smoke: "skill-entry",
    status: "passed",
    checked: {
      entryForms,
      runtimeCommands,
      noSilentFallback: true,
      canonicalGuide: "<SKILL_DIR>/docs/sealos-deploy-workflow.md",
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
