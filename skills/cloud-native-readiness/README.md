# cloud-native-readiness

A Claude Code skill that assesses whether a project is ready for cloud-native deployment (Docker/Kubernetes).

## What it does

1. **Assess** — Evaluates 6 cloud-native dimensions (statelessness, config, scalability, startup/shutdown, observability, service boundaries) and produces a score (0-12)
2. **Detect** — Checks for existing Docker/K8s artifacts (Dockerfile, docker-compose, Helm charts, CI/CD pipelines)
3. **Route** — Decides next action: report existing setup, invoke `dockerfile-skill`, or recommend refactoring

## Workflow

```
/cloud-native-readiness
  |
  +-- Score >= 7, artifacts exist     --> Report existing setup
  +-- Score >= 7, no artifacts        --> Invoke dockerfile-skill
  +-- Score 4-6                       --> Report concerns, ask user
  +-- Score 0-3                       --> Report blockers, stop
```

## Installation

```bash
# Clone to skills directory
curl -fsSL https://seakills.gzg.sealos.run/install.sh | bash
```

## Usage

```
/cloud-native-readiness              # Assess current directory
/cloud-native-readiness <path>       # Assess specific path
/cloud-native-readiness <github-url> # Clone and assess
```

## Companion Skills

- [dockerfile-skill](https://github.com/zjy365/seakills) — Generates production-ready Dockerfiles (invoked automatically when needed)

## Structure

```
cloud-native-readiness/
├── SKILL.md                  # Main skill definition
├── README.md                 # This file
├── modules/
│   ├── assess.md             # Phase 1: Cloud-native assessment
│   ├── detect.md             # Phase 2: Existing artifact detection
│   └── route.md              # Phase 3: Decision routing
├── knowledge/
│   ├── criteria.md           # Scoring rubrics for each dimension
│   └── anti-patterns.md      # Common cloud-native anti-patterns
└── examples/
    └── sample-report.md      # Example readiness report
```

## Scoring Dimensions

| Dimension | What it checks | Max Score |
|-----------|---------------|-----------|
| Statelessness | External DB/cache/storage, no local file state | 2 |
| Config Externalization | Env vars, no hardcoded secrets, .env.example | 2 |
| Horizontal Scalability | Stateless requests, distributed queues, no file locks | 2 |
| Startup/Shutdown | SIGTERM handling, health checks, fast startup | 2 |
| Observability | Structured logging, error tracking, metrics | 2 |
| Service Boundaries | Clear separation, independent deployment | 2 |

**Total: 12 points**

| Score | Rating | Action |
|-------|--------|--------|
| 10-12 | Excellent | Proceed to containerize |
| 7-9 | Good | Proceed with minor adjustments |
| 4-6 | Fair | Address concerns first |
| 0-3 | Poor | Significant rework needed |
