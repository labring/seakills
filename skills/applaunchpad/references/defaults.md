# Sealos AppLaunchpad Defaults & Presets

## Resource Presets (internal)

Used to set initial default values based on user intent. These are NOT shown
to the user as "tiers" — the user sees individual CPU/Memory/Replicas fields.

| Scenario | CPU | Memory | Replicas | Trigger phrases |
|----------|-----|--------|----------|-----------------|
| Default | 0.2 | 0.5 GB | 1 | no hint, "dev", "testing", "try" |
| Small | 0.5 | 1 GB | 1 | "small", "starter" |
| Production | 1 | 2 GB | 3 | "prod", "production" |
| HA | 2 | 4 GB | 3 | "HA", "high availability" |
| Custom | — | — | — | specific numbers like "0.5 cores, 1g memory" |

## Image Recommendations by Tech Stack

| Tech stack | Image | Default port | Protocol |
|------------|-------|-------------|----------|
| Next.js / React | node:20-slim | 3000 | http |
| Django / FastAPI | python:3.12-slim | 8000 | http |
| Flask | python:3.12-slim | 5000 | http |
| Go | golang:1.22 | 8080 | http |
| Spring Boot | eclipse-temurin:21 | 8080 | http |
| Static site | nginx:alpine | 80 | http |
| Rust | rust:1-slim | 8080 | http |
| gRPC service | (varies) | 50051 | grpc |

When multiple stacks fit, prefer the first match in the table.

## Config Summary Template

Display this read-only summary before asking the user to confirm or customize.
Shows every field individually — no "tier" abstraction in the user-facing output.

```
App config:

  Name:      [name]
  Image:     [imageName]
  CPU:       [n] Core(s)
  Memory:    [n] GB
  Scaling:   [n] replica(s) | HPA [min]-[max] target [metric] [value]%
  Ports:     [number]/[protocol] (public|private)
  Env:       [count] variable(s)
  Storage:   [count] volume(s)
  ConfigMap: [count] file(s)
```

## AskUserQuestion Option Guidelines

**Hard limit: max 4 options per `AskUserQuestion` call.** The tool auto-appends implicit
options ("Type something", "Chat about this") which consume slots. More than 4 user-provided
options will be truncated and invisible to the user.

When building options for `AskUserQuestion`:
- **Name options**: generate 2-3 name suggestions from what the user said.
  If a name already exists (from list), avoid it and note the conflict.
- **CPU options**: max 4 items: 0.2, 0.5, 1, 2 cores.
- **Memory options**: max 4 items: 0.5, 1, 2, 4 GB.
- **Replicas options**: max 4 items: 1, 2, 3, 5.
- For all resource options, mark current value with "(current)".
  User can type other valid values via "Type something".
- **App picker** (for get/update/delete/action): list app names from
  `sealos-applaunchpad.mjs list` as options, up to 4. If more than 4, show most recent ones.

## Field Generation Rules

- **Name**: derive from user's request (e.g., "deploy redis" → "redis"). Do not scan the local filesystem for project directory names.
- **Name constraint**: `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`, max 63 chars

## GPU Note

Only mention GPU in the customize flow if the user explicitly requests it or if
the project context indicates GPU workloads (ML, AI, inference, training).

GPU fields:
- `vendor`: GPU vendor, default "nvidia"
- `type`: required — GPU model (A100, V100, T4, etc.)
- `amount`: number of GPUs, default 1

## HPA Note

Default to fixed replicas. Offer HPA only in the customize flow or when the
user says "auto-scale", "elastic", "scale based on CPU/memory".

HPA fields:
- `target`: metric to scale on (cpu, memory, gpu)
- `value`: target utilization percentage
- `minReplicas`: minimum number of replicas
- `maxReplicas`: maximum number of replicas

## Create API Field Reference

See `api-reference.md` for the full field reference (Create and Update constraints).
