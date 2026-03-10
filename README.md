# Seakills

AI agent skills for Sealos Cloud — deploy any project, provision databases, object storage & more with one command.

Works with **Claude Code**, **Gemini CLI**, **Codex** — any AI coding assistant with file and terminal access.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/zjy365/seakills/main/install.sh | bash
```

The installer auto-detects your AI tools and sets up skills for each one.

**Supported agents:**

| Agent | Skills Dir | Detection |
|-------|-----------|-----------|
| Claude Code | `~/.claude/skills/` | `~/.claude` exists |
| Gemini CLI | `~/.gemini/skills/` | `~/.gemini` exists |
| Codex | `~/.codex/skills/` | `~/.codex` or `$CODEX_HOME` exists |

Skills are installed once to `~/.agents/skills/` (canonical), then symlinked to each agent. No duplication.

## Skills

### `/sealos-deploy` — Deploy any project

```
/sealos-deploy                                       # deploy current project
/sealos-deploy https://github.com/labring-sigs/kite  # deploy remote repo
```

The skill handles everything:

```
[preflight] ✓ Docker  ✓ Docker Hub  ✓ Sealos Cloud
[assess]    Go + net/http → suitable for deployment
[detect]    Found ghcr.io/zxh326/kite:v0.4.0 (amd64) → skip build
[template]  Generated deploy-out/template/kite/index.yaml
[deploy]    ✓ Deployed to Sealos Cloud
```

**Pipeline:**

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

**First time setup:** On first use, the skill checks and guides you through Docker, Docker Hub login, and Sealos Cloud OAuth — all interactive, no manual token copy-paste.

### Coming Soon

| Skill | Description |
|-------|-------------|
| `/sealos-database` | Provision and manage databases (PostgreSQL, MySQL, MongoDB, Redis) |
| `/sealos-objectstorage` | Create and manage object storage buckets |
| More | Every Sealos Cloud capability → an agent skill |

## Project Structure

```
seakills/
├── install.sh                          # Multi-agent installer
├── skills/
│   ├── sealos-deploy/                  # /sealos-deploy entry point
│   │   ├── SKILL.md                    # Phase overview & orchestration
│   │   ├── config.json                 # Regions, OAuth client config
│   │   ├── modules/                    # Preflight & pipeline logic
│   │   └── scripts/                    # Auth, image detection, build
│   ├── dockerfile-skill/               # Dockerfile generation & build-fix
│   ├── cloud-native-readiness/         # Readiness assessment (0-12 score)
│   └── docker-to-sealos/              # Docker Compose → Sealos template
└── site/                               # Landing page (seakills.run)
```

## Requirements

- Docker + Docker Hub account (for building & pushing images)
- [Sealos Cloud](https://sealos.run) account

## License

MIT
