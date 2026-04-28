# Sealos Template API Reference

Base URL: `https://template.{domain}/api/v2alpha`

> **API Version:** `v2alpha` — centralized in the script constant `API_PATH` (`scripts/sealos-template.mjs`).
> If the API version changes, update `API_PATH` in the script; the rest auto-follows.

## TLS Note

The script sets `rejectUnauthorized: false` for HTTPS requests because Sealos clusters
may use self-signed TLS certificates. Without this, Node.js would reject connections
to clusters that don't have publicly trusted certificates.

## Authentication

Browsing templates (`GET /templates`, `GET /templates/{name}`) is **public** — no auth needed.

Deploying instances (`POST /templates/instances`, `POST /templates/raw`) requires a
URL-encoded kubeconfig YAML in the `Authorization` header:

```
Authorization: <encodeURIComponent(kubeconfigYaml)>
```

## Instance Name Constraints

Pattern: `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`
Length: 1–63 characters (Kubernetes DNS subdomain rules)

## Endpoints

### GET /templates — List All Templates

**No authentication required.**

Query parameters:
- `language` (optional, default: `"en"`) — Language code (e.g., `"en"`, `"zh"`)

Response headers:
- `Cache-Control: public, max-age=300, s-maxage=600`
- `ETag: "template-list-{language}"`
- `X-Menu-Keys` — Top category keys, comma-separated (e.g., `"ai,database"`). Present only when categories exist.

Response: `200 OK` → Array of template objects:

```json
[
  {
    "name": "perplexica",
    "resourceType": "template",
    "readme": "https://...",
    "icon": "https://...",
    "description": "AI-powered search engine",
    "gitRepo": "https://github.com/ItzCrazyKns/Perplexica",
    "category": ["ai"],
    "args": {
      "OPENAI_API_KEY": {
        "description": "OpenAI API Key",
        "type": "string",
        "default": "",
        "required": true
      }
    },
    "deployCount": 156
  }
]
```

**Note:** List response does NOT include `quota` — use `GET /templates/{name}` for resource requirements.

### GET /templates/{name} — Get Template Details

**No authentication required.**

Path parameters:
- `name` (required) — Template name identifier

Query parameters:
- `language` (optional, default: `"en"`) — Language code

Response headers:
- `Cache-Control: public, max-age=300, s-maxage=600`
- `ETag: "{name}-{language}"`

Response: `200 OK` → Full template object with `quota`:

```json
{
  "name": "perplexica",
  "resourceType": "template",
  "readme": "https://...",
  "icon": "https://...",
  "description": "AI-powered search engine",
  "gitRepo": "https://github.com/ItzCrazyKns/Perplexica",
  "category": ["ai"],
  "args": {
    "OPENAI_API_KEY": {
      "description": "The API Key of the OpenAI-compatible service",
      "type": "string",
      "default": "",
      "required": true
    }
  },
  "deployCount": 156,
  "quota": {
    "cpu": 1,
    "memory": 2.25,
    "storage": 2,
    "nodeport": 0
  }
}
```

### POST /templates/instances — Create Template Instance

**Authentication required.**

Request body:

```json
{
  "name": "my-perplexica-instance",
  "template": "perplexica",
  "args": {
    "OPENAI_API_KEY": "sk-xxxx",
    "OPENAI_MODEL_NAME": "gpt-4o"
  }
}
```

| Field | Required | Type | Constraint |
|-------|----------|------|------------|
| name | yes | string | DNS pattern, 1–63 chars |
| template | yes | string | Must exist in catalog |
| args | no | object | Key-value pairs; only args without default are required |

Response: `201 Created` →

```json
{
  "name": "my-perplexica-instance",
  "uid": "778bf3c6-...",
  "resourceType": "instance",
  "displayName": "",
  "createdAt": "2026-01-28T03:31:01Z",
  "args": { "OPENAI_API_KEY": "sk-xxxx", "OPENAI_API_URL": "https://...", "OPENAI_MODEL_NAME": "gpt-4o" },
  "resources": [
    {
      "name": "my-perplexica-instance-searxng",
      "uid": "5bd2c77d-...",
      "resourceType": "deployment",
      "quota": { "cpu": 0.1, "memory": 0.25, "storage": 0, "replicas": 1 }
    }
  ]
}
```

### POST /templates/raw — Deploy from Raw YAML

**Authentication required.**

Request body:

```json
{
  "yaml": "apiVersion: app.sealos.io/v1\nkind: Template\n...",
  "args": { "MY_SECRET": "value" },
  "dryRun": true
}
```

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| yaml | yes | string | Full template YAML (must start with `kind: Template`) |
| args | no | object | Override/supply `spec.inputs` fields |
| dryRun | no | boolean | Validate without creating (default: false) |

Response `200 OK` (dry-run):

```json
{
  "name": "myapp-abcdefgh",
  "resourceType": "instance",
  "dryRun": true,
  "args": {},
  "resources": [...]
}
```

Response `201 Created` (actual deploy):

```json
{
  "name": "myapp-abcdefgh",
  "uid": "778bf3c6-...",
  "resourceType": "instance",
  "displayName": "",
  "createdAt": "2026-01-28T03:31:01Z",
  "args": {},
  "resources": [...]
}
```

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

### Error Codes

| HTTP | Code | Meaning |
|------|------|---------|
| 400 | INVALID_PARAMETER | Missing/invalid field — `details` has `[{field, message}]` |
| 400 | INVALID_VALUE | Value validation failed (e.g., name format, YAML structure) |
| 401 | AUTHENTICATION_REQUIRED | Missing or invalid kubeconfig |
| 403 | PERMISSION_DENIED | Insufficient K8s privileges |
| 404 | NOT_FOUND | Template doesn't exist in catalog |
| 409 | ALREADY_EXISTS | Instance name already taken |
| 422 | INVALID_RESOURCE_SPEC | K8s rejected resource spec (admission webhook, quota exceeded) |
| 500 | KUBERNETES_ERROR | K8s API error |
| 500 | INTERNAL_ERROR | Unexpected server error |
| 503 | SERVICE_UNAVAILABLE | K8s cluster unreachable |
