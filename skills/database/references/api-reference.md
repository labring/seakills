# Sealos Database API Reference

Base URL: `https://dbprovider.{domain}/api/v2alpha`

> **API Version:** `v2alpha` — centralized in the script constant `API_PATH` (`scripts/sealos-db.mjs`).
> If the API version changes, update `API_PATH` in the script; the rest auto-follows.

## TLS Note

The script sets `rejectUnauthorized: false` for HTTPS requests because Sealos clusters
may use self-signed TLS certificates. Without this, Node.js would reject connections
to clusters that don't have publicly trusted certificates.

## Authentication

All requests require a URL-encoded kubeconfig YAML in the `Authorization` header,
**except** `GET /databases/versions` which requires no authentication.

```
Authorization: <encodeURIComponent(kubeconfigYaml)>
```

## Supported Database Types

| Type | Identifier | Default Port | Typical Use |
|------|-----------|------|-------------|
| PostgreSQL | `postgresql` | 5432 | General purpose RDBMS |
| MongoDB | `mongodb` | 27017 | Document database |
| MySQL | `apecloud-mysql` | 3306 | General purpose RDBMS |
| Redis | `redis` | 6379 | Cache, sessions, pub/sub |
| Kafka | `kafka` | 9092 | Event streaming |
| Qdrant | `qdrant` | 6333 | Vector search |
| Nebula | `nebula` | 9669 | Graph database |
| Weaviate | `weaviate` | 8080 | Vector search |
| Milvus | `milvus` | 19530 | Vector search |
| Pulsar | `pulsar` | 6650 | Message queue |
| ClickHouse | `clickhouse` | 8123 | Analytics/OLAP |

**Note:** MySQL type is `apecloud-mysql`, NOT `mysql`.

## Resource Constraints

### Create (POST /databases)

| Field | Type | Range | Default |
|-------|------|-------|---------|
| cpu | number | enum: 1, 2, 3, 4, 5, 6, 7, 8 | 1 |
| memory | number | 0.1 - 32 GB (continuous range) | 1 |
| storage | number | 1 - 300 GB | 3 |
| replicas | integer | 1 - 20 | 3 |

### Update (PATCH /databases/{name})

| Field | Type | Allowed Values | Notes |
|-------|------|----------------|-------|
| cpu | number | 1, 2, 3, 4, 5, 6, 7, 8 | |
| memory | number | 1, 2, 4, 6, 8, 12, 16, 32 GB | Discrete values only |
| storage | number | 1 - 300 GB | **Expand only, cannot shrink** |
| replicas | integer | 1 - 20 | |

All update fields are optional -- only provide fields to change.

## Endpoints

### POST /databases -- Create

```json
{
  "name": "my-db",
  "type": "postgresql",
  "version": "postgresql-14.8.0",   // optional, auto-selects latest
  "quota": { "cpu": 1, "memory": 1, "storage": 3, "replicas": 1 },
  "terminationPolicy": "delete",    // optional, "delete" or "wipeout"
  "autoBackup": { ... },            // optional
  "parameterConfig": { ... }        // optional
}
```

Response: `201 Created` -> `{ "name": "my-db", "status": "creating" }`

### GET /databases -- List All

Response: `200 OK` -> Array of `{ name, uid, type, version, status, quota }`

Status values: `Running`, `Stopped`, `Creating`, `Updating`, `Failed`, `Deleting`
> **Note:** List returns capitalized statuses (`Running`), Get returns lowercase (`running`).
> Always compare case-insensitively (e.g., `.toLowerCase() === 'running'`).

### GET /databases/{name} -- Get Details

Response: `200 OK` -> Full object with connection info.

Status values: `creating`, `starting`, `stopping`, `stopped`, `running`, `updating`,
`specUpdating`, `rebooting`, `upgrade`, `verticalScaling`, `volumeExpanding`, `failed`, `unknown`, `deleting`

Connection info:

```json
{
  "connection": {
    "privateConnection": {
      "endpoint": "host:port",
      "host": "my-db-postgresql.ns-xxx.svc.cluster.local",
      "port": "5432",
      "username": "postgres",
      "password": "s3cr3tpassword",
      "connectionString": "postgresql://postgres:pass@host:5432/postgres"
    },
    "publicConnection": null
  }
}
```

### GET /databases/versions -- List Available Versions

**No authentication required.** This endpoint uses the server's own service account.

Response: `200 OK` -> `{ "postgresql": ["postgresql-14.8.0", ...], ... }`

### PATCH /databases/{name} -- Update Resources

```json
{ "quota": { "cpu": 2, "memory": 4 } }
```

Response: `204 No Content`

### DELETE /databases/{name} -- Delete

Response: `204 No Content` (idempotent: returns 204 even if not found)

### POST /databases/{name}/{action} -- Actions

Actions: `start`, `pause`, `restart`, `enable-public`, `disable-public`

Response: `204 No Content` (all idempotent)

### GET /databases/{name}/backups -- List Backups

Response: `200 OK` -> Array of `{ name, description, createdAt, status }`

Status values: `completed`, `inprogress`, `failed`, `unknown`, `running`, `deleting`

### POST /databases/{name}/backups -- Create Backup

```json
{
  "description": "pre-migration snapshot",
  "name": "my-custom-backup-name"
}
```

Both fields are optional. Description max 31 characters (Kubernetes label limit).
Name auto-generated if omitted.

Response: `204 No Content`

### DELETE /databases/{name}/backups/{backupName} -- Delete Backup

Response: `204 No Content`

### POST /databases/{name}/backups/{backupName}/restore -- Restore from Backup

Creates a **new** database instance from the backup. The original database is not affected.

```json
{
  "name": "my-db-restored",
  "replicas": 3
}
```

Both fields are optional. Name auto-generated if omitted. Replicas inherited from source if omitted.

Response: `204 No Content`

### GET /logs -- Get Database Log Entries

Query parameters (all required unless noted):
- `podName` (required) — Pod name to retrieve logs from
- `dbType` (required) — `mysql`, `mongodb`, `redis`, or `postgresql`
- `logType` (required) — `runtimeLog`, `slowQuery`, or `errorLog`
- `logPath` (required) — Absolute path to the log file within the pod
- `page` (optional, default: 1) — Page number for pagination
- `pageSize` (optional, default: 100, max: 1000) — Entries per page

Response: `200 OK`

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "logs": [
      { "timestamp": "2024-01-15T02:00:00Z", "level": "LOG", "content": "checkpoint starting" }
    ],
    "metadata": {
      "total": 1500,
      "page": 1,
      "pageSize": 100,
      "processingTime": "50ms",
      "hasMore": true
    }
  }
}
```

### GET /logs/files -- List Log Files

Query parameters (all required):
- `podName` (required) — Pod name to list log files from
- `dbType` (required) — `mysql`, `mongodb`, `redis`, or `postgresql`
- `logType` (required) — `runtimeLog`, `slowQuery`, or `errorLog`

Response: `200 OK`

```json
{
  "code": 200,
  "message": "ok",
  "data": [
    {
      "name": "postgresql.log",
      "path": "/var/log/postgresql/postgresql.log",
      "dir": "/var/log/postgresql",
      "size": 1048576,
      "updateTime": "2024-01-15T02:00:00Z"
    }
  ]
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

Types: `validation_error`, `resource_error`, `internal_error`
