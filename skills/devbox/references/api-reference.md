# Sealos Devbox API Reference

Base URL: `https://devbox.{domain}/api/v2alpha`

> **API Version:** `v2alpha` — centralized in the script constant `API_PATH` (`scripts/sealos-devbox.mjs`).
> If the API version changes, update `API_PATH` in the script; the rest auto-follows.

## TLS Note

The script sets `rejectUnauthorized: false` for HTTPS requests because Sealos clusters
may use self-signed TLS certificates. Without this, Node.js would reject connections
to clusters that don't have publicly trusted certificates.

## Authentication

All requests require a URL-encoded kubeconfig YAML in the `Authorization` header,
**except** `GET /devbox/templates` which requires no authentication.

```
Authorization: <encodeURIComponent(kubeconfigYaml)>
```

## Available Runtimes

Runtimes are fetched dynamically via `GET /devbox/templates`. The following are typically available:

### Languages

| Runtime | Identifier |
|---------|-----------|
| Python | `python` |
| Node.js | `node.js` |
| Go | `go` |
| Java | `java` |
| Rust | `rust` |
| C | `c` |
| C++ | `cpp` |
| PHP | `php` |

### Web Frameworks

| Runtime | Identifier |
|---------|-----------|
| Next.js | `next.js` |
| React | `react` |
| Vue | `vue` |
| Angular | `angular` |
| Svelte | `svelte` |
| Nuxt 3 | `nuxt3` |
| Astro | `astro` |
| Umi | `umi` |
| Express.js | `express.js` |
| Django | `django` |
| Flask | `flask` |
| Gin | `gin` |
| Echo | `echo` |
| Chi | `chi` |
| Iris | `iris` |
| Rocket | `rocket` |
| Vert.x | `vert.x` |
| Quarkus | `quarkus` |
| .NET | `net` |

### Static & Documentation

| Runtime | Identifier |
|---------|-----------|
| Nginx | `nginx` |
| Hexo | `hexo` |
| Docusaurus | `docusaurus` |
| VitePress | `vitepress` |

### Platforms

| Runtime | Identifier |
|---------|-----------|
| Ubuntu | `ubuntu` |
| Debian SSH | `debian-ssh` |
| Sealaf | `sealaf` |
| Claude Code | `claude-code` |

## Resource Constraints

### Create (POST /devbox)

| Field | Type | Range | Default |
|-------|------|-------|---------|
| cpu | number | 0.1 - 32 cores | 1 |
| memory | number | 0.1 - 32 GB | 2 |

### Update (PATCH /devbox/{name})

| Field | Type | Range | Notes |
|-------|------|-------|-------|
| cpu | number | 0.1 - 32 cores | |
| memory | number | 0.1 - 32 GB | |

All update fields are optional — only provide fields to change.

## Port Constraints

| Field | Type | Constraint |
|-------|------|-----------|
| number | number | 1 - 65535 |
| protocol | string | `http`, `grpc`, or `ws` (default: `http`) |
| isPublic | boolean | Enable public domain access (default: `true`) |
| customDomain | string | Optional custom domain |

## Endpoints

### GET /devbox/templates — List Available Runtimes

**No authentication required.** Returns runtime names and default configurations.

Response: `200 OK` → Array of `{ runtime, config: { appPorts, ports, user, workingDir, releaseCommand, releaseArgs } }`

### POST /devbox — Create Devbox

```json
{
  "name": "my-devbox",
  "runtime": "node.js",
  "quota": { "cpu": 1, "memory": 2 },
  "ports": [{ "number": 3000, "protocol": "http", "isPublic": true }],
  "env": [{ "name": "NODE_ENV", "value": "development" }],
  "autostart": false
}
```

Response: `201 Created` → Devbox info with SSH credentials:

```json
{
  "name": "my-devbox",
  "sshPort": 40001,
  "base64PrivateKey": "LS0tLS1CRUdJTi...",
  "userName": "devbox",
  "workingDir": "/home/devbox/project",
  "domain": "cloud.sealos.io",
  "ports": [{ "portName": "...", "number": 3000, "protocol": "http", "isPublic": true, "publicDomain": "xyz.cloud.sealos.io", "privateAddress": "..." }],
  "autostarted": false,
  "summary": { "totalPorts": 1, "successfulPorts": 1, "failedPorts": 0 }
}
```

