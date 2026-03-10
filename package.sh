#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Read VERSION from install.sh
VERSION=$(grep '^VERSION=' install.sh | head -1 | cut -d'"' -f2)
if [ -z "$VERSION" ]; then
  echo "ERROR: Could not read VERSION from install.sh"
  exit 1
fi
echo "Version: $VERSION"

# Export for CI (GitHub Actions can pick up via $GITHUB_ENV)
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "VERSION=$VERSION" >> "$GITHUB_ENV"
fi

OUT_DIR="site/public/skills"
mkdir -p "$OUT_DIR"

# Package skills/ into tar.gz
echo "Packaging skills/..."
tar -czf "$OUT_DIR/seakills-v${VERSION}.tar.gz" -C . skills/
cp "$OUT_DIR/seakills-v${VERSION}.tar.gz" "$OUT_DIR/seakills-latest.tar.gz"

# Write latest version file
echo "$VERSION" > "$OUT_DIR/latest-version.txt"

# Copy install.sh to site/public/
cp install.sh site/public/install.sh

echo ""
echo "Package complete:"
ls -lh "$OUT_DIR/"
echo ""
echo "site/public/install.sh copied"
