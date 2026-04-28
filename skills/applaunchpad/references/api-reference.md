# Sealos AppLaunchpad API Reference

Base URL: `https://applaunchpad.{domain}/api/v2alpha`

> **API Version:** `v2alpha` — centralized in the script constant `API_PATH` (`scripts/sealos-applaunchpad.mjs`).
> If the API version changes, update `API_PATH` in the script; the rest auto-follows.

## TLS Note

The script sets `rejectUnauthorized: false` for HTTPS requests because Sealos clusters
may use self-signed TLS certificates. Without this, Node.js would reject connections
to clusters that don't have publicly trusted certificates.

## Authentication

All requests require a URL-encoded kubeconfig YAML in the `Authorization` header.
There are no unauthenticated endpoints (unlike the DB API).

```
Authorization: <encodeURIComponent(kubeconfigYaml)>
```

## Endpoints

| # | Method | Path | OperationID | Description |
|---|--------|------|-------------|-------------|
| 1 | GET | /apps | listApps | List all applications |
| 2 | POST | /apps | createApp | Create a new application |
| 3 | GET | /apps/{name} | getApp | Get application details by name |
| 4 | PATCH | /apps/{name} | updateApp | Update application configuration |
| 5 | DELETE | /apps/{name} | deleteApp | Delete application |
| 6 | POST | /apps/{name}/start | startApp | Start paused application |
| 7 | POST | /apps/{name}/pause | pauseApp | Pause application (scales to zero) |
| 8 | POST | /apps/{name}/restart | restartApp | Restart application |
| 9 | PATCH | /apps/{name}/storage | updateAppStorage | Update storage (incremental merge, expand only) |

## Resource Constraints

### Create (POST /apps)

| Field | Required | Type | Constraint | Default |
|-------|----------|------|------------|---------|
| name | no | string | `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`, max 63 | "hello-world" |
| image.imageName | yes (via image) | string | Docker image with tag | "nginx" |
| image.imageRegistry | no | object/null | `{ username, password, serverAddress }` or null | null |
| launchCommand.command | no | string | Container run command | — |
| launchCommand.args | no | string[] | Command arguments | — |
| quota.cpu | no | number | range: 0.1–32 (continuous) | 0.2 |
| quota.memory | no | number | range: 0.1–32 GB (continuous) | 0.5 |
| quota.replicas | no | number | enum: 1–20 (mutually exclusive with hpa) | — |
| quota.gpu | no | object | `{ vendor (default "nvidia"), type (required), amount (default 1) }` | — |
| quota.hpa | no | object | `{ target (cpu\|memory\|gpu), value (%), minReplicas, maxReplicas }` — all required | — |
| ports[] | no | array | see Port object below | `[{ number: 80, protocol: "http", isPublic: true }]` |
| env[] | no | array | `{ name (required), value, valueFrom }` | `[]` |
| configMap[] | no | array | `{ path (required), value }` | `[]` |
| storage[] | no | array | `{ name (required), path (required), size (default "1Gi") }` | `[]` |

**Only `quota` is strictly required** in the request body. Image defaults to `{ imageName: "nginx" }`.

#### Port Object (Create)

| Field | Required | Type | Constraint | Default |
|-------|----------|------|------------|---------|
| number | yes | number | 1–65535 | — |
| protocol | no | string | enum: http, grpc, ws, tcp, udp, sctp | http |
| isPublic | no | boolean | Only effective for http/grpc/ws protocols | true |

#### GPU Object

| Field | Required | Type | Constraint | Default |
|-------|----------|------|------------|---------|
| vendor | no | string | GPU vendor | nvidia |
| type | yes | string | GPU model (e.g., A100, V100, T4) | — |
| amount | no | number | Number of GPUs | 1 |

#### HPA Object

| Field | Required | Type | Constraint |
|-------|----------|------|------------|
| target | yes | string | enum: cpu, memory, gpu |
| value | yes | number | Target utilization percentage |
| minReplicas | yes | number | Minimum replica count |
| maxReplicas | yes | number | Maximum replica count |

**Note:** `replicas` and `hpa` are mutually exclusive. Provide one or the other, not both.

### Update (PATCH /apps/{name})

