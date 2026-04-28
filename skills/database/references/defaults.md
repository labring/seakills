# Sealos DB Defaults & Presets

## Resource Presets (internal)

Used to set initial default values based on user intent. These are NOT shown
to the user as "tiers" — the user sees individual CPU/Memory/Storage/Replicas fields.

| Scenario | CPU | Memory | Storage | Replicas | Trigger phrases |
|----------|-----|--------|---------|----------|-----------------|
| Default | 1 | 1 GB | 3 GB | 3 | no size hint, "dev", "testing", "try" |
| Medium | 2 | 2 GB | 10 GB | 1 | "small", "starter" |
| Production | 2 | 4 GB | 20 GB | 3 | "prod", "production", "HA", "high availability" |
| Custom | — | — | — | — | specific numbers like "4 cores, 8g memory" |

> **Why Default has 3 replicas but Medium has 1:** Default is the safe fallback when
> intent is unclear — 3 replicas ensure the user doesn't accidentally create a
> single-point-of-failure. Medium is for users who explicitly said "small/starter",
> signaling they accept fewer replicas for lower cost.

## Type Recommendation Rules

Match project tech stack to a recommended database type.

| Tech stack signal | Recommended type | Why |
|-------------------|------------------|-----|
| Web frameworks (Next.js, Rails, Django, Laravel, Spring, Express, FastAPI, etc.) | postgresql | General-purpose RDBMS, best ecosystem support |
| Caching / sessions / rate limiting | redis | In-memory, sub-ms latency |
| Document-heavy / schemaless / flexible schema | mongodb | Native JSON documents |
| Event streaming / log aggregation | kafka | Distributed event log |
| Vector search / AI / embeddings / RAG | qdrant, milvus, or weaviate | Purpose-built vector indexes |
| Analytics / OLAP / time-series aggregation | clickhouse | Columnar storage, fast aggregation |
| Graph relationships / knowledge graphs | nebula | Native graph engine |
| Message queues / pub-sub (non-Kafka) | pulsar | Multi-tenant messaging |

When multiple types fit, prefer the first match in the table.

## Config Summary Template

Display this read-only summary before asking the user to confirm or customize.
Shows every field individually — no "tier" abstraction in the user-facing output.

```
Database config:

  Name:     [project]-[type-suffix]
  Type:     [Type] ([reason])
  Version:  [version] (latest)
  CPU:      [n] Core(s)
  Memory:   [n] GB
  Storage:  [n] GB
  Replicas: [n]
```

## Field Generation Rules

- **Type list**: always derive from `sealos-db.mjs list-versions` output, not hardcoded
- **Type suffix for name**: pg, mongo, mysql, redis, kafka, qdrant, milvus, weaviate, ch, nebula, pulsar
- **Version**: use the latest (first) version from `list-versions` for the chosen type
- **Name**: `[project-directory-name]-[type-suffix]`, lowercased, truncated to 63 chars

## AskUserQuestion Option Guidelines

**Hard limit: max 4 options per `AskUserQuestion` call.** The tool auto-appends implicit
options ("Type something", "Chat about this") which consume slots. More than 4 user-provided
options will be truncated and invisible to the user. This limit applies regardless of
whether `multiSelect` is enabled — `multiSelect: true` allows choosing multiple from the
same max-4 option list.

When building options for `AskUserQuestion`:
- **Name options**: generate 2-3 name suggestions from project dir + type. If a name
  already exists (from list), avoid it and note the conflict.
- **Type options**: Always output ALL types as a numbered text list first, then
  AskUserQuestion with max 4 clickable options (top 4 types for the context).
  Mark recommended with "(Recommended)". User can type any other type name/number.
- **Version options**: Always output ALL versions as a numbered text list first, then
  AskUserQuestion with max 4 clickable options (latest 4 versions).
  Mark latest with "(latest)". User can type any other version.
- **CPU options**: max 4 items: 1, 2, 4, 8 cores.
- **Memory options**: max 4 items: 1, 2, 4, 8 GB.
- **Storage options**: max 4 items: 3, 10, 20, 50 GB.
- **Replicas options**: max 4 items: 1, 2, 3, 5.
- For all resource options, mark current value with "(current)".
  User can type other valid values via "Type something".
- **Database picker** (for get/update/delete/action): list database names from
  `sealos-db.mjs list` as options, up to 4. If more than 4, show most recent ones.

## Termination Policy

| Policy | Behavior | Default |
|--------|----------|---------|
| `delete` | Cluster removed, PVC data volumes kept | Yes |
| `wipeout` | Everything removed, irreversible | No |

**Cannot be changed after creation.** Always shown in config summary and available
in the customize flow. Default to `delete` in the recommended config.

## Create API Field Reference (from openapi.json)

| Field | Required | Type | Constraint | Default |
|-------|----------|------|------------|---------|
| name | yes | string | `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`, max 63 | — |
| type | yes | string | enum from `list-versions` | — |
| version | no | string | from `list-versions` | latest |
| quota.cpu | yes | number | enum: 1,2,3,4,5,6,7,8 | 1 |
| quota.memory | yes | number | range: 0.1–32 GB | 1 |
| quota.storage | yes | number | range: 1–300 GB | 3 |
| quota.replicas | yes | integer | range: 1–20 | 3 |
| terminationPolicy | no | string | enum: delete, wipeout | delete |
| autoBackup | no | object | see openapi.json | none |
| parameterConfig | no | object | DB-specific | none |

**Note:** Memory for create is a continuous range (0.1–32),
while update is discrete enum (1,2,4,6,8,12,16,32).
