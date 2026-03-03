#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   bash scripts/setup-gh-runner-macos.sh <repo> <registration_token>
# Example:
#   bash scripts/setup-gh-runner-macos.sh sounder-code/cjournal-site AABCC...

REPO="${1:-}"
TOKEN="${2:-}"
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner-cjournal}"
RUNNER_NAME="${RUNNER_NAME:-$(hostname)-cjournal}"
RUNNER_LABELS="${RUNNER_LABELS:-cjournal,flux-local,macos-arm64}"

if [[ -z "$REPO" || -z "$TOKEN" ]]; then
  echo "Usage: bash scripts/setup-gh-runner-macos.sh <repo> <registration_token>"
  exit 1
fi

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

if [[ ! -f "config.sh" ]]; then
  ARCHIVE_URL="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | awk -F '"' '/browser_download_url/ && /osx-arm64/ {print $4; exit}')"
  if [[ -z "$ARCHIVE_URL" ]]; then
    echo "Could not resolve latest macOS ARM64 runner archive URL."
    exit 1
  fi
  ARCHIVE_NAME="$(basename "$ARCHIVE_URL")"
  curl -fL -o "$ARCHIVE_NAME" "$ARCHIVE_URL"
  tar xzf "$ARCHIVE_NAME"
fi

if [[ ! -x "./bin/installdependencies.sh" ]]; then
  echo "Runner files are not valid in $RUNNER_DIR"
  exit 1
fi

./config.sh remove --unattended --token "$TOKEN" >/dev/null 2>&1 || true
./config.sh \
  --url "https://github.com/$REPO" \
  --token "$TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABELS" \
  --work "_work" \
  --unattended \
  --replace

OS_NAME="$(uname -s)"
if [[ "$OS_NAME" == "Darwin" ]]; then
  ./svc.sh install
  ./svc.sh start
  ./svc.sh status || true
else
  sudo ./svc.sh install
  sudo ./svc.sh start
  sudo ./svc.sh status || true
fi

echo "Runner installed and started."
echo "Repo: https://github.com/$REPO"
echo "Name: $RUNNER_NAME"
echo "Labels: $RUNNER_LABELS"
