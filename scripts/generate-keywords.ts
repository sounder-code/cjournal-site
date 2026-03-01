import fs from 'node:fs/promises';
import path from 'node:path';
import { isUnsafeTopic } from './policy';
import { readLines } from './utils';

const blacklistPath = path.join(process.cwd(), 'src/content/keywords/blacklist.txt');
const seedsPath = path.join(process.cwd(), 'src/content/keywords/seeds.txt');
const outPath = path.join(process.cwd(), 'src/content/keywords/today.json');
const rankCachePath = path.join(process.cwd(), 'logs/search-rank-cache.json');

const templates = [
  '{keyword} 뜻',
  '{keyword} 방법',
  '{keyword} 기준',
  '{keyword} 비교',
  '{keyword} 추천',
  '{keyword} 주의사항',
  '{keyword} 체크리스트',
  '{keyword} 요약',
  '{keyword} 실생활 영향'
];

const PERSON_OR_EVENT_PATTERNS = [
  /대통령|장관|국회의원|의원|대법원장|검사|판사|총리|대표|감독|선수|배우|가수|유튜버|인플루언서/i,
  /체포|구속|수사|재판|논란|폭로|사망|사고|추락|화재|참사|총격|살인/i
];

const LOW_VALUE_PATTERNS = [/^(속보|단독|뉴스|실시간|이슈)$/i];
const TOKEN_STOPWORDS = new Set([
  '오늘',
  '현재',
  '현장',
  '논란',
  '결정',
  '속보',
  '단독',
  '기자',
  '인터뷰',
  '발표',
  '후보',
  '감독',
  '대표',
  '선수'
]);

const CATEGORY_RULES: Array<{ category: string; patterns: RegExp[] }> = [
  { category: '생산성', patterns: [/시간|루틴|집중|목표|업무|정리|메일|회의|문서|메모/i] },
  { category: '디지털', patterns: [/보안|비밀번호|백업|브라우저|와이파이|스마트폰|노트북|키보드|사진|파일|앱/i] },
  { category: '생활관리', patterns: [/장보기|가계부|예산|구독|쇼핑|중고|청소|옷|주방|냉장고|재활용/i] },
  { category: '건강생활', patterns: [/수면|스트레스|운동|걷기|스트레칭|자세|눈 건강|목 건강/i] },
  { category: '교통/이동', patterns: [/교통|운전|전기차|기차|버스|지하철|항공|여행/i] },
  { category: '사회/이슈', patterns: [/선거|정책|공천|사건|사고|법안|공공|행정|국회/i] }
];

const CATEGORY_CAPS: Record<string, number> = {
  생산성: 7,
  디지털: 7,
  생활관리: 7,
  건강생활: 5,
  '교통/이동': 4,
  '사회/이슈': 2,
  기타: 30
};

function topicStem(keyword: string) {
  return keyword
    .toLowerCase()
    .replace(/(뜻|방법|기준|비교|추천|주의사항|체크리스트|요약|실생활 영향|가이드|정리|분석)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyCategory(keyword: string) {
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(keyword))) return rule.category;
  }
  return '기타';
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function cleanRankPhrase(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d+위\b/g, ' ')
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsefulRankKeyword(value: string) {
  if (!value) return false;
  if (value.length < 2) return false;
  if (value.length > 40) return false;
  if (/^\d+$/.test(value)) return false;
  if (/^(날씨|뉴스|검색|실시간)$/i.test(value)) return false;
  return true;
}

function isPersonNameLike(value: string) {
  // Very short all-Hangul phrases tend to be person names in real-time rankings.
  return /^[가-힣]{2,4}$/.test(value);
}

