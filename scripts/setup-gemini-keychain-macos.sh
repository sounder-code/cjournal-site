#!/usr/bin/env bash
set -euo pipefail

SERVICE="${KEYCHAIN_SERVICE:-cjournal.gemini.api}"
ACCOUNT="${KEYCHAIN_ACCOUNT:-default}"
KEY="${1:-}"

if [[ -z "${KEY}" ]]; then
  read -r -s -p "Enter GEMINI_API_KEY: " KEY
  echo
fi

if [[ -z "${KEY}" ]]; then
  echo "Empty key. abort."
  exit 1
fi

security add-generic-password -U -a "${ACCOUNT}" -s "${SERVICE}" -w "${KEY}" >/dev/null
echo "Saved key to macOS Keychain (service=${SERVICE}, account=${ACCOUNT})"
