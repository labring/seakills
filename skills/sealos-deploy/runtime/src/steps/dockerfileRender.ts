import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { FatalError } from "workflow";

import type { AnalysisArtifact, WorkflowConfigArtifact } from "../types";
import { resolveSiblingSkillPath } from "../lib/runNodeScript";

const TEMPLATE_DIR = resolveSiblingSkillPath("dockerfile-skill", "templates");
const DEFAULT_NODE_VERSION = "22";
const DEFAULT_PYTHON_VERSION = "3.11.7";
const DEFAULT_GO_VERSION = "1.21.6";
const DEFAULT_JAVA_VERSION = "21";

function selectTemplate(analysis: AnalysisArtifact): string {
  if (analysis.language === "node" && analysis.framework === "nextjs") {
    return "nodejs-nextjs.dockerfile";
  }
  if (analysis.language === "node") {
    return "nodejs-express.dockerfile";
  }
  if (analysis.language === "python" && analysis.framework === "fastapi") {
    return "python-fastapi.dockerfile";
  }
  if (analysis.language === "python" && analysis.framework === "django") {
    return "python-django.dockerfile";
  }
  if (analysis.language === "go") {
    return "golang.dockerfile";
  }
  if (analysis.language === "java") {
    return "java-springboot.dockerfile";
  }

  throw new FatalError(`Phase 1 does not have a Dockerfile template for ${analysis.language}/${analysis.framework}.`);
}

export function configuredPort(analysis: AnalysisArtifact, config?: WorkflowConfigArtifact): number {
  return config?.port ?? analysis.port;
}

function runtimeVersion(analysis: AnalysisArtifact, key: string, fallback: string): string {
  const version = analysis.runtime_version[key];
  return typeof version === "string" && version.trim() ? version.trim() : fallback;
}

function installCommand(analysis: AnalysisArtifact): string {
  switch (analysis.package_manager) {
    case "pnpm":
      return "pnpm install --frozen-lockfile";
    case "yarn":
      return "yarn install --frozen-lockfile";
    case "bun":
      return "bun install --frozen-lockfile";
    case "npm":
    default:
      return "npm ci";
  }
}

function productionInstallCommand(analysis: AnalysisArtifact): string {
  switch (analysis.package_manager) {
    case "pnpm":
      return "pnpm install --frozen-lockfile --prod";
    case "yarn":
      return "yarn install --frozen-lockfile --production";
    case "bun":
      return "bun install --frozen-lockfile --production";
    case "npm":
    default:
      return "npm ci --omit=dev";
  }
}

function buildCommand(analysis: AnalysisArtifact): string {
  switch (analysis.package_manager) {
    case "pnpm":
      return "pnpm build";
    case "yarn":
      return "yarn build";
    case "bun":
      return "bun run build";
    case "npm":
    default:
      return "npm run build";
  }
}

function defaultStartCommand(analysis: AnalysisArtifact): string {
  if (analysis.language === "python" && analysis.framework === "fastapi") {
    return `uvicorn main:app --host 0.0.0.0 --port ${analysis.port}`;
  }
  if (analysis.language === "python" && analysis.framework === "django") {
    return `gunicorn --bind 0.0.0.0:${analysis.port} --workers 2 config.wsgi:application`;
  }
  if (analysis.language === "go") {
    return "./main";
  }
  if (analysis.language === "java") {
    return "java $JAVA_OPTS -jar app.jar";
  }
  return "node dist/index.js";
}

function packageManagerFiles(analysis: AnalysisArtifact): string {
  switch (analysis.package_manager) {
    case "pnpm":
      return "pnpm-lock.yaml .npmrc*";
    case "yarn":
      return "yarn.lock .yarnrc.yml";
    case "bun":
      return "bun.lockb bun.lock";
    case "npm":
    default:
      return "package-lock.json*";
  }
}

function corepackSetup(analysis: AnalysisArtifact): string {
  return analysis.package_manager === "pnpm" || analysis.package_manager === "yarn"
    ? "RUN corepack enable"
    : "";
}

function asShellCmdInstruction(command: string): string {
  return `CMD ["sh", "-c", ${JSON.stringify(command)}]`;
}

function replaceLastEntrypoint(rendered: string, command: string): string {
  const replacement = asShellCmdInstruction(command);
  if (/^(CMD|ENTRYPOINT)\s+.+$/m.test(rendered)) {
    return rendered.replace(/^(CMD|ENTRYPOINT)\s+.+$/m, replacement);
  }
  return `${rendered.trim()}\n\n${replacement}\n`;
}

