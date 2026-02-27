import fs from 'node:fs/promises';
import path from 'node:path';
import { isUnsafeTopic } from './policy';
import { readLines } from './utils';

const blacklistPath = path.join(process.cwd(), 'src/content/keywords/blacklist.txt');
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

const CATEGORY_RULES: Array<{ category: string; patterns: RegExp[] }> = [
  { category: '생산성', patterns: [/시간|루틴|집중|목표|업무|정리|메일|회의|문서|메모/i] },
  { category: '디지털', patterns: [/보안|비밀번호|백업|브라우저|와이파이|스마트폰|노트북|키보드|사진|파일|앱/i] },
  { category: '생활관리', patterns: [/장보기|가계부|예산|구독|쇼핑|중고|청소|옷|주방|냉장고|재활용/i] },
  { category: '건강생활', patterns: [/수면|스트레스|운동|걷기|스트레칭|자세|눈 건강|목 건강/i] },
  { category: '교통/이동', patterns: [/교통|운전|전기차|기차|버스|지하철|항공|여행/i] },
  { category: '사회/이슈', patterns: [/선거|정책|공천|사건|사고|법안|공공|행정|국회/i] }
];

function topicStem(keyword: string) {
  return keyword
    .toLowerCase()
    .replace(/(뜻|방법|기준|비교|추천|주의사항|체크리스트|요약|실생활 영향)\s*$/g, '')
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

async function main() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const blacklist = new Set(await readLines(blacklistPath));

  const rankKeywords = await loadSearchRankKeywords(now);
  if (rankKeywords.length < 5) {
    throw new Error(`검색순위 키워드 수집 실패: ${rankKeywords.length}개`);
  }

  const usedKeywords = new Set<string>();
  const categoryCount = new Map<string, number>();
  const selected: string[] = [];
  const maxPerCategory = 30;
  const limit = 30;

  function tryAdd(keyword: string) {
    const cleaned = keyword.trim();
    if (!cleaned) return false;
    if (blacklist.has(cleaned) || isUnsafeTopic(cleaned)) return false;

    const stem = topicStem(cleaned);
    if (!stem) return false;
    if (usedKeywords.has(cleaned.toLowerCase())) return false;

    const category = classifyCategory(cleaned);
    const current = categoryCount.get(category) ?? 0;
    if (current >= maxPerCategory) return false;

    usedKeywords.add(cleaned.toLowerCase());
    categoryCount.set(category, current + 1);
    selected.push(cleaned);
    return true;
  }

  // 1) 검색순위 원문 우선 반영
  for (const rank of rankKeywords) {
    if (selected.length >= limit) break;
    tryAdd(rank);
  }

  // 2) 검색순위 기반 확장 키워드 생성(라운드로빈으로 주제 편중 완화)
  for (const tpl of templates) {
    if (selected.length >= limit) break;
    for (const rank of rankKeywords) {
      if (selected.length >= limit) break;
      tryAdd(tpl.replace('{keyword}', rank).trim());
    }
  }

  if (selected.length < 10) {
    throw new Error(`검색순위 기반 키워드가 너무 적습니다: ${selected.length}개`);
  }

  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: today,
        source: 'search-rank-only',
        sourceProvider: 'nate-live-issue-keyword',
        rankKeywordCount: rankKeywords.length,
        count: selected.length,
        categories: Object.fromEntries(categoryCount.entries()),
        keywords: selected
      },
      null,
      2
    )
  );

  console.log(`generated keywords: ${selected.length} (rank=${rankKeywords.length})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
