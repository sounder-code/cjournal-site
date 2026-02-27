#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PUBLIC_DIR="$ROOT_DIR/public"

mkdir -p "$PUBLIC_DIR"

copy_file() {
  local rel="$1"
  mkdir -p "$(dirname "$PUBLIC_DIR/$rel")"
  cp -f "$ROOT_DIR/$rel" "$PUBLIC_DIR/$rel"
}

copy_dir() {
  local rel="$1"
  rm -rf "$PUBLIC_DIR/$rel"
  mkdir -p "$(dirname "$PUBLIC_DIR/$rel")"
  cp -R "$ROOT_DIR/$rel" "$PUBLIC_DIR/$rel"
}

# Root-level JS/CSS/HTML used by legacy test pages.
copy_file "config.js"
copy_file "home.css"
copy_file "home.js"
copy_file "style.css"
copy_file "legal.css"
copy_file "app.js"
copy_file "lizardMatcher.js"
copy_file "lizardProfiles.js"
copy_file "lizardTunedDb.js"
copy_file "lizardTunedTypeDb.js"
copy_file "resultImageMap.js"
copy_file "about.html"
copy_file "privacy.html"
copy_file "terms.html"
copy_file "contact.html"

# Test entrypoints and page assets.
copy_dir "test"
copy_dir "lizard-face-match"

echo "[prepare] legacy static files synced into public/"
