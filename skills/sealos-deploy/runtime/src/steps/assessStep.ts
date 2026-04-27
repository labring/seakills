import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";

import { FatalError } from "workflow";

import type {
  AnalysisArtifact,
  EnvVarDescriptor,
  LanguageKind,
  PackageManagerKind,
  ScoreModelOutput,
  WorkflowRuntimeState,
  WorkflowStepResult,
} from "../types";
import { ensureBaseArtifactDirs, getArtifactPaths, writeAnalysisArtifact } from "../lib/artifacts";
import { runNodeScript } from "../lib/runNodeScript";

const ENV_FILES = [".env.example", ".env.sample", ".env.template"];

function inferComplexityTier(score: ScoreModelOutput): AnalysisArtifact["complexity_tier"] {
  if (score.signals.is_monorepo || score.signals.framework.includes("nextjs")) {
    return "L3";
  }
  if (score.signals.external_db || score.score >= 8 || score.signals.databases.length > 0) {
    return "L2";
  }
  return "L1";
}

function fallbackPackageManager(language: LanguageKind): PackageManagerKind {
  switch (language) {
    case "go":
      return "go";
    case "java":
      return "maven";
    case "python":
      return "pip";
    case "rust":
      return "cargo";
    case "php":
      return "composer";
    case "ruby":
      return "bundler";
    case "dotnet":
      return "npm";
    case "node":
    default:
      return "npm";
  }
}

async function extractEnvVars(workDir: string): Promise<Record<string, EnvVarDescriptor>> {
  const envVars: Record<string, EnvVarDescriptor> = {};

  for (const fileName of ENV_FILES) {
    try {
      const content = await readFile(join(workDir, fileName), "utf8");
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) {
          continue;
        }

        const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
        if (!match) {
          continue;
        }

        const [, key, rawValue] = match;
        const value = rawValue.trim();
        if (!value || value === '""' || value === "''") {
          envVars[key] = { category: "required" };
          continue;
        }

        if (/changeme|example|placeholder/i.test(value)) {
          envVars[key] = { category: "required", default: value };
          continue;
        }

        if (/secret|token|password|key/i.test(key)) {
          envVars[key] = { category: "auto", default: value };
          continue;
        }

        envVars[key] = { category: "optional", default: value };
      }
      break;
    } catch {
      continue;
    }
  }

  return envVars;
}

function buildAnalysisTotal(score: ScoreModelOutput): number {
  return Object.values(score.dimensions).reduce((sum, value) => sum + value, 0);
}

function buildAnalysisArtifact(
  state: WorkflowRuntimeState,
  score: ScoreModelOutput,
  envVars: Record<string, EnvVarDescriptor>,
): AnalysisArtifact {
  const language = score.signals.primary_language;
  if (!language) {
    throw new FatalError("score-model.mjs did not identify a deployable primary language.");
  }

  const runtimeVersion = { ...score.signals.runtime_version };
  const packageManager = score.signals.package_manager ?? fallbackPackageManager(language);
  const port = score.signals.port ?? 3000;
  const frameworks = score.signals.framework;

  return {
    generated_at: new Date().toISOString(),
    project: {
      github_url: state.input.githubUrl,
      work_dir: state.input.workDir,
      repo_name: state.input.repoName,
      branch: state.input.branch,
    },
    score: {
      total: buildAnalysisTotal(score),
      verdict: score.verdict,
      dimensions: score.dimensions,
    },
    language,
    all_languages: score.signals.language.length > 0 ? score.signals.language : [language],
    framework: frameworks[0] ?? "unknown",
    package_manager: packageManager,
    port,
    databases: score.signals.databases,
    runtime_version: runtimeVersion,
    env_vars: envVars,
    has_dockerfile: false,
    complexity_tier: inferComplexityTier(score),
    image_ref: null,
  };
}

export async function assessStep(state: WorkflowRuntimeState): Promise<{
  state: WorkflowRuntimeState;
  result: WorkflowStepResult<AnalysisArtifact>;
}> {
  "use step";

  const paths = getArtifactPaths(state.input.workDir);
  await ensureBaseArtifactDirs(paths);

  const scoreResult = await runNodeScript<ScoreModelOutput>(
    "scripts/score-model.mjs",
    [state.input.workDir],
    { cwd: state.input.workDir },
  );
  const envVars = await extractEnvVars(state.input.workDir);
  const analysis = buildAnalysisArtifact(state, scoreResult.stdoutJson, envVars);
  const validation = await writeAnalysisArtifact(paths, analysis);

  return {
    state: {
      ...state,
      analysis,
    },
    result: {
      step: "assess",
      status: "success",
      summary: `${basename(state.input.workDir)} scored ${analysis.score.total}/12 (${analysis.score.verdict}) as ${analysis.language}/${analysis.framework}.`,
      command: scoreResult.command,
      stdoutText: scoreResult.stdoutText,
      stderrText: scoreResult.stderrText,
      stdoutJson: analysis,
      warnings: validation.stdoutJson.valid ? [] : ["Artifact validation reported issues after analysis write."],
      artifactPaths: [paths.analysis],
    },
  };
}
