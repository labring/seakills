import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { FatalError } from "workflow";

import type {
  WorkflowRuntimeState,
  WorkflowStepResult,
} from "../types";
import { copyTemplateArtifact, getArtifactPaths } from "../lib/artifacts";
import { resolveSiblingSkillPath } from "../lib/runNodeScript";
import { configuredPort } from "./dockerfileRender";

const execFileAsync = promisify(execFile);

async function findGeneratedIndex(rootDir: string): Promise<string | null> {
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.shift()!;
    try {
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = join(current, entry.name);
        if (entry.isDirectory()) {
          queue.push(entryPath);
        } else if (entry.isFile() && entry.name === "index.yaml") {
          return entryPath;
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

function buildComposeDocument(state: WorkflowRuntimeState): string {
  const port = state.analysis ? configuredPort(state.analysis, state.config) : 3000;
  const serviceName = state.input.repoName.replace(/[^a-zA-Z0-9_-]/g, "-");
  return [
    "services:",
    `  ${serviceName}:`,
    `    image: ${state.imageRef}`,
    "    ports:",
    `      - \"${port}:${port}\"`,
    "",
  ].join("\n");
}

function buildFallbackTemplate(state: WorkflowRuntimeState): string {
  const port = state.analysis ? configuredPort(state.analysis, state.config) : 3000;
  return [
    "apiVersion: templates.sealos.io/v1beta1",
    "kind: Template",
    "metadata:",
    `  name: ${state.input.repoName}`,
    "spec:",
    `  title: ${state.input.title ?? state.input.repoName}`,
    "  description: Phase 1 dry-run fallback template",
    "  defaults:",
    `    app_name: ${state.input.repoName}`,
    "  inputs: []",
    "  outputs:",
    "    - key: app_url",
    `      value: http://${state.input.repoName}.example.com:${port}`,
    "  template: |",
    "    apiVersion: apps/v1",
    "    kind: Deployment",
    "    metadata:",
    `      name: ${state.input.repoName}`,
    "    spec:",
    "      replicas: 1",
    "      selector:",
    "        matchLabels:",
    `          app: ${state.input.repoName}`,
    "      template:",
    "        metadata:",
    "          labels:",
    `            app: ${state.input.repoName}`,
    "        spec:",
    "          containers:",
    `            - name: ${state.input.repoName}`,
    `              image: ${state.imageRef}`,
    `              ports: [{ containerPort: ${port} }]`,
    "",
  ].join("\n");
}

export async function generateTemplateStep(state: WorkflowRuntimeState): Promise<{
  state: WorkflowRuntimeState;
  result: WorkflowStepResult<{
    indexPath: string;
    fallback: boolean;
  }>;
}> {
  "use step";

  if (!state.imageRef) {
    throw new FatalError("generateTemplateStep requires an image reference from detect-image or build-push.");
  }

  const paths = getArtifactPaths(state.input.workDir);
  const tempRoot = await mkdtemp(join(tmpdir(), "sealos-workflow-template-"));
  const composePath = join(tempRoot, "compose.yml");
  const outputDir = join(tempRoot, "out");
  const warnings: string[] = [];
  let generatedIndex: string | null = null;
  let fallback = false;

  try {
    await writeFile(composePath, buildComposeDocument(state), "utf8");
    await mkdir(outputDir, { recursive: true });
    const pythonBinary = process.env.PYTHON ?? "python3";
    const args = [
      "-X",
      "utf8",
      resolveSiblingSkillPath("docker-to-sealos", "scripts", "compose_to_template.py"),
      "--compose",
      composePath,
      "--output-dir",
      outputDir,
      "--app-name",
      state.input.repoName,
      "--title",
      state.input.title ?? state.input.repoName,
      "--description",
      state.input.description ?? "Phase 1 workflow-generated Sealos template",
      "--url",
      state.input.url ?? "",
      "--git-repo",
      state.input.githubUrl ?? "",
      "--author",
      state.input.author,
      "--category",
      state.input.categories[0] ?? "backend",
      "--kompose-mode",
      "never",
    ];

    try {
      await execFileAsync(pythonBinary, args, {
        cwd: state.input.workDir,
        maxBuffer: 10 * 1024 * 1024,
      });
      generatedIndex = await findGeneratedIndex(outputDir);
    } catch (error) {
      if (!state.input.dryRun) {
        const message = error instanceof Error ? error.message : "unknown compose_to_template.py failure";
        throw new FatalError(`compose_to_template.py failed: ${message}`);
      }

      fallback = true;
      generatedIndex = join(outputDir, "index.yaml");
      await writeFile(generatedIndex, buildFallbackTemplate(state), "utf8");
      warnings.push("compose_to_template.py failed in dry-run mode; wrote a fallback template instead.");
    }

    if (!generatedIndex) {
      throw new FatalError("compose_to_template.py did not produce an index.yaml output.");
    }

    await copyTemplateArtifact(generatedIndex, paths.templateFile);

    return {
      state,
      result: {
        step: "template",
        status: state.input.dryRun ? "dry-run" : "success",
        summary: fallback
          ? "Generated a fallback Sealos template after compose_to_template.py failed in dry-run mode."
          : "Generated .sealos/template/index.yaml through compose_to_template.py.",
        warnings,
        artifactPaths: [paths.templateFile],
        stdoutJson: {
          indexPath: paths.templateFile,
          fallback,
        },
      },
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
