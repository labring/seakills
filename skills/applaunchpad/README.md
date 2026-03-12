# Sealos AppLaunchpad — Claude Code Skill

Deploy and manage containerized applications on [Sealos](https://sealos.io) using natural language. Create, scale, update, and manage apps from pre-built Docker images — without leaving your terminal.

## Quick Start

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- A [Sealos](https://sealos.io) account (login is handled automatically via OAuth)

### Install

Copy the `applaunchpad` skill into your project's `.claude/skills/` directory. Claude Code auto-detects it.

### Usage

Ask Claude Code in natural language, or run `/sealos-applaunchpad`:

```
> Deploy an nginx app on Sealos
> Launch a Redis cache
> Show my running apps
> Scale my-api to 2 cores and 4 GB memory
> Stop my staging app
> Delete the old test app
> Add 10Gi storage to my-app
> Update my-app's image to node:22-slim
```

Claude walks you through authentication, configuration, and execution interactively.

## Features

- **One-command deploy** — deploy any Docker image with smart resource defaults based on your tech stack
- **Full lifecycle** — create, list, inspect, update, delete, start, pause, restart
- **Auto-scaling** — fixed replicas or HPA (CPU/memory/GPU-based) auto-scaling
- **Networking** — public URLs with HTTP/gRPC/WebSocket support, plus private internal addresses
- **GPU support** — attach NVIDIA GPUs (A100, V100, T4) for ML/AI workloads
- **Storage management** — attach and expand persistent volumes (expand-only, per Kubernetes)
- **Environment & config** — manage env vars, config maps, and storage volumes per app
- **Project integration** — optionally saves access URLs to `.env` for easy use in your code
- **Safe deletes** — requires you to type the exact app name before destroying anything

## Authentication

On first use, Claude opens your browser for Sealos OAuth login. Credentials are cached locally at `~/.sealos/kubeconfig` and reused across sessions. Three regions are available: `gzg`, `bja`, and `hzh`.

## Supported Operations

| Operation | Description |
|-----------|-------------|
| **Create** | Deploy a new app from a Docker image with customizable CPU, memory, ports, env, storage |
| **List** | Show all apps with status, resources, and replica count |
| **Get** | Inspect a specific app's full configuration and access URLs |
| **Update** | Change image, resources, ports, env vars, config maps, or storage |
| **Delete** | Permanently remove an app (with name confirmation) |
| **Start** | Resume a paused app |
| **Pause** | Scale to zero replicas (preserves configuration) |
| **Restart** | Rolling restart of all replicas |
| **Storage** | Add or expand persistent volumes (incremental, expand-only) |

## Resource Defaults

| Tech Stack | Recommended Image | Default Port |
|------------|-------------------|-------------|
| Next.js / React | `node:20-slim` | 3000 |
| Django / FastAPI | `python:3.12-slim` | 8000 |
| Flask | `python:3.12-slim` | 5000 |
| Go | `golang:1.22` | 8080 |
| Spring Boot | `eclipse-temurin:21` | 8080 |
| Static site | `nginx:alpine` | 80 |
| Rust | `rust:1-slim` | 8080 |
| gRPC service | (varies) | 50051 |

Default resources: 0.2 CPU, 0.5 GB memory, 1 replica. Production hints auto-scale to 1 CPU, 2 GB, 3 replicas.