**Important:** The `base64PrivateKey` is the SSH private key encoded in base64. Decode before saving to a file with 0600 permissions.

### GET /devbox — List All Devboxes

Response: `200 OK` → Array of `{ name, uid, resourceType, runtime, status, quota }`

Status values: `pending`, `running`, `stopped`, `error`

### GET /devbox/{name} — Get Devbox Details

Response: `200 OK` → Full object with SSH info, ports, env, pods.

Status values: `running`, `stopped`, `pending`, `error`

SSH info:

```json
{
  "ssh": {
    "host": "devbox.cloud.sealos.io",
    "port": 40001,
    "user": "devbox",
    "workingDir": "/home/devbox/project",
    "privateKey": "base64-encoded (optional)"
  }
}
```

### PATCH /devbox/{name} — Update Resources/Ports

```json
{
  "quota": { "cpu": 2, "memory": 4 },
  "ports": [
    { "portName": "existing-port", "isPublic": false },
    { "number": 8080, "protocol": "http", "isPublic": true }
  ]
}
```

Response: `204 No Content`

**Port update behavior:** Include `portName` to update existing ports. Omit `portName` to create new ports. Existing ports not included in the array will be **deleted**.

### DELETE /devbox/{name} — Delete Devbox

Response: `204 No Content`

### POST /devbox/{name}/start — Start Devbox

Response: `204 No Content`

### POST /devbox/{name}/pause — Pause Devbox

Pauses the devbox (quick resume, keeps resources allocated).

Response: `204 No Content`

### POST /devbox/{name}/shutdown — Shutdown Devbox

Shuts down the devbox (releases resources, slower resume).

Response: `204 No Content`

### POST /devbox/{name}/restart — Restart Devbox

Response: `204 No Content`

### POST /devbox/{name}/autostart — Configure Autostart

```json
{
  "execCommand": "/bin/bash /home/devbox/project/entrypoint.sh"
}
```

Body is optional — send empty `{}` to enable autostart with default behavior.

Response: `204 No Content`

### GET /devbox/{name}/releases — List Releases

Response: `200 OK` → Array of `{ id, name, devboxName, createdAt, tag, description, image }`

### POST /devbox/{name}/releases — Create Release

```json
{
  "tag": "v1.0.0",
  "releaseDescription": "First stable release",
  "execCommand": "nohup /home/devbox/project/entrypoint.sh > /dev/null 2>&1 &",
  "startDevboxAfterRelease": true
}
```

Response: `202 Accepted` → `{ "name": "...", "status": "creating" }`

**Note:** Release creation is asynchronous. Poll `GET /devbox/{name}/releases` to track progress.

### DELETE /devbox/{name}/releases/{tag} — Delete Release

Response: `204 No Content`

### POST /devbox/{name}/releases/{tag}/deploy — Deploy Release

Deploys the release to AppLaunchpad. No request body needed.

Response: `204 No Content`

### GET /devbox/{name}/deployments — List Deployments

Response: `200 OK` → Array of `{ name, resourceType, tag }`

Resource types: `deployment`, `statefulset`

### GET /devbox/{name}/monitor — Get Metrics

Query parameters:
- `start` (optional) — Unix timestamp (seconds or milliseconds). Defaults to `end − 3h`.
- `end` (optional) — Unix timestamp. Defaults to current server time.
- `step` (optional) — Sampling interval (e.g. `1m`, `5m`, `1h`). Default: `2m`.

Response: `200 OK` → Array of `{ timestamp, readableTime, cpu, memory }`

CPU and memory values are utilization percentages.

## Error Response Format

```json
{
  "error": {
    "type": "validation_error",
    "code": "INVALID_PARAMETER",
    "message": "...",
    "details": [...]
  }
}
```

Types: `validation_error`, `resource_error`, `internal_error`
