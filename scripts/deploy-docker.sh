#!/bin/sh
set -eu

compose_file="${CJOURNAL_COMPOSE_FILE:-compose.prod.yaml}"
port="${CJOURNAL_PORT:-80}"
health_url="${CJOURNAL_HEALTH_URL:-http://127.0.0.1:${port}}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker 명령을 찾을 수 없습니다." >&2
  exit 1
fi

echo "Deploying ${CJOURNAL_IMAGE:-ghcr.io/sounder-code/cjournal-site:main}"
docker compose -f "$compose_file" pull
docker compose -f "$compose_file" up -d --remove-orphans --wait --wait-timeout 60
sh scripts/docker-smoke-test.sh "$health_url"

echo "Deployment completed."

