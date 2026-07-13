import fs from 'node:fs/promises';
import path from 'node:path';
import { isLowTrustKeyword, isUnsafeTopic } from './policy';
import { loadPostsFrontmatter, readLines } from './utils';

const blacklistPath = path.join(process.cwd(), 'src/content/keywords/blacklist.txt');
const outPath = path.join(process.cwd(), 'src/content/keywords/today.json');
const rankCachePath = path.join(process.cwd(), 'logs/search-rank-cache.json');
const SEARCH_RANK_PROVIDER = (process.env.SEARCH_RANK_PROVIDER ?? 'google').trim().toLowerCase();

const templates = [
  '{keyword} 비교',
  '{keyword} 추천',
  '{keyword} 가격',
  '{keyword} 비용',
  '{keyword} 요금',
  '{keyword} 후기',
  '{keyword} 할인',
  '{keyword} 가입 방법'
];
const INTENT_SUFFIX_CAP = Number(process.env.INTENT_SUFFIX_CAP ?? '3');
const PRICE_LIKE_SUFFIX_CAP = Number(process.env.PRICE_LIKE_SUFFIX_CAP ?? '1');

const PERSON_OR_EVENT_PATTERNS = [
  /대통령|장관|국회의원|의원|대법원장|검사|판사|총리|대표|감독|선수|배우|가수|유튜버|인플루언서/i,
  /체포|구속|수사|재판|논란|폭로|사망|사고|추락|화재|참사|총격|살인/i
];

const LOW_VALUE_PATTERNS = [/^(속보|단독|뉴스|실시간|이슈)$/i];
const NOISY_NEWS_FRAGMENT_PATTERNS = [
  /업무협약|대외협력원|국무회의|의결|출마|공모주|MTS|오류|IPO|단독|속보|브리핑/i,
  /대통령|정부|국회|장관|의원|총리|재판|수사|체포|구속|참사|사고/i,
  /대학교|대학|여대|증권|주식|코스피|코스닥|주가지수/i,
  /공모|우호지분|경영권|방어|한계|승부|도전장|의료기기|항체/i,
  /협약|협의회|기업\s*\d+곳/i
];
const ENGLISH_NEWSY_PATTERNS = [
  /\b(claims?|says?|led|beat|takeaways?|lawsuit|against|after|from|with|man|son|voters?|primary|election)\b/i
];
const ENGLISH_ALLOWED_TOPICS = /\b(ai|gemini|chatbot|app|tool|workflow|automation|productivity)\b/i;
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
  { category: '코인/투자기초', patterns: [/비트코인|이더리움|코인|가상자산|거래소|지갑|온체인|스테이킹|디파이|etf/i] },
  { category: '생활관리', patterns: [/장보기|가계부|예산|구독|쇼핑|중고|청소|옷|주방|냉장고|재활용/i] },
  { category: '건강생활', patterns: [/수면|스트레스|운동|걷기|스트레칭|자세|눈 건강|목 건강/i] },
  { category: '교통/이동', patterns: [/교통|운전|전기차|기차|버스|지하철|항공|여행/i] },
  { category: '사회/이슈', patterns: [/선거|정책|공천|사건|사고|법안|공공|행정|국회/i] }
];

const SITE_RELEVANCE_PATTERNS = [
  /시간|루틴|집중|메모|목표|일정|업무|메일|회의|생산성/i,
  /디지털|보안|비밀번호|백업|스마트폰|브라우저|앱|계정|개인정보|와이파이|노트북/i,
  /비트코인|이더리움|코인|가상자산|거래소|지갑|온체인|스테이킹|디파이|etf|수수료|입출금|시세/i,
  /생활|장보기|가계부|예산|청소|정리|주방|냉장고|구독|소비/i,
  /건강|수면|스트레스|운동|자세|눈 건강|목 건강/i,
  /교통|운전|전기차|기차|버스|지하철|항공|여행/i
];

