# Dockerfile Skill

A Claude Code skill that generates production-ready Dockerfiles with automatic build validation.

## Install

```bash
curl -fsSL https://seakills.gzg.sealos.run/install.sh | bash
```

## Usage

```bash
/dockerfile                    # Analyze current directory
/dockerfile <github-url>       # Clone and analyze GitHub repo
/dockerfile <path>             # Analyze specific path
```

## Features

- Multi-stage Docker builds with best practices
- Workspace/monorepo support (pnpm, Turborepo, npm)
- Database migration detection and handling
- Build optimization (skip CI tasks, memory management)
- Runtime validation before declaring success
- 35+ error patterns with automatic fixes

## Structure

```
dockerfile-skill/
├── SKILL.md              # Skill entry point
├── modules/              # Analyze → Generate → Build workflow
├── templates/            # Dockerfile templates by tech stack
└── knowledge/            # Best practices, error patterns
```

## License

MIT
