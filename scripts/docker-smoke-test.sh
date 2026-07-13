#!/bin/sh
set -eu

base_url="${1:-http://127.0.0.1:8080}"

check_status() {
  path="$1"
  expected="$2"
  actual="$(curl -sS -o /dev/null -w '%{http_code}' "${base_url}${path}")"
  if [ "$actual" != "$expected" ]; then
    echo "FAIL ${path}: expected ${expected}, got ${actual}" >&2
    exit 1
  fi
  echo "OK   ${path} (${actual})"
}

check_status "/healthz" "200"
check_status "/" "200"
check_status "/robots.txt" "200"
check_status "/calculators/deposit-interest/" "200"
check_status "/posts/removed/" "410"
check_status "/this-page-must-not-exist/" "404"

echo "Docker smoke test passed: ${base_url}"

