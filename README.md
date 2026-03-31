# Seakills

Deploy projects to [Sealos Cloud](https://gzg.sealos.run) from your AI agent.

Seakills is a set of reusable skills for the `skills.sh` ecosystem. It helps an agent understand your project, prepare it for deployment, and ship it to Sealos Cloud with minimal manual setup.

## What You Can Do

With Seakills installed, your agent can:

- Deploy the current project to Sealos Cloud with `/sealos-deploy`
- Deploy a GitHub repository directly from its URL
- Check whether a project is cloud-ready before deployment
- Generate a production-ready Dockerfile for projects that do not have one
- Convert Docker Compose setups into Sealos-compatible templates

In practice, this means less time wiring infrastructure by hand and more time shipping working apps.

## Why It Is Useful

Seakills turns deployment into an agent workflow instead of a manual checklist.

Instead of doing this yourself:

- inspect the repo
- decide whether it is container-ready
- write or fix a Dockerfile
- build and push an image
- convert config into a Sealos template
- deploy and verify rollout

your agent can do it for you through one guided skill flow.

## Quick Start

Install the skills:

```bash
npx skills add labring/seakills
```

Open your project in your AI agent, then run:

```text
/sealos-deploy
```

That is the fastest path from local code to a running app on Sealos Cloud.

## Main Skills

### `/sealos-deploy`

Deploy a local project, a path, or a GitHub repository to Sealos Cloud.

```text
/sealos-deploy
/sealos-deploy /path/to/project
/sealos-deploy https://github.com/labring-sigs/kite
```

What it handles for you:

- project assessment
- image detection when an existing image already exists
- Dockerfile generation when needed
- image build and push
- Sealos template generation
- deployment and rollout verification

### `/cloud-native-readiness`

Check whether a project is ready for cloud-native deployment.

```text
/cloud-native-readiness
/cloud-native-readiness /path/to/project
/cloud-native-readiness https://github.com/example/repo
```

Use it when you want a quick answer to: "Can this app be deployed cleanly?"

### `/dockerfile`

Generate or improve a production-ready Dockerfile.

```text
/dockerfile
/dockerfile /path/to/project
/dockerfile https://github.com/example/repo
```

Useful when a repo is missing container packaging or the current Dockerfile is not production-ready.

### `/docker-to-sealos`

Convert Docker Compose or installation docs into a Sealos-compatible template.

Use it when you already have a Compose-based app and want to move it into Sealos cleanly.

## What The Deploy Flow Looks Like

On a typical first deploy, the agent will:

1. Check prerequisites such as Docker and account state.
2. Assess the project structure and runtime needs.
3. Reuse an existing image if possible, or build one if needed.
4. Generate the Sealos deployment template.
5. Deploy and verify the application.

Example output:

```text
[preflight] ✓ Docker  ✓ git  ✓ Sealos Cloud
[assess]    Go + net/http -> score 10/12, suitable
[detect]    Found ghcr.io/zxh326/kite:v0.4.0 (amd64) -> skip build
[template]  Generated Sealos template
[deploy]    ✓ Deployed to Sealos Cloud
```

For later updates, running `/sealos-deploy` again can trigger an in-place update flow instead of a full redeploy.

## What You Need

Before first use, make sure you have:

- Docker installed and running
- A Sealos Cloud account
- A container registry account such as Docker Hub or GHCR access

Optional but helpful:

- Node.js 18+
- Python 3.8+
- `kubectl` for in-place update workflows

## Best Fit

Seakills is especially useful if you want to:

- deploy prototypes without hand-writing cloud config
- let an AI assistant package and ship repos for you
- evaluate whether a project is ready for containerized deployment
- standardize deployment workflows across different coding agents
- move from Docker Compose toward a Sealos-native deployment path

## Repository Structure

```text
skills/
  sealos-deploy/
  cloud-native-readiness/
  dockerfile-skill/
  docker-to-sealos/
site/
```

- `skills/` contains the actual agent skills
- `site/` contains the landing page and documentation site

## License

MIT
