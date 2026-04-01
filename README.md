# Seakills

Deploy projects to [Sealos Cloud](https://gzg.sealos.run) from your AI agent.

Seakills is a `skills.sh` skill pack centered on `/sealos-deploy`. It helps an agent inspect a project, prepare missing deployment artifacts, and ship it to Sealos Cloud.

## Quick Start

Install Seakills:

```bash
npx skills add labring/seakills
```

Then run:

```text
/sealos-deploy
```

Examples:

```text
/sealos-deploy
/sealos-deploy /path/to/project
/sealos-deploy https://github.com/labring-sigs/kite
```

## How Setup Works

You only need a `skills.sh` compatible AI agent and a project to deploy.

During the deploy flow, Seakills will:

- check whether tools such as Docker and `kubectl` are available
- guide the user through Sealos login when needed
- use or help prepare a container registry path such as Docker Hub or GHCR

For an actual deployment, you will still need a Sealos Cloud account and access to a container registry, but these do not need to be fully set up before the skill starts.

## What `/sealos-deploy` Handles

On a typical deploy, the agent will:

1. Assess the project structure and runtime needs.
2. Reuse an existing image or build one when needed.
3. Generate a Sealos template.
4. Deploy and verify rollout.

Later runs can switch to an in-place update flow when an existing deployment is detected.

## Repository

[`skills/`](/Users/jingyang/zjy365/demo/github-pack/seakills/skills) contains `/sealos-deploy` and the supporting skills it uses during the deploy flow.

## License

MIT
