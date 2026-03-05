#!/usr/bin/env bash
set -euo pipefail

VERSION="1.0.3"
REPO="zjy365/sealos-deploy"
SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
VERSION_FILE="$SKILLS_DIR/.sealos-deploy-version"

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
      echo "sealos-deploy $(cat "$VERSION_FILE") (installed)"
    else
      echo "sealos-deploy not installed"
    fi
    echo "installer $VERSION"
    exit 0
    ;;
  --help|-h)
    echo "Sealos Deploy Installer v${VERSION}"
    echo ""
    echo "Usage:"
    echo "  install.sh              Install or update skills"
    echo "  install.sh --version    Show installed version"
    echo "  install.sh --help       Show this help"
    echo ""
    echo "Update:"
    echo "  curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | bash"
    exit 0
    ;;
esac

# --- Detect install vs update ---
if [ -f "$VERSION_FILE" ]; then
  OLD_VERSION=$(cat "$VERSION_FILE")
  echo "Updating Sealos Deploy: ${OLD_VERSION} → ${VERSION}"
else
  echo "Installing Sealos Deploy v${VERSION}..."
fi
echo ""

# --- Download repo ---
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if command -v git &>/dev/null; then
  git clone --depth 1 "https://github.com/${REPO}.git" "$tmp/repo" 2>/dev/null
else
  curl -fsSL "https://github.com/${REPO}/archive/main.tar.gz" | tar -xz -C "$tmp"
  mv "$tmp"/sealos-deploy-main "$tmp/repo"
fi

# --- Install skills ---
mkdir -p "$SKILLS_DIR"

for skill in "${SKILLS[@]}"; do
  src="$tmp/repo/skills/$skill"
  dest="$SKILLS_DIR/$skill"

  if [ ! -d "$src" ]; then
    echo "  ✗ $skill — not found, skipping"
    continue
  fi

  rm -rf "$dest"
  cp -R "$src" "$dest"
  echo "  ✓ $skill"
done

# --- Post-install ---
chmod +x "$SKILLS_DIR/sealos-deploy/scripts/"*.mjs 2>/dev/null || true
echo "$VERSION" > "$VERSION_FILE"

echo ""
echo "Sealos Deploy v${VERSION} ready."
echo ""
echo "Usage — in Claude Code:"
echo "  /sealos-deploy                     # deploy current project"
echo "  /sealos-deploy <github-url>        # deploy remote repo"
echo ""