function isSafeForEvergreen(value: string) {
  if (!value) return false;
  if (LOW_VALUE_PATTERNS.some((pattern) => pattern.test(value))) return false;
  if (PERSON_OR_EVENT_PATTERNS.some((pattern) => pattern.test(value))) return false;
  if (isPersonNameLike(value)) return false;
  return true;
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractNateRankKeywords(html: string): string[] {
  const block = html.match(/<ol[^>]*id=["']olLiveIssueKeyword["'][^>]*>([\s\S]*?)<\/ol>/i)?.[1] ?? '';
  if (!block) return [];

  const matches = [...block.matchAll(/<span[^>]*class=["'][^"']*txt_rank[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)];
  const list = matches
    .map((m) => cleanRankPhrase(m[1] ?? ''))
    .filter(isUsefulRankKeyword);

  return [...new Set(list)].slice(0, 20);
}

async function loadSearchRankKeywords(now: Date): Promise<string[]> {
  const timeoutMs = Number(process.env.SEARCH_RANK_TIMEOUT_MS || '7000');
  const html = await fetchTextWithTimeout('https://www.nate.com/', timeoutMs);
  const keywords = extractNateRankKeywords(html);

  const payload = {
    fetchedAt: now.toISOString(),
    source: 'nate-live-issue-keyword',
    count: keywords.length,
    keywords
  };

  await fs.mkdir(path.dirname(rankCachePath), { recursive: true });
  await fs.writeFile(rankCachePath, JSON.stringify(payload, null, 2));
  return keywords;
}

async function loadCachedRankKeywords(): Promise<string[]> {
  try {
    const raw = await fs.readFile(rankCachePath, 'utf-8');
    const parsed = JSON.parse(raw) as { keywords?: unknown };
    if (!Array.isArray(parsed.keywords)) return [];
    return parsed.keywords.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  } catch {
    return [];
  }
}

async function loadPreviousOutputKeywords(): Promise<string[]> {
  try {
    const raw = await fs.readFile(outPath, 'utf-8');
    const parsed = JSON.parse(raw) as { keywords?: unknown };
    if (!Array.isArray(parsed.keywords)) return [];
    return parsed.keywords.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  } catch {
    return [];
  }
}

function normalizeTopic(value: string) {
  const cleaned = value
    .replace(/\s+/g, ' ')
    .replace(/["'`]/g, '')
    .trim();
  const tokens = cleaned.split(' ').filter(Boolean);
  const compact: string[] = [];
  for (const token of tokens) {
    if (compact.length > 0 && compact[compact.length - 1] === token) continue;
    compact.push(token);
  }
  return compact.join(' ').trim();
}

function uniqueKeepOrder(items: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function extractMeaningfulTokensFromRank(value: string) {
  const parts = value
    .split(/[^\p{L}\p{N}]+/u)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.filter((token) => {
    if (token.length < 2 || token.length > 14) return false;
    if (TOKEN_STOPWORDS.has(token)) return false;
    if (isPersonNameLike(token)) return false;
    if (PERSON_OR_EVENT_PATTERNS.some((pattern) => pattern.test(token))) return false;
    return true;
  });
}

async function main() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const blacklist = new Set(await readLines(blacklistPath));
  let liveRankKeywords: string[] = [];
  try {
    liveRankKeywords = await loadSearchRankKeywords(now);
  } catch (error) {
    console.warn(`[warn] live rank fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const cachedRankKeywords = await loadCachedRankKeywords();
  const previousOutputKeywords = await loadPreviousOutputKeywords();
  const seedKeywords = await readLines(seedsPath);
  const rawRankKeywords = uniqueKeepOrder([...liveRankKeywords, ...cachedRankKeywords, ...previousOutputKeywords]).slice(0, 50);

  if (rawRankKeywords.length < 5) {
    console.warn(`[warn] sparse ranking pool: ${rawRankKeywords.length} keywords`);
  }

  const safeRankKeywords = uniqueKeepOrder(
    rawRankKeywords.map(normalizeTopic).filter((keyword) => isSafeForEvergreen(keyword) && !blacklist.has(keyword) && !isUnsafeTopic(keyword))
  );

  const tokenDerivedRankKeywords = uniqueKeepOrder(
    rawRankKeywords
      .flatMap((row) => extractMeaningfulTokensFromRank(normalizeTopic(row)))
      .map((token) => `${token} 가이드`)
      .filter((keyword) => isSafeForEvergreen(keyword) && !blacklist.has(keyword) && !isUnsafeTopic(keyword))
  );

  const rankKeywords = uniqueKeepOrder([...safeRankKeywords, ...tokenDerivedRankKeywords]);

  const relaxedRankKeywords = uniqueKeepOrder(
    rawRankKeywords
      .map(normalizeTopic)
      .filter(
        (keyword) =>
          keyword.length > 1 &&
          !LOW_VALUE_PATTERNS.some((pattern) => pattern.test(keyword)) &&
          !blacklist.has(keyword) &&
          !isUnsafeTopic(keyword)
      )
  );

  const finalRankKeywords = rankKeywords.length > 0 ? rankKeywords : relaxedRankKeywords;
  const finalBaseKeywords =
    finalRankKeywords.length >= 5
      ? finalRankKeywords
      : uniqueKeepOrder([...finalRankKeywords, ...seedKeywords.map(normalizeTopic)]).filter(
          (keyword) => !blacklist.has(keyword) && !isUnsafeTopic(keyword)
        );

  const usedKeywords = new Set<string>();
  const stemCount = new Map<string, number>();
  const categoryCount = new Map<string, number>();
  const selected: string[] = [];
  // When today's safe ranking pool is small, relax stem cap to avoid pipeline failure.
  const maxPerStem = finalRankKeywords.length < 6 ? 2 : 1;
  const limit = 30;

  function tryAdd(keyword: string) {
    const cleaned = keyword.trim();
    if (!cleaned) return false;
    if (blacklist.has(cleaned) || isUnsafeTopic(cleaned)) return false;

    const stem = topicStem(cleaned);
    if (!stem) return false;
    if (usedKeywords.has(cleaned.toLowerCase())) return false;
    const stemHits = stemCount.get(stem) ?? 0;
    if (stemHits >= maxPerStem) return false;

    const category = classifyCategory(cleaned);
    const current = categoryCount.get(category) ?? 0;
    const maxPerCategory = CATEGORY_CAPS[category] ?? CATEGORY_CAPS.기타;
    if (current >= maxPerCategory) return false;

    usedKeywords.add(cleaned.toLowerCase());
    stemCount.set(stem, stemHits + 1);
    categoryCount.set(category, current + 1);
    selected.push(cleaned);
    return true;
  }

  // 1) 검색순위 원문 우선 반영
  for (const rank of finalBaseKeywords) {
    if (selected.length >= limit) break;
    tryAdd(rank);
  }

  // 2) 검색순위 기반 확장 키워드 생성(라운드로빈으로 주제 편중 완화)
  for (const tpl of templates) {
    if (selected.length >= limit) break;
    for (const rank of finalBaseKeywords) {
      if (selected.length >= limit) break;
      tryAdd(tpl.replace('{keyword}', rank).trim());
    }
  }

  if (selected.length === 0) {
    throw new Error('키워드를 생성할 수 없습니다: live/cache/previous 모두 비어 있습니다');
  }

  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: today,
        source: 'search-rank-only',
        sourceProvider: 'nate-live-issue-keyword',
        rankKeywordCount: rawRankKeywords.length,
        liveRankKeywordCount: liveRankKeywords.length,
        cachedRankKeywordCount: cachedRankKeywords.length,
        previousOutputKeywordCount: previousOutputKeywords.length,
        seedKeywordCount: seedKeywords.length,
        safeRankKeywordCount: safeRankKeywords.length,
        relaxedRankKeywordCount: relaxedRankKeywords.length,
        usingRelaxedKeywords: rankKeywords.length === 0,
        usingSeedFallback: finalRankKeywords.length < 5,
        tokenDerivedRankKeywordCount: tokenDerivedRankKeywords.length,
        count: selected.length,
        categories: Object.fromEntries(categoryCount.entries()),
        keywords: selected
      },
      null,
      2
    )
  );

  console.log(`generated keywords: ${selected.length} (rank=${finalRankKeywords.length}, live=${liveRankKeywords.length}, cache=${cachedRankKeywords.length})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
