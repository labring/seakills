#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
plugin_root="$repo_root/plugins/sealos"

rm -rf "$plugin_root/skills"
mkdir -p "$plugin_root/skills"

for skill_dir in "$repo_root"/skills/*; do
  if [[ -f "$skill_dir/SKILL.md" ]]; then
    rsync -a "$skill_dir/" "$plugin_root/skills/$(basename "$skill_dir")/"
  fi
done