const COMMERCIAL_HIGH_PATTERNS = [
  /가격|비용|요금|할인|쿠폰|구독|무료체험|프로모션|특가/i,
  /추천|비교|순위|best|top|후기|리뷰|대안|대체/i,
  /가입|신청|등록|설치|구매|결제/i
];

const COMMERCIAL_MEDIUM_PATTERNS = [/가이드|방법|체크리스트|앱|툴|서비스|자동화|설정|최적화/i];
const LOW_INTENT_PATTERNS = [/뜻|요약|정리|뉴스|이슈|실시간|속보/i];

const CATEGORY_CAPS: Record<string, number> = {
  생산성: 7,
  디지털: 7,
  '코인/투자기초': 7,
  생활관리: 7,
  건강생활: 5,
  '교통/이동': 4,
  '사회/이슈': 2,
  기타: 0
};

const MIN_COMMERCIAL_SCORE = Number(process.env.MIN_COMMERCIAL_SCORE ?? '2');
const RECENT_DUP_DAYS = Math.max(1, Number(process.env.RECENT_DUP_DAYS ?? '7'));
const FALLBACK_MIN_KEYWORDS = Math.max(10, Number(process.env.FALLBACK_MIN_KEYWORDS ?? '12'));
const MAX_SELECTED_KEYWORDS = Math.max(FALLBACK_MIN_KEYWORDS, Number(process.env.MAX_SELECTED_KEYWORDS ?? '16'));
const DOMAIN_TOPIC_MODE = (process.env.DOMAIN_TOPIC_MODE ?? 'on').trim().toLowerCase() !== 'off';
const TREND_TOPIC_MODE = (process.env.TREND_TOPIC_MODE ?? 'on').trim().toLowerCase() !== 'off';
const DOMAIN_BASE_TOPICS = [
  '생산성 앱',
  '자동화 워크플로우',
  '노션 템플릿',
  '캘린더 관리',
  '비밀번호 관리',
  '클라우드 백업',
  '스마트폰 보안',
  '브라우저 보안',
  '구독비 절감',
  '가계부 자동화',
  '비트코인 거래소',
  '이더리움 가스비',
  '코인 지갑 보안',
  '가상자산 수수료 비교',
  '스테이킹 방법',
  '온체인 데이터 보는 법'
];

function topicStem(keyword: string) {
  const suffixes = new Set(['뜻', '방법', '기준', '비교', '추천', '주의사항', '체크리스트', '요약', '실생활', '영향', '가이드', '정리', '분석', '후기', '가격', '비용', '요금', '할인', '가입']);
  return keyword
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .filter((token, idx, arr) => {
      // Strip known trailing intent suffixes repeatedly: "수면 위생 비교 추천" -> "수면 위생"
      const fromEnd = arr.length - idx;
      if (fromEnd <= 3 && suffixes.has(token)) return false;
      return true;
    })
    .join(' ')
    .trim();
}

function parseDateOnly(value: unknown): Date | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const ymd = raw.slice(0, 10);
  const match = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function isWithinRecentDays(dateValue: unknown, baseYmd: string, days: number): boolean {
  const target = parseDateOnly(dateValue);
  const base = parseDateOnly(baseYmd);
  if (!target || !base) return false;
  const diffDays = Math.floor((base.getTime() - target.getTime()) / (24 * 60 * 60 * 1000));
  return diffDays >= 0 && diffDays < days;
}

