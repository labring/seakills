# Sealos DB — Claude Code Skill

Manage databases on [Sealos](https://sealos.io) using natural language. Create, scale, backup, and manage PostgreSQL, MongoDB, Redis, and 8 more database types — without leaving your terminal.

## Quick Start

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- A [Sealos](https://sealos.io) account (login is handled automatically via OAuth)

### Install

Copy the `database` skill into your project's `.claude/skills/` directory. Claude Code auto-detects it.

### Usage

Ask Claude Code in natural language, or run `/sealos-db`:

```
> I need a PostgreSQL database for my app
> Create a Redis cache
> Show my databases
> Scale my-app-pg to 4 cores and 8 GB memory
> Delete the test database
> Enable public access on my-app-pg
> Backup my production database
> Restore from last night's backup
> Show slow query logs for my-app-pg
> Restart the staging database
```

Claude walks you through authentication, configuration, and execution interactively.

## Features

- **Smart defaults** — detects your tech stack and recommends a database type, version, and resources
- **Full lifecycle** — create, list, inspect, update, delete, start, pause, restart
- **11 database types** — PostgreSQL, MongoDB, MySQL, Redis, Kafka, ClickHouse, Qdrant, Milvus, Weaviate, Nebula, Pulsar
- **Public access control** — expose or hide databases from the internet
- **Backup & restore** — create snapshots, list backups, restore to a new instance
- **Log inspection** — view runtime logs, slow queries, and error logs
- **Project integration** — writes connection info to `.env`, `docker-compose.yml`, or framework config
- **Safe deletes** — requires explicit name confirmation before destroying anything

## Authentication

On first use, Claude opens your browser for OAuth2 login. Credentials are saved to `~/.sealos/kubeconfig` and the API URL is auto-derived from `~/.sealos/auth.json`. Three regions are available: `gzg`, `bja`, and `hzh`.

## Supported Operations

| Operation | Description |
|-----------|-------------|
| **Create** | Deploy a new database with customizable type, version, CPU, memory, storage, and replicas |
| **List** | Show all databases with status, resources, and replica count |
| **Get** | Inspect a specific database's full configuration and connection info |
| **Update** | Scale CPU, memory, storage, or replicas (storage expand-only) |
| **Delete** | Permanently remove a database (with name confirmation) |
| **Start** | Resume a paused database |
| **Pause** | Scale database to zero (preserves data) |
| **Restart** | Rolling restart of all replicas |
| **Public Access** | Enable or disable internet-facing connections |
| **Backup** | Create, list, delete, or restore from snapshots |
| **Logs** | View runtime logs, slow queries, and error logs |

## Supported Database Types

| Type | Identifier | Default Port | Typical Use |
|------|-----------|------|-------------|
| PostgreSQL | `postgresql` | 5432 | General-purpose RDBMS |
| MongoDB | `mongodb` | 27017 | Document database |
| MySQL | `apecloud-mysql` | 3306 | General-purpose RDBMS |
| Redis | `redis` | 6379 | Cache, sessions, pub/sub |
| Kafka | `kafka` | 9092 | Event streaming |
| ClickHouse | `clickhouse` | 8123 | Analytics / OLAP |
| Qdrant | `qdrant` | 6333 | Vector search |
| Milvus | `milvus` | 19530 | Vector search |
| Weaviate | `weaviate` | 8080 | Vector search |
| Nebula | `nebula` | 9669 | Graph database |
| Pulsar | `pulsar` | 6650 | Message queue |

## Resource Defaults

| Scenario | CPU | Memory | Storage | Replicas | Trigger |
|----------|-----|--------|---------|----------|---------|
| Default | 1 | 1 GB | 3 GB | 3 | No size hint, "dev", "testing" |
| Medium | 2 | 2 GB | 10 GB | 1 | "small", "starter" |
| Production | 2 | 4 GB | 20 GB | 3 | "prod", "production", "HA" |

CPU: 1–8 cores. Memory: 0.1–32 GB. Storage: 1–300 GB (expand-only). Replicas: 1–20.
