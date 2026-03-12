# Sealos Template — AI Agent Skill

Browse and deploy applications from the [Sealos](https://sealos.io) template catalog using natural language. Deploy AI tools, databases, web apps, and more — without leaving your terminal.

## Quick Start

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Gemini CLI](https://github.com/google-gemini/gemini-cli), or [Codex](https://github.com/openai/codex) installed
- Node.js (bundled with Claude Code; required for scripts)

### Install

Use the Seakills installer:

```bash
curl -fsSL https://seakills.com/install.sh | bash
```

Or copy the `sealos-template` skill into your agent's skills directory manually.

### Usage

Ask your AI agent in natural language, or run `/sealos-template`:

```
> What apps can I deploy on Sealos?
> Show me AI templates
> Deploy Perplexica
> I need a search engine
> Self-host NocoDB on Sealos
> Deploy this YAML file
```

The agent walks you through browsing, configuration, and deployment interactively.

## Features

- **Template catalog** — browse available applications by category (AI, database, tools, etc.)
- **Smart browsing** — templates sorted by popularity, grouped by category
- **Guided deployment** — collects required args interactively, shows resource requirements
- **Raw YAML deploy** — deploy custom Sealos Template CRDs from project files with dry-run preview
- **Multi-language** — supports English and Chinese (`--language=zh`)
- **Multi-region** — supports multiple Sealos Cloud regions (gzg, bja, hzh)

## Authentication

Browsing templates is public — no authentication needed. First-time users can explore the full catalog without logging in.

On first deploy, the agent starts an OAuth2 device grant login flow via `sealos-auth.mjs`:
1. Opens your browser for authorization
2. Polls until you approve (up to 10 minutes)
3. Exchanges the token for a kubeconfig
4. Saves credentials to `~/.sealos/kubeconfig` and `~/.sealos/auth.json`

No manual kubeconfig download required. The API URL is auto-derived from your selected region.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/sealos-auth.mjs` | OAuth2 Device Grant login, auth check, auth info |
| `scripts/sealos-template.mjs` | Template list, get details, create instance, deploy raw YAML |

Both scripts are zero-dependency (Node.js built-ins only) and output JSON to stdout.

## Reference Files

| File | Purpose |
|------|---------|
| `references/api-reference.md` | API endpoints, instance name constraints, error formats |
| `references/defaults.md` | Display rules, arg collection rules, secret masking |
| `references/openapi.json` | Complete OpenAPI spec for edge cases |
