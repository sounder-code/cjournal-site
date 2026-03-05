#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "GEMINI_API_KEY is required"
  exit 1
fi

if [[ -z "${FLUX_LOCAL_API_URL:-}" ]]; then
  export FLUX_LOCAL_API_URL="http://127.0.0.1:7862/gradio_api/call/generate"
fi

export ARTICLE_PROVIDER="${ARTICLE_PROVIDER:-gemini}"
export ALLOW_FALLBACK="false"
export ARTICLE_COUNT="${ARTICLE_COUNT:-1}"
export ARTICLE_PARALLELISM="${ARTICLE_PARALLELISM:-2}"
export ARTICLE_MAX_ATTEMPTS="${ARTICLE_MAX_ATTEMPTS:-2}"
export GEMINI_TIMEOUT_MS="${GEMINI_TIMEOUT_MS:-60000}"
export TITLE_SIMILARITY_THRESHOLD="${TITLE_SIMILARITY_THRESHOLD:-0.7}"
export MIN_WORD_COUNT="${MIN_WORD_COUNT:-900}"
export KEYWORD_POOL_MULTIPLIER="${KEYWORD_POOL_MULTIPLIER:-4}"

export IMAGE_PROVIDER="flux-local"
export RAW_PROMPT_ONLY="true"
export FLUX_LOCAL_STEPS="${FLUX_LOCAL_STEPS:-8}"
export FLUX_LOCAL_CFG="${FLUX_LOCAL_CFG:-2.2}"
export TEXT_DETECT_ENABLED="false"
export FLUX_LOCAL_TEXT_FREE_RETRIES="${FLUX_LOCAL_TEXT_FREE_RETRIES:-1}"
export FLUX_LOCAL_NEGATIVE_PROMPT="${FLUX_LOCAL_NEGATIVE_PROMPT:-low quality, blurry, artifacts}"
export IMAGES_PER_POST="${IMAGES_PER_POST:-2}"
export IMAGE_PARALLELISM="${IMAGE_PARALLELISM:-2}"
export IMAGE_TIMEOUT_MS="${IMAGE_TIMEOUT_MS:-30000}"

echo "[1/7] generate keywords"
npm run gen:keywords

echo "[2/7] generate articles"
npm run gen:articles

echo "[3/7] quality gate"
MIN_KEPT_COUNT="${MIN_KEPT_COUNT:-1}" npm run quality

echo "[4/7] generate post images (1024x768)"
npm run gen:post-images

echo "[5/7] validate images"
MIN_IMAGES_PER_POST="${IMAGES_PER_POST}" MAX_IMAGES_PER_POST="${IMAGES_PER_POST}" npm run check:images

echo "[6/7] build index"
npm run build:index

echo "[7/7] commit and push"
if [[ -z "$(git status --porcelain src/content/posts src/content/keywords/today.json src/content/posts-index.json public/assets/posts logs)" ]]; then
  echo "No content changes to commit"
  exit 0
fi

git config user.name "content-bot"
git config user.email "content-bot@users.noreply.github.com"
git add src/content/posts src/content/keywords/today.json src/content/posts-index.json public/assets/posts logs
git commit -m "chore(content): local generate and publish $(date '+%Y-%m-%d %H:%M')"
git push origin main

echo "Done"