| Field | Type | Allowed Values | Notes |
|-------|------|----------------|-------|
| quota.cpu | number | 0.1, 0.2, 0.5, 1, 2, 3, 4, 8 | Discrete values only |
| quota.memory | number | 0.1, 0.5, 1, 2, 4, 8, 16 GB | Discrete values only |
| quota.replicas | number | enum: 1–20 | Set to switch from HPA to fixed |
| quota.hpa | object | same as create | Set to switch from fixed to HPA (omit replicas) |
| quota.gpu | object | `{ vendor, type, amount }` | |
| image | object | `{ imageName (required), imageRegistry }` | |
| launchCommand | object | `{ command, args[] }` | |
| ports[] | array | see below | **COMPLETE REPLACEMENT** |
| env[] | array | same as create | **COMPLETE REPLACEMENT** |
| configMap[] | array | `{ path (required), value }` | **COMPLETE REPLACEMENT** |
| storage[] | array | `{ path (required), size }` — name auto-generated | **COMPLETE REPLACEMENT** |

**COMPLETE REPLACEMENT semantics for ports, env, configMap, storage:**
- Pass ALL items you want to keep — items not listed are deleted
- Pass empty array `[]` to remove all items
- Omit the field entirely to keep existing items unchanged

**Ports in update:** Include `portName` to update an existing port, omit `portName` to create a new port.
Ports not included in the array will be deleted.

### Storage Update (PATCH /apps/{name}/storage)

| Field | Type | Notes |
|-------|------|-------|
| storage[] | array | `{ path (required), size (default "1Gi") }` |

**INCREMENTAL merge** — only list items to add or modify. Unlisted items are preserved.
`name` is auto-generated from `path` (unlike POST where name is user-provided).
**Expand only** — storage cannot be shrunk (Kubernetes limitation).

## Endpoint Details

### POST /apps — Create

```json
{
  "name": "my-app",
  "image": { "imageName": "nginx:alpine" },
  "quota": { "cpu": 0.2, "memory": 0.5, "replicas": 1 },
  "ports": [{ "number": 80, "protocol": "http", "isPublic": true }],
  "env": [{ "name": "NODE_ENV", "value": "production" }],
  "configMap": [{ "path": "/etc/app/config.yaml", "value": "key: value" }],
  "storage": [{ "name": "data", "path": "/var/data", "size": "10Gi" }]
}
```

Response: `201 Created` → Full application object (same as GET response)

### GET /apps — List All

Response: `200 OK` → Array of application objects

### GET /apps/{name} — Get Details

Response: `200 OK` → Full application object

Application object fields:

```json
{
  "name": "my-app",
  "image": { "imageName": "nginx:alpine", "imageRegistry": null },
  "launchCommand": { "command": "", "args": [] },
  "quota": { "cpu": 0.2, "memory": 0.5, "replicas": 1 },
  "ports": [
    {
      "number": 80,
      "portName": "abcdef123456",
      "protocol": "http",
      "privateAddress": "http://my-app.ns-xxx:80",
      "publicAddress": "https://abcdef123456.cloud.sealos.io",
      "customDomain": ""
    }
  ],
  "env": [],
  "storage": [],
  "configMap": [],
  "resourceType": "launchpad",
  "kind": "deployment",
  "uid": "abc123-def456-789",
  "createdAt": "2024-01-01T00:00:00Z",
  "upTime": "2h15m",
  "status": "running"
}
```

Status values: `running`, `creating`, `waiting`, `error`, `pause`

### PATCH /apps/{name} — Update

```json
{
  "quota": { "cpu": 1, "memory": 2 },
  "ports": [
    { "number": 80, "protocol": "http", "isPublic": true, "portName": "existing-port-name" },
    { "number": 8080, "protocol": "http", "isPublic": false }
  ]
}
```

Response: `204 No Content`

### DELETE /apps/{name} — Delete

Response: `204 No Content`

### POST /apps/{name}/start — Start

Response: `204 No Content`

### POST /apps/{name}/pause — Pause

Scales the application to zero replicas.

Response: `204 No Content`

### POST /apps/{name}/restart — Restart

Response: `204 No Content`

### PATCH /apps/{name}/storage — Update Storage

```json
{
  "storage": [{ "path": "/var/data", "size": "20Gi" }]
}
```

Response: `204 No Content`

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
