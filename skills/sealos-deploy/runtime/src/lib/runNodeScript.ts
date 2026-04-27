import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ScriptExecutionResult } from "../types";

const execFileAsync = promisify(execFile);
const RUNTIME_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SKILL_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SKILLS_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export class ScriptExecutionError extends Error {
  command: string[];
  stdoutText: string;
  stderrText: string;
  exitCode: number | null;

  constructor(message: string, details: {
    command: string[];
    stdoutText?: string;
    stderrText?: string;
    exitCode?: number | null;
  }) {
    super(message);
    this.name = "ScriptExecutionError";
    this.command = details.command;
    this.stdoutText = details.stdoutText ?? "";
    this.stderrText = details.stderrText ?? "";
    this.exitCode = details.exitCode ?? null;
  }
}

export function resolveRepoPath(...segments: string[]): string {
  return resolveBundledPath(...segments);
}

export function resolveSkillPath(...segments: string[]): string {
  return resolve(SKILL_ROOT, ...segments);
}

export function resolveSiblingSkillPath(skillName: string, ...segments: string[]): string {
  return resolve(SKILLS_ROOT, skillName, ...segments);
}

function resolveBundledPath(...segments: string[]): string {
  const relativePath = segments.join("/");
  const normalized = relativePath.replace(/\\/g, "/");

  if (normalized.startsWith("skills/sealos-deploy/")) {
    return resolve(SKILL_ROOT, normalized.slice("skills/sealos-deploy/".length));
  }

  if (normalized.startsWith("skills/")) {
    return resolve(SKILLS_ROOT, normalized.slice("skills/".length));
  }

  if (normalized === "docs/sealos-deploy-workflow.md") {
    return resolve(SKILL_ROOT, "docs", "sealos-deploy-workflow.md");
  }

  const skillPath = resolve(SKILL_ROOT, ...segments);
  if (existsSync(skillPath)) {
    return skillPath;
  }

  return resolve(RUNTIME_ROOT, ...segments);
}

export async function runNodeScript<T>(
  scriptRelativePath: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<ScriptExecutionResult<T>> {
  const scriptPath = resolveRepoPath(scriptRelativePath);
  const command = [process.execPath, scriptPath, ...args];

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [scriptPath, ...args],
      {
        cwd: options.cwd,
        env: options.env,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    const stdoutText = stdout.trim();
    const stderrText = stderr.trim();
    if (!stdoutText) {
      throw new ScriptExecutionError(
        `Script ${scriptRelativePath} completed without JSON stdout`,
        { command, stdoutText, stderrText },
      );
    }

    let stdoutJson: T;
    try {
      stdoutJson = JSON.parse(stdoutText) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown JSON parse error";
      throw new ScriptExecutionError(
        `Script ${scriptRelativePath} returned invalid JSON: ${message}`,
        { command, stdoutText, stderrText },
      );
    }

    return {
      command,
      stdoutText,
      stderrText,
      stdoutJson,
    };
  } catch (error) {
    if (error instanceof ScriptExecutionError) {
      throw error;
    }

    const execError = error as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | string;
    };
    const stdoutText = typeof execError.stdout === "string"
      ? execError.stdout.trim()
      : execError.stdout?.toString("utf8").trim() ?? "";
    const stderrText = typeof execError.stderr === "string"
      ? execError.stderr.trim()
      : execError.stderr?.toString("utf8").trim() ?? "";
    const exitCode = typeof execError.code === "number" ? execError.code : null;

    throw new ScriptExecutionError(
      `Script ${scriptRelativePath} failed${exitCode === null ? "" : ` (exit ${exitCode})`}`,
      { command, stdoutText, stderrText, exitCode },
    );
  }
}
