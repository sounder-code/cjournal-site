#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Ensure common CLI paths are available under launchd.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

SECRETS_FILE="${SECRETS_FILE:-.env.local}"
if [[ -f "${SECRETS_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${SECRETS_FILE}"
  set +a
fi

LOCK_DIR="/tmp/cjournal-local-generate.lock"
if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  echo "Another local generation run is already in progress. skip."
  exit 0
fi
trap 'rmdir "${LOCK_DIR}" 2>/dev/null || true' EXIT

KEYCHAIN_SERVICE="${KEYCHAIN_SERVICE:-cjournal.gemini.api}"
KEYCHAIN_ACCOUNT="${KEYCHAIN_ACCOUNT:-default}"

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  GEMINI_API_KEY="$(security find-generic-password -a "${KEYCHAIN_ACCOUNT}" -s "${KEYCHAIN_SERVICE}" -w 2>/dev/null || true)"
  export GEMINI_API_KEY
fi

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "GEMINI_API_KEY is required (env or macOS Keychain: service=${KEYCHAIN_SERVICE}, account=${KEYCHAIN_ACCOUNT})"
  exit 1
fi

if [[ -z "${FLUX_LOCAL_API_URL:-}" ]]; then
  export FLUX_LOCAL_API_URL="http://127.0.0.1:7862/gradio_api/call/generate"
fi

export ARTICLE_PROVIDER="${ARTICLE_PROVIDER:-gemini}"
export ALLOW_FALLBACK="false"
export ARTICLE_COUNT="${ARTICLE_COUNT:-10}"
export ARTICLE_PARALLELISM="${ARTICLE_PARALLELISM:-2}"
export ARTICLE_MAX_ATTEMPTS="${ARTICLE_MAX_ATTEMPTS:-2}"
export GEMINI_TIMEOUT_MS="${GEMINI_TIMEOUT_MS:-60000}"
export TITLE_SIMILARITY_THRESHOLD="${TITLE_SIMILARITY_THRESHOLD:-0.7}"
export MIN_WORD_COUNT="${MIN_WORD_COUNT:-900}"
export KEYWORD_POOL_MULTIPLIER="${KEYWORD_POOL_MULTIPLIER:-6}"
export FALLBACK_MIN_KEYWORDS="${FALLBACK_MIN_KEYWORDS:-12}"
export MAX_SELECTED_KEYWORDS="${MAX_SELECTED_KEYWORDS:-16}"
export DOMAIN_TOPIC_MODE="${DOMAIN_TOPIC_MODE:-on}"
export TREND_TOPIC_MODE="${TREND_TOPIC_MODE:-on}"
export RECENT_DUP_DAYS="${RECENT_DUP_DAYS:-7}"

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

RUN_TS="$(date '+%Y-%m-%d %H:%M:%S')"
echo "[$RUN_TS] local pipeline start"

echo "[1/4] generate keywords"
npm run gen:keywords

echo "[2/4] generate articles"
npm run gen:articles

echo "[3/4] quality gate"
MIN_KEPT_COUNT="${MIN_KEPT_COUNT:-10}" npm run quality

echo "[4/4] per-article publish (images -> validate -> index -> commit/push)"

git config user.name "content-bot"
git config user.email "content-bot@users.noreply.github.com"

SLUG_FILE="/tmp/cjournal_publish_slugs_runtime.txt"
node - <<'NODE' > "${SLUG_FILE}"
const fs = require('fs');
const path = require('path');
const runPath = path.join(process.cwd(), 'logs/run-generated-posts.json');
if (!fs.existsSync(runPath)) process.exit(0);
const parsed = JSON.parse(fs.readFileSync(runPath, 'utf8'));
const files = Array.isArray(parsed.files) ? parsed.files : [];
const seen = new Set();
for (const file of files) {
  const full = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
  if (!fs.existsSync(full)) continue;
  const raw = fs.readFileSync(full, 'utf8');
  const m = raw.match(/^slug:\s*(.+)$/m);
  if (!m) continue;
  const slug = String(m[1]).trim().replace(/^['"]+|['"]+$/g, '');
  if (!slug || seen.has(slug)) continue;
  seen.add(slug);
  process.stdout.write(`${slug}\n`);
}
NODE

PUBLISH_SLUGS=()
while IFS= read -r __slug; do
  [[ -n "${__slug}" ]] || continue
  PUBLISH_SLUGS+=("${__slug}")
done < "${SLUG_FILE}"

if [[ "${#PUBLISH_SLUGS[@]}" -eq 0 ]]; then
  echo "No publish targets after quality gate"
  exit 1
fi

SUCCESS=0
FAIL=0

for SLUG in "${PUBLISH_SLUGS[@]}"; do
  echo "[publish] ${SLUG}: generate images"
  if ! TARGET_POST_SLUGS="${SLUG}" npm run gen:post-images; then
    echo "[publish] ${SLUG}: image generation failed, skip"
    FAIL=$((FAIL + 1))
    continue
  fi

  echo "[publish] ${SLUG}: validate images"
  if ! TARGET_POST_SLUGS="${SLUG}" MIN_IMAGES_PER_POST="${IMAGES_PER_POST}" MAX_IMAGES_PER_POST="${IMAGES_PER_POST}" npm run check:images; then
    echo "[publish] ${SLUG}: image validation failed, skip"
    FAIL=$((FAIL + 1))
    continue
  fi

  # Ensure last published post is ordered first on homepage.
  NOW_KST_ISO="$(TZ=Asia/Seoul date '+%Y-%m-%dT%H:%M:%S%z' | sed 's/\(..\)$/:\1/')"
  perl -i -pe "s/^updatedAt:\\s*.*\$/updatedAt: '${NOW_KST_ISO}'/" "src/content/posts/${SLUG}.md"
  perl -i -pe "s/^publishedAt:\\s*'\\d{4}-\\d{2}-\\d{2}'\$/publishedAt: '${NOW_KST_ISO}'/" "src/content/posts/${SLUG}.md"

  echo "[publish] ${SLUG}: wash content"
  TARGET_POST_SLUGS="${SLUG}" npm run wash:posts

  echo "[publish] ${SLUG}: build index"
  npm run build:index

  git add "src/content/posts/${SLUG}.md" "public/assets/posts/${SLUG}-1.png" "public/assets/posts/${SLUG}-2.png" src/content/posts-index.json src/content/keywords/today.json
  if git diff --cached --quiet; then
    echo "[publish] ${SLUG}: no changes to commit"
    continue
  fi

  git commit -m "chore(content): publish ${SLUG} $(date '+%Y-%m-%d %H:%M')"
  git push origin main
  SUCCESS=$((SUCCESS + 1))
  echo "[publish] ${SLUG}: done"
done

echo "Done (published=${SUCCESS}, failed=${FAIL}, total=${#PUBLISH_SLUGS[@]})"
if [[ "${FAIL}" -gt 0 ]]; then
  exit 1
fi
