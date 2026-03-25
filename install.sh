#!/usr/bin/env bash
set -euo pipefail

VERSION="1.1.2"
REPO="zjy365/seakills"
SITE_URL="https://seakills.gzg.sealos.run"

# Canonical install location — single source of truth
CANONICAL_DIR="$HOME/.agents/skills"
VERSION_FILE="$CANONICAL_DIR/sealos-deploy/.version"

SKILLS=(
  "sealos-deploy"
  "dockerfile-skill"
  "cloud-native-readiness"
  "docker-to-sealos"
)

# --- Flags ---
case "${1:-}" in
  --version|-v)
    if [ -f "$VERSION_FILE" ]; then
      echo "seakills $(cat "$VERSION_FILE") (installed)"
    else
      echo "seakills not installed"
    fi
    echo "installer $VERSION"
    exit 0
    ;;
  --help|-h)
    cat <<EOF
Seakills Installer v${VERSION}

Usage:
  install.sh              Install or update skills
  install.sh --version    Show installed version
  install.sh --help       Show this help

Install:
  curl -fsSL ${SITE_URL}/install.sh | bash

Supports: Claude Code, Gemini CLI, Codex, and other .agents-compatible tools.
EOF
    exit 0
    ;;
esac

# --- Detect installed AI agents ---
# Each entry: "display_name|skills_dir"
AGENTS=()

# Claude Code: ~/.claude/skills
CLAUDE_HOME="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
if [ -d "$CLAUDE_HOME" ]; then
  AGENTS+=("Claude Code|$CLAUDE_HOME/skills")
fi

# Gemini CLI: ~/.gemini/skills
if [ -d "$HOME/.gemini" ]; then
  AGENTS+=("Gemini CLI|$HOME/.gemini/skills")
fi

# Codex: ~/.codex/skills (or $CODEX_HOME/skills)
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
if [ -d "$CODEX_HOME" ]; then
  AGENTS+=("Codex|$CODEX_HOME/skills")
fi

# --- Detect install vs update ---
if [ -f "$VERSION_FILE" ]; then
  OLD_VERSION=$(cat "$VERSION_FILE")
  echo "Updating Seakills: ${OLD_VERSION} → ${VERSION}"
else
  echo "Installing Seakills v${VERSION}..."
fi
echo ""

# --- Install kubectl if missing ---
AGENTS_BIN="$HOME/.agents/bin"

install_kubectl() {
  if command -v kubectl &>/dev/null; then
    echo "kubectl: $(kubectl version --client --short 2>/dev/null || kubectl version --client 2>/dev/null | head -1) (already installed)"
    return 0
  fi

  echo "Installing kubectl..."

  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "  ✗ Unsupported architecture: $arch"; return 1 ;;
  esac

  # Get latest stable version
  local kube_version
  kube_version="$(curl -fsSL --connect-timeout 10 https://dl.k8s.io/release/stable.txt 2>/dev/null)" || kube_version="v1.32.0"

  mkdir -p "$AGENTS_BIN"
  local url="https://dl.k8s.io/release/${kube_version}/bin/${os}/${arch}/kubectl"

  if curl -fsSL --connect-timeout 15 "$url" -o "$AGENTS_BIN/kubectl" 2>/dev/null; then
    chmod +x "$AGENTS_BIN/kubectl"
    echo "  ✓ kubectl ${kube_version} → $AGENTS_BIN/kubectl"
  else
    echo "  ✗ kubectl download failed (deploy will still work, but updates require full re-deploy)"
    return 1
  fi

  # Silently add ~/.agents/bin to PATH in shell profiles (idempotent)
  local path_line="export PATH=\"\$HOME/.agents/bin:\$PATH\""
  local fish_line="fish_add_path -g \$HOME/.agents/bin"

  for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    if [ -f "$rc" ]; then
      grep -qF '.agents/bin' "$rc" 2>/dev/null || echo "$path_line" >> "$rc"
    fi
  done

  # Fish config
  local fish_conf="$HOME/.config/fish/config.fish"
  if [ -f "$fish_conf" ]; then
    grep -qF '.agents/bin' "$fish_conf" 2>/dev/null || echo "$fish_line" >> "$fish_conf"
  fi
}