function replacePort(rendered: string, port: number): string {
  return rendered
    .replace(/^ENV PORT=\d+/gm, `ENV PORT=${port}`)
    .replace(/^ENV SERVER_PORT=\d+/gm, `ENV SERVER_PORT=${port}`)
    .replace(/^EXPOSE\s+\d+/gm, `EXPOSE ${port}`)
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("#")) {
        return line;
      }

      let nextLine = line;
      if (/^(HEALTHCHECK|CMD|ENTRYPOINT)\b/.test(trimmed)) {
        nextLine = nextLine
          .replace(/127\.0\.0\.1:\d+/g, `127.0.0.1:${port}`)
          .replace(/localhost:\d+/g, `localhost:${port}`);
      }

      return nextLine
        .replace(/("--port",\s*")\d+(")/g, `$1${port}$2`)
        .replace(/("--bind",\s*")0\.0\.0\.0:\d+(")/g, (_match, prefix: string, suffix: string) =>
          `${prefix}0.0.0.0:${port}${suffix}`,
        );
    })
    .join("\n");
}

function replaceAllWithCount(
  value: string,
  pattern: RegExp,
  replacement: string,
): { value: string; count: number } {
  let count = 0;
  return {
    value: value.replace(pattern, () => {
      count += 1;
      return replacement;
    }),
    count,
  };
}

function applyConfiguredBuildCommand(
  rendered: string,
  analysis: AnalysisArtifact,
  command: string,
): string {
  const patterns = [
    /RUN\s+\{\{BUILD_COMMAND\}\}/g,
    /RUN npm run build/g,
    /RUN --mount=type=cache,target=\/go\/pkg\/mod \\\n\s+--mount=type=cache,target=\/root\/\.cache\/go-build \\\n\s+CGO_ENABLED=0[^\n]+/g,
    /RUN --mount=type=cache,target=\/root\/\.m2 \\\n\s+\.\/mvnw package[^\n]+/g,
  ];
  let next = rendered;
  let replacementCount = 0;

  for (const pattern of patterns) {
    const result = replaceAllWithCount(next, pattern, `RUN ${command}`);
    next = result.value;
    replacementCount += result.count;
  }

  if (replacementCount === 0) {
    throw new FatalError(
      `Configured build_command could not be applied to the ${analysis.language}/${analysis.framework} Dockerfile template because no build command placeholder was found.`,
    );
  }

  return next;
}

function applyBaseImage(rendered: string, analysis: AnalysisArtifact, config?: WorkflowConfigArtifact): string {
  if (config?.base_image) {
    if (analysis.language === "node") {
      return rendered.replace(/node:[\w.-]+-slim/g, config.base_image);
    }
    if (analysis.language === "python") {
      return rendered.replace(/python:[\w.-]+-slim/g, config.base_image);
    }
    if (analysis.language === "go") {
      return rendered.replace(/golang:[\w.-]+-alpine/g, config.base_image);
    }
    if (analysis.language === "java") {
      return rendered.replace(/eclipse-temurin:[\w.-]+-jre-alpine/g, config.base_image);
    }
  }

  if (analysis.language === "node") {
    return rendered.replace(/node:[\w.-]+-slim/g, `node:${runtimeVersion(analysis, "node", DEFAULT_NODE_VERSION)}-slim`);
  }
  if (analysis.language === "python") {
    return rendered.replace(/python:[\w.-]+-slim/g, `python:${runtimeVersion(analysis, "python", DEFAULT_PYTHON_VERSION)}-slim`);
  }
  if (analysis.language === "go") {
    return rendered.replace(/golang:[\w.-]+-alpine/g, `golang:${runtimeVersion(analysis, "go", DEFAULT_GO_VERSION)}-alpine`);
  }
  if (analysis.language === "java") {
    const version = runtimeVersion(analysis, "java", DEFAULT_JAVA_VERSION);
    return rendered.replace(/eclipse-temurin:[\w.-]+-(jdk|jre)-alpine/g, (_, kind: string) =>
      `eclipse-temurin:${version}-${kind}-alpine`,
    );
  }

  return rendered;
}

