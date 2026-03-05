# Sealos Deploy v1.0.2

One command to deploy any GitHub project to Sealos Cloud.

Works with Claude Code, Gemini CLI, Codex — any AI coding assistant with file and terminal access.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/zjy365/sealos-deploy/main/install.sh | bash
```

## Use

```
/sealos-deploy                                       # deploy current project
/sealos-deploy https://github.com/labring-sigs/kite  # deploy remote repo
```

That's it. The skill handles everything:

```
[preflight] ✓ Docker  ✓ Docker Hub  ✓ Sealos Cloud
[assess]    Go + net/http → suitable for deployment
[detect]    Found ghcr.io/zxh326/kite:v0.4.0 (amd64) → skip build
[template]  Generated template/kite/index.yaml
```

## What Happens

```
Your project
  │
  ▼
Assess ─── not deployable? → stop with reason
  │
  ▼
Detect existing image ─── found? → skip build ──┐
  │ not found                                    │
  ▼                                              │
Generate Dockerfile (if missing)                 │
  │                                              │
  ▼                                              │
Build & Push to Docker Hub                       │
  │                                              │
  ◄──────────────────────────────────────────────┘
  │
  ▼
Generate Sealos Template
  │
  ▼
Done ✓
```

## First Time Setup

On first use, the skill checks your environment and guides you through setup:

1. **Docker** — needed to build images locally
2. **Docker Hub** — where built images are pushed (`docker login`)
3. **Sealos Cloud** — your deployment target (just provide a token)

All setup is interactive. The skill asks for what it needs, when it needs it.

## Project Structure

```
sealos-deploy/
├── install.sh                          # One-line installer
├── README.md
└── skills/
    ├── sealos-deploy/                  # Main skill — /sealos-deploy
    │   ├── SKILL.md                    # Entry point & phase overview
    │   ├── modules/
    │   │   ├── preflight.md            # Docker + auth checks
    │   │   └── pipeline.md             # Phase 1–5 pipeline
    │   └── scripts/
    │       └── sealos-auth.mjs         # Sealos Cloud auth helper
    │
    ├── dockerfile-skill/               # Internal — Dockerfile generation
    ├── cloud-native-readiness/         # Internal — readiness assessment
    └── docker-to-sealos/              # Internal — Sealos template conversion
```

## Requirements

**Required:**
- Docker (for building images)
- A Docker Hub account
- A Sealos Cloud account

**Optional (faster, but AI handles the same work if missing):**
- Node.js 18+
- Python 3.8+

## License

MIT