function classifyCategory(keyword: string) {
  const base = topicStem(keyword) || keyword;
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(base))) return rule.category;
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
  if (value.length > 32) return false;
  if (/^\d+$/.test(value)) return false;
  if (/^(날씨|뉴스|검색|실시간)$/i.test(value)) return false;
  if (NOISY_NEWS_FRAGMENT_PATTERNS.some((pattern) => pattern.test(value))) return false;
  if (/[①②③④⑤⑥⑦⑧⑨⑩]/.test(value)) return false;
  if (/\d+([.,]\d+)?\s*%/.test(value)) return false;
  if (/[…]|\.{2,}/.test(value)) return false;
  if (/(했|였|된|되는|통과|발생|요청|주장|논란)\S*$/i.test(value)) return false;
  if (/^[A-Za-z0-9\s]+$/.test(value)) {
    if (ENGLISH_NEWSY_PATTERNS.some((pattern) => pattern.test(value))) return false;
    if (!ENGLISH_ALLOWED_TOPICS.test(value)) return false;
    const tokenCount = value.trim().split(/\s+/).filter(Boolean).length;
    if (tokenCount > 4) return false;
  }
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
  if (isLowTrustKeyword(value)) return false;
  return true;
}

function isRelevantToSite(value: string) {
  const base = topicStem(value) || value;
  return SITE_RELEVANCE_PATTERNS.some((pattern) => pattern.test(base));
}

function looksLikeGeneralUtilityTopic(value: string) {
  const base = normalizeTopic(value);
  if (!base) return false;
  if (/\s/.test(base)) return true; // multi-token phrases tend to be more actionable than single named entities
  if (/[a-z]/i.test(base) && base.length >= 6) return true;
  return /앱|서비스|증권|주식|일정|요금|가격|가이드|비교|추천/i.test(base);
}

function buildDomainTopicKeywords(): string[] {
  const out: string[] = [];
  for (const base of DOMAIN_BASE_TOPICS) {
    out.push(base);
    for (const tpl of templates) out.push(tpl.replace('{keyword}', base).trim());
    out.push(`${base} 가이드`);
    out.push(`${base} 체크리스트`);
  }
  return uniqueKeepOrder(out.map(normalizeTopic)).slice(0, 300);
}

function commercialIntentScore(value: string) {
  const base = normalizeTopic(value);
  let score = 0;
  for (const pattern of COMMERCIAL_HIGH_PATTERNS) {
    if (pattern.test(base)) score += 3;
  }
  for (const pattern of COMMERCIAL_MEDIUM_PATTERNS) {
    if (pattern.test(base)) score += 1;
  }
  for (const pattern of LOW_INTENT_PATTERNS) {
    if (pattern.test(base)) score -= 2;
  }
  return score;
}

function detectIntentSuffix(value: string): string {
  const v = normalizeTopic(value);
  const match = v.match(/(가입 방법|비교|추천|가격|비용|요금|후기|할인)$/);
  return match ? match[1] : 'base';
}

function intentSuffixCap(suffix: string): number {
  if (suffix === '가격' || suffix === '비용' || suffix === '요금') return PRICE_LIKE_SUFFIX_CAP;
  return INTENT_SUFFIX_CAP;
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

function extractGoogleTrendsKeywords(xml: string): string[] {
  const items = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)];
  const titles: string[] = [];

  for (const item of items) {
    const itemXml = item[0];
    const raw =
      itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i)?.[1] ??
      itemXml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ??
      '';
    const mainTitle = decodeHtmlEntities(raw).replace(/\s*-\s*Google Trends\s*$/i, '').trim();
    if (mainTitle && isUsefulRankKeyword(mainTitle)) titles.push(mainTitle);

    // Expand raw pool with related news titles from the same trend item.
    const newsTitles = [...itemXml.matchAll(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/gi)]
      .map((m) => decodeHtmlEntities(m[1] ?? '').trim())
      .filter(Boolean);
    for (const newsTitle of newsTitles) {
      const chunks = newsTitle
        .split(/[|:/·,\-\(\)\[\]'"“”‘’]+/g)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2 && s.length <= 28);
      for (const chunk of chunks) {
        if (isUsefulRankKeyword(chunk)) titles.push(chunk);
      }
    }
  }

  return [...new Set(titles)].slice(0, 120);
}

