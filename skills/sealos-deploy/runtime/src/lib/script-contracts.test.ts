import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const AUTH_SCRIPT = fileURLToPath(new URL("../../../scripts/sealos-auth.mjs", import.meta.url));
const BUILD_PUSH_SCRIPT = fileURLToPath(new URL("../../../scripts/build-push.mjs", import.meta.url));

async function makeHomeWithAuth(region = "https://cloud.example.com") {
  const homeDir = await mkdtemp(join(tmpdir(), "sealos-auth-home-"));
  const sealosDir = join(homeDir, ".sealos");
  await mkdir(sealosDir, { recursive: true });
  await writeFile(join(sealosDir, "kubeconfig"), [
    "apiVersion: v1",
    "clusters:",
    "  - name: demo",
    "users:",
    "  - name: demo",
    "    user:",
    "      token: demo-token",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(sealosDir, "auth.json"), JSON.stringify({
    region,
    access_token: "global-token",
    regional_token: "regional-token",
    current_workspace: {
      id: "ns-current",
      uid: "uid-current",
      teamName: "Current Team",
    },
    workspaces: [
      { id: "ns-current", uid: "uid-current", teamName: "Current Team" },
      { id: "ns-next", uid: "uid-next", teamName: "Next Team" },
    ],
  }, null, 2), "utf8");
  return homeDir;
}

async function startWorkspaceApiFixture() {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`);
    if (req.url === "/api/auth/namespace/list") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        data: {
          namespaces: [
            { id: "ns-current", uid: "uid-current", teamName: "Current Team", nstype: "private" },
            { id: "ns-next", uid: "uid-next", teamName: "Next Team", nstype: "team" },
          ],
        },
      }));
      return;
    }
    if (req.url === "/api/auth/namespace/switch") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        assert.equal(parsed.ns_uid, "uid-next");
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: { token: "regional-token-next" } }));
      });
      return;
    }
    if (req.url === "/api/auth/getKubeconfig") {
      assert.equal(req.headers.authorization, "regional-token-next");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        data: {
          kubeconfig: [
            "apiVersion: v1",
            "users:",
            "  - name: next",
            "    user:",
            "      token: next-token",
            "",
          ].join("\n"),
        },
      }));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    region: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => server.close(),
  };
}

async function startCompleteLoginApiFixture() {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`);
    if (req.url === "/api/auth/oauth2/token") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ access_token: "global-token" }));
      return;
    }
    if (req.url === "/api/auth/regionToken") {
      assert.equal(req.headers.authorization, "global-token");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: { token: "regional-token" } }));
      return;
    }
    if (req.url === "/api/auth/getKubeconfig") {
      assert.equal(req.headers.authorization, "regional-token");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        data: {
          kubeconfig: [
            "apiVersion: v1",
            "users:",
            "  - name: current",
            "    user:",
            "      token: current-token",
            "",
          ].join("\n"),
        },
      }));
      return;
    }
    if (req.url === "/api/auth/namespace/list") {
      assert.equal(req.headers.authorization, "regional-token");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        data: {
          namespaces: [
            { id: "ns-current", uid: "uid-current", teamName: "Current Team", nstype: "private" },
            { id: "ns-next", uid: "uid-next", teamName: "Next Team", nstype: "team" },
          ],
        },
      }));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    region: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => server.close(),
  };
}

async function runNodeScript(script: string, args: string[], options: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
} = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args], {
      env: options.env,
      cwd: options.cwd,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number;
    };
    return {
      code: typeof execError.code === "number" ? execError.code : 1,
      stdout: execError.stdout?.toString("utf8") ?? "",
      stderr: execError.stderr?.toString("utf8") ?? "",
    };
  }
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

