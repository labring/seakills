# Sealos Devbox — Claude Code Skill

Manage cloud development environments on [Sealos](https://sealos.io) using natural language. Create, scale, and manage devboxes with SSH access, port forwarding, releases, and deployments — without leaving your terminal.

## Quick Start

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- A [Sealos](https://sealos.io) account (free tier available)

### Install

Copy the `sealos-devbox` skill into your project's `.claude/skills/` directory. Claude Code auto-detects it.

### Usage

Ask Claude Code in natural language, or run `/sealos-devbox`:

```
> Create a Node.js devbox for my project
> Set up a cloud development environment
> Show my devboxes
> Scale my-app-node to 4 cores
> Delete the test devbox
> Pause the staging devbox
> Get SSH connection info for my-api
> Create a release for my-app
> Deploy v1.0.0 to production
> Show CPU/memory metrics for my-devbox
```

## Authentication

On first use, Claude opens your browser for **OAuth2 login** — no manual kubeconfig download needed. The flow:

1. Claude runs the login script, which opens your browser to the Sealos authorization page
2. You approve the request in your browser
3. Credentials are saved automatically to `~/.sealos/kubeconfig`
4. The API URL is auto-derived from `~/.sealos/auth.json`

Subsequent sessions reuse saved credentials until they expire.

## Features

- **Browser-based auth** — OAuth2 device grant, no manual kubeconfig setup
- **Smart defaults** — detects your tech stack and recommends a runtime, resources, and ports
- **Full lifecycle** — create, list, inspect, update, delete, start, pause, shutdown, restart
- **SSH integration** — auto-saves SSH keys, offers to write SSH config, supports VS Code Remote
- **Port management** — add, remove, and toggle public access for ports
- **Release & deploy** — create versioned releases and deploy to AppLaunchpad
- **Resource monitoring** — view CPU and memory usage metrics over time
- **Safe deletes** — requires explicit name confirmation before destroying anything
