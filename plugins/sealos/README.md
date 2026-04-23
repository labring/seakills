# Sealos Codex Plugin

This directory is the Codex plugin package for Sealos.

- Manifest: `.codex-plugin/plugin.json`
- Skills payload: `skills/`
- Marketplace entry: `../../.agents/plugins/marketplace.json`
- Plugin-level MCP/app auth wiring: `TODO`

To refresh the packaged skills after changing the source skill pack at the repo root, run:

```bash
./scripts/sync-codex-plugin.sh
```