function finishDockerfile(rendered: string): string {
  return `${rendered.replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function renderNodeExpressDockerfile(
  template: string,
  analysis: AnalysisArtifact,
  config?: WorkflowConfigArtifact,
): string {
  let rendered = applyBaseImage(template, analysis, config);
  rendered = rendered.replace("# {{SYSTEM_DEPS}}", corepackSetup(analysis));
  rendered = rendered.replace("npm ci --only=production", productionInstallCommand(analysis));
  rendered = rendered.replace(/\bnpm ci\b/g, installCommand(analysis));
  rendered = config?.build_command
    ? applyConfiguredBuildCommand(rendered, analysis, config.build_command)
    : rendered.replace("npm run build", buildCommand(analysis));
  rendered = replacePort(rendered, configuredPort(analysis, config));
  return finishDockerfile(replaceLastEntrypoint(rendered, config?.start_command ?? defaultStartCommand({
    ...analysis,
    port: configuredPort(analysis, config),
  })));
}

function renderGenericDockerfile(
  template: string,
  analysis: AnalysisArtifact,
  config?: WorkflowConfigArtifact,
): string {
  let rendered = replacePort(applyBaseImage(template, analysis, config), configuredPort(analysis, config));

  if (config?.build_command) {
    rendered = applyConfiguredBuildCommand(rendered, analysis, config.build_command);
  }

  return finishDockerfile(replaceLastEntrypoint(
    rendered,
    config?.start_command ?? defaultStartCommand({ ...analysis, port: configuredPort(analysis, config) }),
  ));
}

function renderNextJsDockerfile(
  template: string,
  analysis: AnalysisArtifact,
  appName: string,
  repoUrl: string,
  config?: WorkflowConfigArtifact,
): string {
  let rendered = template;
  rendered = rendered.replace("# {{PNPM_SETUP}}", analysis.package_manager === "pnpm"
    ? "RUN corepack enable && corepack prepare pnpm@10.20.0 --activate"
    : "");
  rendered = rendered.replace("# {{WORKSPACE_COPY}}", "");
  rendered = rendered.replace("# {{WORKSPACE_DEPS_COPY}}", "");
  rendered = rendered.replace("# {{BUILD_TIME_ENV}}", "");
  rendered = rendered.replace("# {{CUSTOM_ENTRY_POINT}}", "");
  rendered = rendered.replace("# {{MIGRATIONS}}", "");

  const replacements: Record<string, string> = {
    NODE_VERSION: config?.node_version ?? runtimeVersion(analysis, "node", DEFAULT_NODE_VERSION),
    PNPM_VERSION: "10.20.0",
    PACKAGE_MANAGER_FILES: packageManagerFiles(analysis),
    INSTALL_COMMAND: installCommand(analysis),
    BUILD_COMMAND: config?.build_command ?? buildCommand(analysis),
    PORT: String(configuredPort(analysis, config)),
    APP_NAME: appName,
    REPO_URL: repoUrl,
    SYSTEM_DEPS: "git",
    RUNTIME_DEPS: "curl",
    WORKSPACE_COPY: "",
    WORKSPACE_DEPS_COPY: "",
    BUILD_TIME_ENV: "",
    CUSTOM_ENTRY_POINT: "",
    MIGRATIONS: "",
  };

  if (!rendered.includes("{{BUILD_COMMAND}}")) {
    throw new FatalError("The Next.js Dockerfile template is missing the required {{BUILD_COMMAND}} placeholder.");
  }

  rendered = rendered.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key: string) => replacements[key] ?? "");
  rendered = replacePort(applyBaseImage(rendered, analysis, config), configuredPort(analysis, config));
  if (config?.start_command) {
    rendered = replaceLastEntrypoint(rendered, config.start_command);
  }
  return finishDockerfile(rendered);
}

export async function renderDockerfileForAnalysis(
  analysis: AnalysisArtifact,
  appName: string,
  repoUrl: string,
  config?: WorkflowConfigArtifact,
): Promise<{ templateName: string; dockerfile: string }> {
  const templateName = selectTemplate(analysis);
  const template = await readFile(join(TEMPLATE_DIR, templateName), "utf8");
  if (templateName === "nodejs-nextjs.dockerfile") {
    return {
      templateName,
      dockerfile: renderNextJsDockerfile(template, analysis, appName, repoUrl, config),
    };
  }
  if (templateName === "nodejs-express.dockerfile") {
    return {
      templateName,
      dockerfile: renderNodeExpressDockerfile(template, analysis, config),
    };
  }

  return {
    templateName,
    dockerfile: renderGenericDockerfile(template, analysis, config),
  };
}