install_kubectl || true
echo ""

# --- Download skills ---
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading..."
DOWNLOADED=false

# Try site tar (fast for users in China)
if curl -fsSL --connect-timeout 5 "${SITE_URL}/skills/seakills-latest.tar.gz" \
     -o "$tmp/skills.tar.gz" 2>/dev/null; then
  mkdir -p "$tmp/repo"
  tar -xzf "$tmp/skills.tar.gz" -C "$tmp/repo" 2>/dev/null && DOWNLOADED=true
fi

# Fallback: GitHub
if [ "$DOWNLOADED" = false ]; then
  echo "  Site unavailable, falling back to GitHub..."
  if command -v git &>/dev/null; then
    git clone --depth 1 --filter=blob:none --sparse \
      "https://github.com/${REPO}.git" "$tmp/repo" 2>/dev/null
    git -C "$tmp/repo" sparse-checkout set skills 2>/dev/null || true
  else
    curl -fsSL "https://github.com/${REPO}/archive/main.tar.gz" \
      | tar -xz -C "$tmp" "seakills-main/skills"
    mkdir -p "$tmp/repo"
    mv "$tmp"/seakills-main/skills "$tmp/repo/skills"
    rm -rf "$tmp"/seakills-main
  fi
fi
echo ""

# --- Step 1: Install to canonical location ~/.agents/skills/ ---
echo "Installing skills..."
mkdir -p "$CANONICAL_DIR"

for skill in "${SKILLS[@]}"; do
  src="$tmp/repo/skills/$skill"
  dest="$CANONICAL_DIR/$skill"

  if [ ! -d "$src" ]; then
    echo "  ✗ $skill — not found, skipping"
    continue
  fi

  rm -rf "$dest"
  cp -R "$src" "$dest"
  echo "  ✓ $skill"
done

# Post-install: make scripts executable
chmod +x "$CANONICAL_DIR/sealos-deploy/scripts/"*.mjs 2>/dev/null || true
echo "$VERSION" > "$VERSION_FILE"
echo ""

# --- Step 2: Link to each detected agent ---
if [ ${#AGENTS[@]} -eq 0 ]; then
  echo "No AI coding tools detected."
  echo "Skills installed to: $CANONICAL_DIR"
  echo "Manually symlink to your tool's skills directory if needed."
else
  echo "Linking to detected agents..."
  for entry in "${AGENTS[@]}"; do
    agent_name="${entry%%|*}"
    agent_dir="${entry##*|}"

    # Skip if agent dir is the canonical dir itself
    if [ "$agent_dir" = "$CANONICAL_DIR" ]; then
      continue
    fi

    mkdir -p "$agent_dir"

    agent_ok=true
    for skill in "${SKILLS[@]}"; do
      canonical_skill="$CANONICAL_DIR/$skill"
      target="$agent_dir/$skill"

      [ ! -d "$canonical_skill" ] && continue

      # Remove old copy/link
      rm -rf "$target"

      # Try symlink first, fallback to copy
      if ln -sfn "$canonical_skill" "$target" 2>/dev/null; then
        : # symlink created
      else
        cp -R "$canonical_skill" "$target"
      fi
    done

    if [ "$agent_ok" = true ]; then
      echo "  ✓ $agent_name → $agent_dir"
    fi
  done
fi

# --- Done ---
echo ""
echo "Seakills v${VERSION} ready."
echo ""
echo "Installed to: $CANONICAL_DIR (canonical)"
for entry in "${AGENTS[@]}"; do
  agent_name="${entry%%|*}"
  agent_dir="${entry##*|}"
  [ "$agent_dir" = "$CANONICAL_DIR" ] && continue
  echo "  → $agent_name: $agent_dir (symlinked)"
done
echo ""
echo "Usage:"
echo "  /sealos-deploy                     # deploy current project"
echo "  /sealos-deploy <github-url>        # deploy remote repo"
echo ""