async function loadSearchRankKeywords(now: Date): Promise<{ provider: string; keywords: string[] }> {
  const timeoutMs = Number(process.env.SEARCH_RANK_TIMEOUT_MS || '7000');
  let provider = SEARCH_RANK_PROVIDER;
  let keywords: string[] = [];

  if (provider === 'google') {
    const xml = await fetchTextWithTimeout('https://trends.google.com/trending/rss?geo=KR', timeoutMs);
    keywords = extractGoogleTrendsKeywords(xml);
  } else if (provider === 'nate') {
    const html = await fetchTextWithTimeout('https://www.nate.com/', timeoutMs);
    keywords = extractNateRankKeywords(html);
  } else {
    throw new Error(`unsupported SEARCH_RANK_PROVIDER: ${provider}`);
  }

  const payload = {
    fetchedAt: now.toISOString(),
    source: provider,
    count: keywords.length,
    keywords
  };

  await fs.mkdir(path.dirname(rankCachePath), { recursive: true });
  await fs.writeFile(rankCachePath, JSON.stringify(payload, null, 2));
  return { provider, keywords };
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
  const recentPosts = (await loadPostsFrontmatter()).filter((row) => {
    const dateValue = row.data.updatedAt ?? row.data.publishedAt;
    return isWithinRecentDays(dateValue, today, RECENT_DUP_DAYS);
  });
  const recentTopicStems = new Set(
    recentPosts
      .flatMap((row) => [String(row.data.title ?? ''), String(row.data.slug ?? '').replace(/-/g, ' ')])
      .map((value) => topicStem(value))
      .filter(Boolean)
  );

  const blacklist = new Set(await readLines(blacklistPath));
  let liveRankKeywords: string[] = [];
  let sourceProvider = '';
  try {
    const loaded = await loadSearchRankKeywords(now);
    liveRankKeywords = loaded.keywords;
    sourceProvider = loaded.provider;
  } catch (error) {
    console.warn(`[warn] live rank fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (liveRankKeywords.length === 0) {
    throw new Error('최신 검색 트렌드(live rank)를 가져오지 못해 키워드 생성을 중단합니다');
  }
  const rawRankKeywords = uniqueKeepOrder(liveRankKeywords).slice(0, 120);

  if (rawRankKeywords.length < 5) {
    console.warn(`[warn] sparse ranking pool: ${rawRankKeywords.length} keywords`);
  }

  const safeRankKeywords = uniqueKeepOrder(
    rawRankKeywords
      .map(normalizeTopic)
      .filter(
        (keyword) =>
          isSafeForEvergreen(keyword) && isRelevantToSite(keyword) && !blacklist.has(keyword) && !isUnsafeTopic(keyword)
      )
  );

  const tokenDerivedRankKeywords = uniqueKeepOrder(
    rawRankKeywords
      .flatMap((row) => extractMeaningfulTokensFromRank(normalizeTopic(row)))
      .map((token) => `${token} 가이드`)
      .filter(
        (keyword) =>
          isSafeForEvergreen(keyword) && isRelevantToSite(keyword) && !blacklist.has(keyword) && !isUnsafeTopic(keyword)
      )
  );

  const rankKeywords = uniqueKeepOrder([...safeRankKeywords, ...tokenDerivedRankKeywords]);

  const relaxedRankKeywords = uniqueKeepOrder(
    rawRankKeywords
      .map(normalizeTopic)
      .filter(
        (keyword) =>
          keyword.length > 1 &&
          !LOW_VALUE_PATTERNS.some((pattern) => pattern.test(keyword)) &&
          isSafeForEvergreen(keyword) &&
          isRelevantToSite(keyword) &&
          !isLowTrustKeyword(keyword) &&
          !blacklist.has(keyword) &&
          !isUnsafeTopic(keyword)
      )
  );

  const finalRankKeywords = rankKeywords.length > 0 ? rankKeywords : relaxedRankKeywords;
  const domainKeywords = DOMAIN_TOPIC_MODE
    ? buildDomainTopicKeywords().filter(
        (keyword) =>
          isSafeForEvergreen(keyword) &&
          isRelevantToSite(keyword) &&
          !isLowTrustKeyword(keyword) &&
          !blacklist.has(keyword) &&
          !isUnsafeTopic(keyword)
      )
    : [];
  const trendKeywords = TREND_TOPIC_MODE ? finalRankKeywords : [];
  const mergedBaseKeywords = uniqueKeepOrder([...trendKeywords, ...domainKeywords]);
  const prioritizedBaseKeywords = [...mergedBaseKeywords].sort((a, b) => {
    const scoreDiff = commercialIntentScore(b) - commercialIntentScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    const trendA = trendKeywords.includes(a) ? 1 : 0;
    const trendB = trendKeywords.includes(b) ? 1 : 0;
    return trendB - trendA;
  });
  const fallbackBaseKeywords = uniqueKeepOrder(
    [...rawRankKeywords, ...domainKeywords]
      .map(normalizeTopic)
      .filter(
        (keyword) =>
          keyword.length > 1 &&
          !LOW_VALUE_PATTERNS.some((pattern) => pattern.test(keyword)) &&
          isSafeForEvergreen(keyword) &&
          !blacklist.has(keyword) &&
          !isUnsafeTopic(keyword) &&
          (isRelevantToSite(keyword) || ENGLISH_ALLOWED_TOPICS.test(keyword)) &&
          looksLikeGeneralUtilityTopic(keyword)
      )
  );

  const usedKeywords = new Set<string>();
  const stemCount = new Map<string, number>();
  const categoryCount = new Map<string, number>();
  const intentSuffixCount = new Map<string, number>();
  const selected: string[] = [];
  const selectedCommercialScores: number[] = [];
  // When today's safe ranking pool is small, relax stem cap to avoid pipeline failure.
  const maxPerStem = mergedBaseKeywords.length < 10 ? 3 : 2;
  const limit = MAX_SELECTED_KEYWORDS;

  function tryAdd(keyword: string, enforceCommercial = true, requireSiteRelevance = true, enforceCategoryCap = true) {
    const cleaned = keyword.trim();
    if (!cleaned) return false;
    if (blacklist.has(cleaned) || isUnsafeTopic(cleaned)) return false;
    if (isLowTrustKeyword(cleaned)) return false;
    if (requireSiteRelevance && !isRelevantToSite(cleaned)) return false;
    const commercialScore = commercialIntentScore(cleaned);
    if (enforceCommercial && commercialScore < MIN_COMMERCIAL_SCORE) return false;

    const stem = topicStem(cleaned);
    if (!stem) return false;
    if (recentTopicStems.has(stem)) return false;
    if (usedKeywords.has(cleaned.toLowerCase())) return false;
    const stemHits = stemCount.get(stem) ?? 0;
    if (stemHits >= maxPerStem) return false;

    const category = classifyCategory(cleaned);
    const current = categoryCount.get(category) ?? 0;
    const maxPerCategory = CATEGORY_CAPS[category] ?? CATEGORY_CAPS.기타;
    if (enforceCategoryCap && current >= maxPerCategory) return false;

    const suffix = detectIntentSuffix(cleaned);
    const suffixHits = intentSuffixCount.get(suffix) ?? 0;
    if (suffix !== 'base' && suffixHits >= intentSuffixCap(suffix)) return false;

    usedKeywords.add(cleaned.toLowerCase());
    stemCount.set(stem, stemHits + 1);
    categoryCount.set(category, current + 1);
    intentSuffixCount.set(suffix, suffixHits + 1);
    selected.push(cleaned);
    selectedCommercialScores.push(commercialScore);
    return true;
  }

  // 1) 검색순위 원문 우선 반영
  for (const rank of prioritizedBaseKeywords) {
    if (selected.length >= limit) break;
    tryAdd(rank, true);
  }

  // 2) 검색순위 기반 확장 키워드 생성(라운드로빈으로 주제 편중 완화)
  for (const tpl of templates) {
    if (selected.length >= limit) break;
    for (const rank of prioritizedBaseKeywords) {
      if (selected.length >= limit) break;
      tryAdd(tpl.replace('{keyword}', rank).trim(), true);
    }
  }

  // If high-intent pool is sparse, fill remainder with relaxed relevance-only candidates.
  if (selected.length < Math.min(8, limit)) {
    for (const rank of prioritizedBaseKeywords) {
      if (selected.length >= limit) break;
      tryAdd(rank, false);
    }
    for (const tpl of templates) {
      if (selected.length >= limit) break;
      for (const rank of prioritizedBaseKeywords) {
        if (selected.length >= limit) break;
        tryAdd(tpl.replace('{keyword}', rank).trim(), false);
      }
    }
  }

  // Soft fallback: if strict relevance yields too few results, allow safe/utility topics with lower commercial threshold.
  if (selected.length < FALLBACK_MIN_KEYWORDS) {
    for (const rank of fallbackBaseKeywords) {
      if (selected.length >= FALLBACK_MIN_KEYWORDS) break;
      tryAdd(rank, false, false, false);
    }
    for (const tpl of templates) {
      if (selected.length >= FALLBACK_MIN_KEYWORDS) break;
      for (const rank of fallbackBaseKeywords) {
        if (selected.length >= FALLBACK_MIN_KEYWORDS) break;
        tryAdd(tpl.replace('{keyword}', rank).trim(), false, false, false);
      }
    }
  }

  if (selected.length < 3) {
    throw new Error('최신 검색 트렌드 기반으로 유효한 키워드를 찾지 못했습니다');
  }

  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: today,
        source: 'search-rank-live-only',
        sourceProvider,
        rankKeywordCount: rawRankKeywords.length,
        liveRankKeywordCount: liveRankKeywords.length,
        cachedRankKeywordCount: 0,
        previousOutputKeywordCount: 0,
        seedKeywordCount: 0,
        safeRankKeywordCount: safeRankKeywords.length,
        relaxedRankKeywordCount: relaxedRankKeywords.length,
        domainKeywordCount: domainKeywords.length,
        trendKeywordCount: trendKeywords.length,
        mergedBaseKeywordCount: mergedBaseKeywords.length,
        usingRelaxedKeywords: rankKeywords.length === 0,
        usingSeedFallback: false,
        tokenDerivedRankKeywordCount: tokenDerivedRankKeywords.length,
        fallbackBaseKeywordCount: fallbackBaseKeywords.length,
        recentDupDays: RECENT_DUP_DAYS,
        recentTopicStemCount: recentTopicStems.size,
        minCommercialScore: MIN_COMMERCIAL_SCORE,
        averageCommercialScore:
          selectedCommercialScores.length > 0
            ? Number((selectedCommercialScores.reduce((sum, score) => sum + score, 0) / selectedCommercialScores.length).toFixed(2))
            : 0,
        highIntentSelectedCount: selectedCommercialScores.filter((score) => score >= MIN_COMMERCIAL_SCORE).length,
        intentSuffixCap: INTENT_SUFFIX_CAP,
        priceLikeSuffixCap: PRICE_LIKE_SUFFIX_CAP,
        intentSuffixDistribution: Object.fromEntries(intentSuffixCount.entries()),
        count: selected.length,
        categories: Object.fromEntries(categoryCount.entries()),
        keywords: selected
      },
      null,
      2
    )
  );

  console.log(
    `generated keywords: ${selected.length} (rank=${finalRankKeywords.length}, live=${liveRankKeywords.length}, avgIntent=${selectedCommercialScores.length > 0 ? (selectedCommercialScores.reduce((sum, score) => sum + score, 0) / selectedCommercialScores.length).toFixed(2) : '0.00'})`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