test("sealos-auth list returns JSON workspace contract from Sealos API", async () => {
  const api = await startWorkspaceApiFixture();
  const homeDir = await makeHomeWithAuth(api.region);
  try {
    const result = await runNodeScript(AUTH_SCRIPT, ["list"], {
      env: { ...process.env, HOME: homeDir },
    });

    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.current, "ns-current");
    assert.deepEqual(payload.workspaces.map((workspace: { id: string }) => workspace.id), [
      "ns-current",
      "ns-next",
    ]);
    assert.ok(api.requests.some((entry) => entry.startsWith("GET /api/auth/namespace/list regional-token")));
  } finally {
    api.close();
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("sealos-auth switch updates remote workspace, token, and kubeconfig", async () => {
  const api = await startWorkspaceApiFixture();
  const homeDir = await makeHomeWithAuth(api.region);
  try {
    const result = await runNodeScript(AUTH_SCRIPT, ["switch", "ns-next"], {
      env: { ...process.env, HOME: homeDir },
    });

    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.workspace.id, "ns-next");

    const auth = JSON.parse(await readFile(join(homeDir, ".sealos", "auth.json"), "utf8"));
    assert.equal(auth.current_workspace.id, "ns-next");
    assert.equal(auth.regional_token, "regional-token-next");
    const kubeconfig = await readFile(join(homeDir, ".sealos", "kubeconfig"), "utf8");
    assert.match(kubeconfig, /next-token/);
    assert.ok(api.requests.some((entry) => entry.startsWith("POST /api/auth/namespace/switch regional-token")));
    assert.ok(api.requests.some((entry) => entry.startsWith("GET /api/auth/getKubeconfig regional-token-next")));
  } finally {
    api.close();
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("sealos-auth complete-login stores remote workspaces for first deploy", async () => {
  const api = await startCompleteLoginApiFixture();
  const homeDir = await mkdtemp(join(tmpdir(), "sealos-complete-login-home-"));
  try {
    const result = await runNodeScript(AUTH_SCRIPT, [
      "complete-login",
      "--region",
      api.region,
      "--device-code",
      "device-code",
      "--poll-interval",
      "0",
    ], {
      env: { ...process.env, HOME: homeDir },
    });

    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.workspace, "ns-current");

    const auth = JSON.parse(await readFile(join(homeDir, ".sealos", "auth.json"), "utf8"));
    assert.equal(auth.access_token, "global-token");
    assert.equal(auth.regional_token, "regional-token");
    assert.equal(auth.current_workspace.id, "ns-current");
    assert.deepEqual(auth.workspaces.map((workspace: { id: string }) => workspace.id), [
      "ns-current",
      "ns-next",
    ]);
    const kubeconfig = await readFile(join(homeDir, ".sealos", "kubeconfig"), "utf8");
    assert.match(kubeconfig, /current-token/);
    assert.ok(api.requests.some((entry) => entry.startsWith("GET /api/auth/namespace/list regional-token")));
  } finally {
    api.close();
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("sealos-auth begin-login rejects non-http verification URLs before browser open", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/api/auth/oauth2/device") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        device_code: "device-123",
        user_code: "USER-123",
        verification_uri: "javascript:alert(1)",
        verification_uri_complete: "javascript:alert(1)",
        expires_in: 600,
        interval: 5,
      }));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const region = `http://127.0.0.1:${address.port}`;
    const result = await runNodeScript(AUTH_SCRIPT, ["begin-login", region]);

    assert.notEqual(result.code, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /invalid verification url/i);
  } finally {
    server.close();
  }
});

test("build-push rejects invalid docker namespace before invoking a shell", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "sealos-build-push-invalid-"));
  try {
    await writeFile(join(workDir, "Dockerfile"), "FROM scratch\n", "utf8");

    const result = await runNodeScript(BUILD_PUSH_SCRIPT, [
      workDir,
      "bad;echo injected",
      "demo-app",
    ]);

    assert.notEqual(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.success, false);
    assert.match(payload.error, /invalid docker hub user/i);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("build-push writes schema-compatible build artifact under .sealos/build", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "sealos-build-push-artifact-"));
  const previousPath = process.env.PATH;
  try {
    await writeFile(join(workDir, "Dockerfile"), "FROM scratch\n", "utf8");
    const fakeBin = await writeFakeDockerBin(workDir);
    const result = await runNodeScript(BUILD_PUSH_SCRIPT, [
      workDir,
      "demo-user",
      "Demo App",
    ], {
      env: { ...process.env, PATH: `${fakeBin}:${previousPath ?? ""}` },
    });

    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.success, true);
    assert.equal(payload.registry, "dockerhub");
    assert.match(payload.image, /^demo-user\/demo-app:/);

    const artifact = JSON.parse(await readFile(join(workDir, ".sealos", "build", "build-result.json"), "utf8"));
    assert.equal(artifact.outcome, "success");
    assert.equal(artifact.registry, "dockerhub");
    assert.equal(artifact.push.remote_image, payload.image);
    assert.equal(typeof artifact.finished_at, "string");
  } finally {
    process.env.PATH = previousPath;
    await rm(workDir, { recursive: true, force: true });
  }
});
