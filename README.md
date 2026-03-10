# Seakills v1.0.5

One command to deploy any GitHub project to Sealos Cloud.

Works with **Claude Code**, **Gemini CLI**, **Codex** — any AI coding assistant with file and terminal access.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/zjy365/seakills/main/install.sh | bash
```

The installer automatically detects your installed AI tools and sets up skills for each one:

```
Installing Seakills v1.0.5...

Downloading...

Installing skills...
  ✓ sealos-deploy
  ✓ dockerfile-skill
  ✓ cloud-native-readiness
  ✓ docker-to-sealos

Linking to detected agents...
  ✓ Claude Code → ~/.claude/skills (symlinked)
  ✓ Gemini CLI → ~/.gemini/skills (symlinked)
  ✓ Codex → ~/.codex/skills (symlinked)

Seakills v1.0.5 ready.
```

**Supported tools:**

| Tool | Global Skills Dir | Detection |
|------|------------------|-----------|
| Claude Code | `~/.claude/skills/` | `~/.claude` exists |
| Gemini CLI | `~/.gemini/skills/` | `~/.gemini` exists |
| Codex | `~/.codex/skills/` | `~/.codex` or `$CODEX_HOME` exists |

Skills are installed once to `~/.agents/skills/` (canonical), then symlinked to each tool's directory. No duplication.

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
[template]  Generated deploy-out/template/kite/index.yaml
[deploy]    ✓ Deployed to Sealos Cloud
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
Deploy to Sealos Cloud
  │
  ▼
Done ✓
```

## First Time Setup

On first use, the skill checks your environment and guides you through setup:

1. **Docker** — needed to build images locally
2. **Docker Hub** — where built images are pushed (`docker login`)
3. **Sealos Cloud** — OAuth2 device grant flow (opens browser, no token copy-paste)

All setup is interactive. The skill asks for what it needs, when it needs it.

## Project Structure

```
seakills/
├── install.sh                          # Multi-agent installer
├── README.md
└── skills/
    ├── sealos-deploy/                  # Main skill — /sealos-deploy
    │   ├── SKILL.md                    # Entry point & phase overview
    │   ├── config.json                 # Skill constants (client_id, region)
    │   ├── modules/
    │   │   ├── preflight.md            # Docker + auth checks
    │   │   └── pipeline.md             # Phase 1–6 pipeline
    │   └── scripts/
    │       └── sealos-auth.mjs         # Sealos Cloud auth (OAuth2 device grant)
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
