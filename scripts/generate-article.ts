import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import OpenAI from 'openai';
import { isLowTrustKeyword, isUnsafeTopic, shouldAddDisclaimer } from './policy';
import {
  LOG_DIR,
  POSTS_DIR,
  ensureDir,
  jaccardSimilarity,
  loadPostsFrontmatter,
  slugify,
  writeRunGeneratedPosts,
  wordCount
} from './utils';

const todayPath = path.join(process.cwd(), 'src/content/keywords/today.json');
const forbiddenPath = path.join(process.cwd(), 'src/content/keywords/forbidden.txt');

function todayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
}

function nowKSTIso() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  const ss = String(kst.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}+09:00`;
}

async function readForbidden() {
  const raw = await fs.readFile(forbiddenPath, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function countSections(content: string) {
  return (content.match(/^#{2,3}\s+/gm) ?? []).length;
}

function countFaqItems(content: string) {
  const faq = content.match(/##\s*FAQ[\s\S]*$/i)?.[0] ?? '';
  return (faq.match(/Q\d|^\s*-\s*Q[:.]|^\s*\*\*Q/gi) ?? []).length;
}

const MIN_WORD_COUNT = Number(process.env.MIN_WORD_COUNT ?? '900');
const ARTICLE_PARALLELISM = Math.max(1, Number(process.env.ARTICLE_PARALLELISM ?? '3'));
const MAX_ATTEMPTS_PER_KEYWORD = Math.max(1, Number(process.env.ARTICLE_MAX_ATTEMPTS ?? '1'));
const TITLE_SIMILARITY_THRESHOLD = Number(process.env.TITLE_SIMILARITY_THRESHOLD ?? '0.7');
const GEMINI_TIMEOUT_MS = Math.max(5000, Number(process.env.GEMINI_TIMEOUT_MS ?? '15000'));
const OPENAI_TIMEOUT_MS = Math.max(5000, Number(process.env.OPENAI_TIMEOUT_MS ?? '25000'));
const RETRY_BACKOFF_MS = Math.max(0, Number(process.env.RETRY_BACKOFF_MS ?? '1200'));
const RECENT_DUP_DAYS = Math.max(1, Number(process.env.RECENT_DUP_DAYS ?? '7'));
const KEYWORD_POOL_MULTIPLIER = Math.max(2, Number(process.env.KEYWORD_POOL_MULTIPLIER ?? '4'));
const ALLOW_FALLBACK = String(process.env.ALLOW_FALLBACK ?? 'false').trim().toLowerCase() === 'true';
const GEMINI_TOPIC_VARIATION = String(process.env.GEMINI_TOPIC_VARIATION ?? 'true').trim().toLowerCase() === 'true';
const GEMINI_TOPIC_VARIATION_TIMEOUT_MS = Math.max(5000, Number(process.env.GEMINI_TOPIC_VARIATION_TIMEOUT_MS ?? '10000'));

function topicStem(value: string) {
  return value
    .toLowerCase()
    .replace(/(뜻|방법|기준|비교|추천|주의사항|체크리스트|요약|실생활 영향|가이드|실무|전략|정리|분석)\s*$/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
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

type Provider = 'gemini' | 'openai';

function isLikelyRealOpenAiKey(key: string | undefined) {
  const value = String(key ?? '').trim();
  if (!value) return false;
  if (value.includes('OPENAI') || value.includes('YOUR_') || value.includes('***')) return false;
  return /^sk-[A-Za-z0-9_\-]{20,}$/.test(value);
}

function hasGeminiKey() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function hasOpenAiKey() {
  return isLikelyRealOpenAiKey(process.env.OPENAI_API_KEY);
}

function selectProviderOrder(): Provider[] {
  const preferred = (process.env.ARTICLE_PROVIDER ?? 'auto').toLowerCase();
  const hasGemini = hasGeminiKey();
  const hasOpenAI = hasOpenAiKey();

  if (preferred === 'gemini') {
    if (!hasGemini) throw new Error('ARTICLE_PROVIDER=gemini but GEMINI_API_KEY is missing');
    return hasOpenAI ? ['gemini', 'openai'] : ['gemini'];
  }
  if (preferred === 'openai') {
    if (!hasOpenAI) throw new Error('ARTICLE_PROVIDER=openai but OPENAI_API_KEY is missing');
    return hasGemini ? ['openai', 'gemini'] : ['openai'];
  }

  // auto: prefer Gemini first for this project.
  if (hasGemini && hasOpenAI) return ['gemini', 'openai'];
  if (hasGemini) return ['gemini'];
  if (hasOpenAI) return ['openai'];
  throw new Error('No article model API key configured');
}

async function sleep(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithGemini(prompt: string, timeoutMs: number) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is required');
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5 }
    }),
    signal: controller.signal
  }).finally(() => clearTimeout(timer));

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
  if (!text) throw new Error('empty output');
  return text;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const direct = text.trim();
  const candidates = [
    direct,
    direct.replace(/^```json\s*/i, '').replace(/```$/i, '').trim(),
    direct.match(/\{[\s\S]*\}/)?.[0] ?? ''
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // ignore parse errors and continue
    }
  }
  return null;
}

async function proposeGeminiTopicVariant(keyword: string, recentTitles: string[]) {
  if (!GEMINI_TOPIC_VARIATION || !hasGeminiKey()) return null;
  const prompt = [
    '다음 키워드로 한국어 정보성 기사의 차별화된 제목/각도를 1개 제안하라.',
    `키워드: ${keyword}`,
    `최근 제목(중복 회피 참고): ${recentTitles.slice(0, 30).join(' | ') || '없음'}`,
    '출력은 반드시 JSON 객체 1개만:',
    '{"title":"", "angle":"", "audience":"", "must_include":["", ""]}',
    '규칙: 과장/선정 금지, 뉴스속보체 금지, 제목 길이 18~38자, 같은 어미 반복 금지.'
  ].join('\n');

  try {
    const raw = await generateWithGemini(prompt, GEMINI_TOPIC_VARIATION_TIMEOUT_MS);
    const parsed = parseJsonObject(raw);
    if (!parsed) return null;
    const title = String(parsed.title ?? '').trim();
    const angle = String(parsed.angle ?? '').trim();
    const audience = String(parsed.audience ?? '').trim();
    const mustInclude = Array.isArray(parsed.must_include) ? parsed.must_include.map((v) => String(v).trim()).filter(Boolean) : [];
    if (!title || !angle) return null;
    return { title, angle, audience, mustInclude };
  } catch {
    return null;
  }
}

async function generateWithOpenAi(prompt: string, client: OpenAI) {
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
    temperature: 0.7,
    input: prompt
  });
  const markdown = response.output_text?.trim() ?? '';
  if (!markdown) throw new Error('empty output');
  return markdown;
}

function extractTitleFromContent(content: string, fallback: string) {
  const h1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (h1) return h1;
  const h2 = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /^#{2,3}\s+/.test(line) && !/^#{2,3}\s*핵심 포인트\s*\d+/i.test(line))
    ?.replace(/^#{2,3}\s+/, '')
    .trim();
  if (h2) return h2;
  return fallback;
}

function normalizeContent(content: string, keyword: string, today: string) {
  let next = content
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  if (!next) next = `${keyword}에 대한 기본 정보를 정리합니다.`;

  while (countSections(next) < 4) {
    const index = countSections(next) + 1;
    next += `\n\n## 핵심 포인트 ${index}\n${keyword}와 관련된 핵심 개념을 일상/업무 관점에서 정리합니다. 선택 기준, 준비 단계, 실행 순서, 점검 포인트를 차례대로 확인하면 시행착오를 줄일 수 있습니다. 확실하지 않음이 포함된 정보는 단정하지 않고 조건을 분리해 이해하는 것이 중요합니다.`;
  }

  if (countFaqItems(next) < 3) {
    next += `\n\n## FAQ\nQ1. ${keyword}를 시작할 때 무엇부터 점검해야 하나요?\nA1. 현재 상황, 목표, 제약 조건을 먼저 정리한 뒤 작은 단위로 적용하는 것이 좋습니다.\n\nQ2. 효과를 빠르게 확인하는 방법이 있나요?\nA2. 단기 지표 하나만 정해 일주일 단위로 비교하면 변화 여부를 파악하기 쉽습니다.\n\nQ3. 정보가 충돌하면 어떻게 판단하나요?\nA3. 출처와 맥락을 확인하고, 확실하지 않음인 정보는 보수적으로 해석하는 것이 안전합니다.`;
  }

  // Always normalize body-level update line to today's date.
  next = next.replace(/^\s*업데이트:\s*\d{4}-\d{2}-\d{2}\s*$/gim, '').trimEnd();
  if (!/업데이트:\s*\d{4}-\d{2}-\d{2}/.test(next)) {
    next += `\n\n업데이트: ${today}`;
  }
  if (!next.includes('<!-- RELATED_POSTS -->')) {
    next += `\n\n<!-- RELATED_POSTS -->`;
  }

  while (wordCount(next) < MIN_WORD_COUNT) {
    next += `\n\n## 실무 적용 확장\n${keyword}를 실제로 적용할 때는 준비-실행-점검의 반복 구조가 중요합니다. 먼저 현재 상태를 기록하고, 실행 기준을 작게 정한 뒤, 결과를 주간 단위로 비교해 조정해야 안정적으로 개선됩니다. 이 과정에서 확실하지 않음인 요소는 별도 목록으로 분리해 검증하고, 단정적인 수치 대신 상대 비교 중심으로 판단하면 품질 저하를 줄일 수 있습니다.`;
  }

  return next.trim();
}

function normalizeDraft(markdown: string, keyword: string, baseSlug: string, today: string, nowIso: string) {
  let parsed: matter.GrayMatterFile<string> | null = null;
  try {
    parsed = matter(markdown);
  } catch {
    parsed = null;
  }

  const baseContent = parsed ? parsed.content : markdown;
  const normalizedContent = normalizeContent(baseContent, keyword, today);

  const fallbackTitle = `${keyword} 실무 가이드`;
  const title = (parsed ? String(parsed.data.title ?? '').trim() : '') || extractTitleFromContent(normalizedContent, fallbackTitle);
  const slug = slugify((parsed ? String(parsed.data.slug ?? '').trim() : '') || baseSlug) || baseSlug;
  const description =
    (parsed ? String(parsed.data.description ?? '').trim() : '') || `${keyword}의 핵심 개념과 적용 방법, 점검 포인트를 정리한 실무형 안내서입니다.`;
  const tags =
    parsed && Array.isArray(parsed.data.tags) && parsed.data.tags.length > 0
      ? parsed.data.tags.map(String).slice(0, 5)
      : [keyword, '가이드', '실무'];
  const category = (parsed ? String(parsed.data.category ?? '').trim() : '') || '종합';
  const readingTimeMinutes = Math.max(8, Math.ceil(wordCount(normalizedContent) / 130));

  const data = {
    title,
    description,
    slug,
    publishedAt: nowIso,
    updatedAt: nowIso,
    tags,
    category,
    readingTimeMinutes,
    autoGenerated: true
  };

  return { parsed: { data, content: normalizedContent }, slug, title };
}

function validateNormalizedDraft(markdown: string, title: string, forbidden: string[]) {
  if (/(AI가|인공지능이|생성형\s*AI|GPT|ChatGPT)/i.test(markdown)) {
    return { ok: false as const, reason: 'mentions AI generation' };
  }
  const hitForbidden = forbidden.find((word) => `${title}\n${markdown}`.includes(word));
  if (hitForbidden) return { ok: false as const, reason: `forbidden word: ${hitForbidden}` };
  return { ok: true as const };
}

function sanitizeForbiddenText(input: string, forbidden: string[]) {
  const replacements: Record<string, string> = {
    무조건: '일반적으로',
    '100%': '대부분',
    '완벽 보장': '상대적으로 안정적',
    충격: '주목',
    역대급: '높은 수준',
    '반드시 돈 버는': '수익 가능성을 검토하는',
    '평생 무료': '장기 무료 정책',
    기적: '유의미한 개선',
    '절대 손해 없음': '손실 가능성을 낮추는',
    '단기간 확정': '단기 확인 가능성',
    '의사가 숨긴': '널리 알려지지 않은',
    '정부가 숨긴': '공개 정보에서 놓치기 쉬운',
    '몰랐다면 손해': '알아두면 도움이 되는'
  };

  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = input;
  for (const token of forbidden) {
    if (!token) continue;
    const replacement = replacements[token] ?? '주의 표현';
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(token)})(?=[^\\p{L}\\p{N}]|$)`, 'gu');
    out = out.replace(pattern, (_, prefix) => `${prefix}${replacement}`);
  }
  return out;
}

function deriveUniqueSlug(baseSlug: string, usedSlugs: Set<string>) {
  if (!usedSlugs.has(baseSlug)) return baseSlug;
  let idx = 2;
  while (usedSlugs.has(`${baseSlug}-${idx}`)) idx += 1;
  return `${baseSlug}-${idx}`;
}

function buildLocalFallbackBody(keyword: string, today: string) {
  const sections = [
    {
      title: '핵심 개념 정리',
      body: `${keyword}는 준비-실행-점검의 반복 구조로 접근할 때 안정적으로 개선됩니다. 먼저 현재 상태를 기록하고, 목표를 한 줄로 정의한 뒤, 실행 범위를 작게 시작하면 실패 비용을 줄일 수 있습니다.`
    },
    {
      title: '적용 전 체크리스트',
      body: `시작 전에는 현재 문제, 목표 시점, 사용할 시간, 실패 기준을 먼저 정리해야 합니다. 특히 우선순위를 1~2개로 제한하면 실행력이 올라가고, 중간에 방향이 흔들릴 가능성이 줄어듭니다.`
    },
    {
      title: '실행 단계',
      body: `실행 단계는 \"작게 시작-짧게 측정-빠르게 수정\"으로 운영하는 것이 좋습니다. 첫 주에는 완성보다 기록을 우선하고, 둘째 주부터 기준을 조정해야 실제 사용성에 맞는 루틴으로 수렴합니다.`
    },
    {
      title: '점검과 개선',
      body: `점검은 감각이 아니라 로그 기준으로 해야 합니다. 어떤 조건에서 성과가 나왔는지, 어떤 변수에서 실패했는지를 분리해 기록하면 다음 사이클에서 재현 가능한 개선이 가능합니다.`
    },
    {
      title: '자주 발생하는 실수',
      body: `한 번에 너무 많은 항목을 바꾸거나, 결과 확인 없이 도구만 교체하는 패턴이 가장 흔한 실수입니다. 변경은 1회 1변수 원칙으로 제한하고, 최소 7일 단위 비교 후 다음 결정을 내리는 것이 안전합니다.`
    },
    {
      title: '실전 운영 예시',
      body: `실무에서는 월요일에 계획, 수요일에 중간 점검, 금요일에 회고를 고정하면 운영 품질이 올라갑니다. 개인/팀 모두 동일한 템플릿을 사용하면 협업 시 해석 차이도 줄일 수 있습니다.`
    }
  ];

  let content = `${keyword}를 빠르게 이해하고 실무에 적용할 수 있도록 운영 기준과 점검 포인트를 중심으로 정리합니다. 불확실한 요소는 단정하지 않고 별도 검증 항목으로 분리하는 방식이 품질 관리에 유리합니다.`;
  for (const section of sections) {
    content += `\n\n## ${section.title}\n${section.body}`;
  }

  content += `\n\n## FAQ\nQ1. ${keyword}를 시작할 때 무엇부터 정해야 하나요?\nA1. 목표, 제약, 점검 주기 세 가지를 먼저 고정해야 실행 과정에서 흔들리지 않습니다.\n\nQ2. 성과가 안 보이면 바로 방식부터 바꿔야 하나요?\nA2. 바로 변경하지 말고 최소 1주 로그를 확보한 뒤 원인을 분리해 수정하는 편이 정확합니다.\n\nQ3. 정보가 충돌할 때는 어떻게 판단하나요?\nA3. 출처 시점과 적용 조건을 비교하고, 확실하지 않음인 항목은 보수적으로 적용해야 합니다.`;
  content += `\n\n업데이트: ${today}\n\n<!-- RELATED_POSTS -->`;

  let extraIdx = 1;
  while (wordCount(content) < MIN_WORD_COUNT) {
    content += `\n\n추가 점검 메모 ${extraIdx}. ${keyword} 운영 시 변경 이력, 실행 시간, 결과 체감을 같은 형식으로 남기면 주간 비교 품질이 크게 좋아집니다. 지표는 많이 두기보다 핵심 1~2개만 유지하는 방식이 실전에서 더 유효합니다.`;
    extraIdx += 1;
  }

  return content.trim();
}

async function main() {
  await ensureDir(POSTS_DIR);
  await ensureDir(LOG_DIR);

  const rawKeywords = JSON.parse(await fs.readFile(todayPath, 'utf8')) as { keywords: string[] };
  const count = Number(process.env.ARTICLE_COUNT ?? '10');
  const forbidden = await readForbidden();

  const today = todayKST();
  const existing = await loadPostsFrontmatter();
  const recentExisting = existing.filter((row) =>
    isWithinRecentDays(row.data.publishedAt ?? row.data.updatedAt, today, RECENT_DUP_DAYS)
  );
  const existingTitles = recentExisting.map((row) => String(row.data.title ?? ''));
  const existingSlugs = new Set(existing.map((row) => String(row.data.slug ?? '')));

  const providerOrder = selectProviderOrder();
  const openaiClient = hasOpenAiKey()
    ? new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        timeout: OPENAI_TIMEOUT_MS
      })
    : null;
  const created: string[] = [];
  const logLines: string[] = [];
  const selectedTitles: string[] = [...existingTitles];
  const selectedSlugs = new Set(existingSlugs);
  const selectedTopicStems = new Set(
    [
      ...recentExisting.map((row) => topicStem(String(row.data.title ?? ''))),
      ...recentExisting.map((row) => topicStem(String(row.data.slug ?? '').replace(/-/g, ' ')))
    ].filter(Boolean)
  );
  const keywordQueue = rawKeywords.keywords
    .filter((keyword) => {
      const stem = topicStem(keyword);
      if (!stem) return true;
      return !selectedTopicStems.has(stem);
    })
    .slice(0, Math.max(count * KEYWORD_POOL_MULTIPLIER, count));

  async function processKeyword(keyword: string) {
    console.log(`[article] start keyword: ${keyword}`);
    if (isUnsafeTopic(keyword)) return { keyword, ok: false as const, reason: 'unsafe keyword' };
    if (isLowTrustKeyword(keyword)) return { keyword, ok: false as const, reason: 'low-trust keyword' };

    const topicVariant = await proposeGeminiTopicVariant(keyword, selectedTitles);
    if (topicVariant?.title) {
      console.log(`[article] topic-variant: ${keyword} -> ${topicVariant.title}`);
    } else {
      console.log(`[article] topic-variant-skip: ${keyword}`);
    }
    const seedTitle = topicVariant?.title?.trim() || keyword;
    const baseSlug = slugify(seedTitle);
    if (!baseSlug) return { keyword, ok: false as const, reason: 'invalid slug keyword' };

    const basePrompt = [
      '한국어 정보형 기사 본문만 Markdown으로 작성하라. frontmatter는 쓰지 마라.',
      `키워드: ${keyword}`,
      topicVariant?.title ? `권장 제목(H1으로 사용): ${topicVariant.title}` : '',
      topicVariant?.angle ? `기사 각도(중복 회피): ${topicVariant.angle}` : '',
      topicVariant?.audience ? `대상 독자: ${topicVariant.audience}` : '',
      topicVariant?.mustInclude?.length ? `반드시 포함할 핵심 포인트: ${topicVariant.mustInclude.join(', ')}` : '',
      '본문 규칙: 도입 1개, H2 4~6개(필수), H3 선택, FAQ 섹션에서 Q&A 3개 포함.',
      '본문 길이: 700~1000단어 권장.',
      '문체: 중립적, 과장 금지, 확실하지 않은 사실은 "확실하지 않음"이라고 명시.',
      '개인 맞춤 의료/법률/금융 조언 금지.',
      '정량 수치 단정 금지. 출처 불명 수치 금지.',
      '반드시 본문 하단에 "업데이트: YYYY-MM-DD" 한 줄 포함.',
      '본문 마지막에 "<!-- RELATED_POSTS -->" 플레이스홀더를 반드시 포함.',
      'AI 생성 언급 금지.',
      `금지어: ${forbidden.join(', ')}`,
      shouldAddDisclaimer(keyword) ? '민감 주제 가능성이 있으므로 면책 문장을 한 단락 포함.' : '일반 정보 주제로 작성.'
    ].join('\n');

    let lastReason = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_KEYWORD; attempt += 1) {
      const prompt = attempt === 1 ? basePrompt : `${basePrompt}\n이전 결과 실패 이유: ${lastReason}\n실패 원인을 수정해 다시 작성하라.`;
      for (const provider of providerOrder) {
        let markdown = '';
        try {
          if (provider === 'gemini') {
            const timeout = GEMINI_TIMEOUT_MS + (attempt - 1) * 10000;
            markdown = await generateWithGemini(prompt, timeout);
          } else {
            if (!openaiClient) {
              lastReason = 'openai client unavailable';
              continue;
            }
            markdown = await generateWithOpenAi(prompt, openaiClient);
          }
        } catch (e) {
          lastReason = `[${provider}] ${e instanceof Error ? e.message : 'provider call failed'}`;
          continue;
        }

        if (!markdown) {
          lastReason = `[${provider}] empty output`;
          continue;
        }

        const normalized = normalizeDraft(markdown, keyword, baseSlug, today, nowKSTIso());
        normalized.parsed.content = sanitizeForbiddenText(normalized.parsed.content, forbidden);
        const sanitizedTitle = sanitizeForbiddenText(String(normalized.parsed.data.title ?? normalized.title ?? ''), forbidden);
        normalized.parsed.data.title = sanitizedTitle;
        const validation = validateNormalizedDraft(normalized.parsed.content, sanitizedTitle, forbidden);
        if (!validation.ok) {
          lastReason = `[${provider}] ${validation.reason}`;
          continue;
        }

        return {
          keyword,
          ok: true as const,
          provider,
          slug: normalized.slug,
          title: normalized.title,
          parsed: normalized.parsed
        };
      }

      if (attempt < MAX_ATTEMPTS_PER_KEYWORD && RETRY_BACKOFF_MS > 0) {
        await sleep(RETRY_BACKOFF_MS * attempt);
      }
    }

    return { keyword, ok: false as const, reason: lastReason || 'unknown' };
  }

  while (created.length < count && keywordQueue.length > 0) {
    const batch = keywordQueue.splice(0, ARTICLE_PARALLELISM);
    const candidates = await Promise.all(batch.map((keyword) => processKeyword(keyword)));

    for (const candidate of candidates) {
      if (created.length >= count) break;
      if (!candidate.ok) {
        console.log(`[article] skip keyword: ${candidate.keyword} (${candidate.reason})`);
        logLines.push(`skip: ${candidate.keyword} (${candidate.reason})`);
        continue;
      }

      const similarity = Math.max(...selectedTitles.map((t) => jaccardSimilarity(t, candidate.title)), 0);
      if (similarity >= TITLE_SIMILARITY_THRESHOLD) {
        logLines.push(`skip duplicate: ${candidate.keyword} (sim=${similarity.toFixed(2)})`);
        continue;
      }
      const candidateKeywordStem = topicStem(candidate.keyword);
      const candidateTitleStem = topicStem(candidate.title);
      if (
        (candidateKeywordStem && selectedTopicStems.has(candidateKeywordStem)) ||
        (candidateTitleStem && selectedTopicStems.has(candidateTitleStem))
      ) {
        logLines.push(
          `skip same-topic: ${candidate.keyword} (keywordStem=${candidateKeywordStem || '-'}, titleStem=${candidateTitleStem || '-'})`
        );
        continue;
      }
      candidate.parsed.data.slug = deriveUniqueSlug(candidate.slug, selectedSlugs);

      if (wordCount(candidate.parsed.content) < MIN_WORD_COUNT) {
        logLines.push(`skip short: ${candidate.keyword} (${wordCount(candidate.parsed.content)} < ${MIN_WORD_COUNT})`);
        continue;
      }
      if (countH2(candidate.parsed.content) < 4) {
        logLines.push(`skip weak-h2: ${candidate.keyword}`);
        continue;
      }
      if (countFaqItems(candidate.parsed.content) < 3) {
        logLines.push(`skip weak-faq: ${candidate.keyword}`);
        continue;
      }

      candidate.parsed.data.publishedAt = today;
      candidate.parsed.data.updatedAt = today;
      candidate.parsed.data.autoGenerated = true;

      const finalSlug = String(candidate.parsed.data.slug);
      const finalDoc = matter.stringify(candidate.parsed.content, candidate.parsed.data);
      const filePath = path.join(POSTS_DIR, `${finalSlug}.md`);
      await fs.writeFile(filePath, finalDoc, 'utf8');
      console.log(`[article] created: ${finalSlug} (provider=${candidate.provider})`);

      created.push(filePath);
      selectedTitles.push(candidate.title);
      selectedSlugs.add(finalSlug);
      if (candidateKeywordStem) selectedTopicStems.add(candidateKeywordStem);
      if (candidateTitleStem) selectedTopicStems.add(candidateTitleStem);
      logLines.push(`created: ${finalSlug} (provider=${candidate.provider})`);
    }
  }

  const logPath = path.join(LOG_DIR, `generate-${Date.now()}.log`);
  logLines.unshift(`provider-order: ${providerOrder.join(' -> ')}`);
  await fs.writeFile(logPath, logLines.join('\n'), 'utf8');
  await writeRunGeneratedPosts(created);
  console.log(`created articles: ${created.length}`);

  if (created.length === 0 && !ALLOW_FALLBACK) {
    throw new Error('No verified model-generated articles were created; fallback publishing is disabled');
  }

  if (created.length === 0) {
    const fallbackKeywords = rawKeywords.keywords
      .filter((k) => !isUnsafeTopic(k) && !isLowTrustKeyword(k))
      .slice(0, count);
    if (fallbackKeywords.length === 0) fallbackKeywords.push('오늘의 생활 정보');
    while (fallbackKeywords.length < count) {
      fallbackKeywords.push(`오늘의 생활 정보 ${fallbackKeywords.length + 1}`);
    }

    async function createFallbackArticle(fallbackKeyword: string) {
      const fallbackStem = topicStem(fallbackKeyword);
      if (fallbackStem && selectedTopicStems.has(fallbackStem)) {
        logLines.push(`skip fallback same-topic(recent): ${fallbackKeyword}`);
        return false;
      }
      const fallbackSlug = deriveUniqueSlug(slugify(`${fallbackKeyword} 가이드`) || 'daily-guide', selectedSlugs);
      const fallbackTitle = `${fallbackKeyword} 실무 가이드`;
      const fallbackDoc = matter.stringify(buildLocalFallbackBody(fallbackKeyword, todayKST()), {
        title: fallbackTitle,
        description: `${fallbackKeyword} 핵심 내용을 빠르게 확인할 수 있는 요약 가이드입니다.`,
        slug: fallbackSlug,
        publishedAt: nowKSTIso(),
        updatedAt: nowKSTIso(),
        tags: [fallbackKeyword, '가이드', '실무'],
        category: '종합',
        readingTimeMinutes: Math.max(8, Math.ceil(MIN_WORD_COUNT / 130)),
        autoGenerated: true
      });
      const fallbackPath = path.join(POSTS_DIR, `${fallbackSlug}.md`);
      await fs.writeFile(fallbackPath, fallbackDoc, 'utf8');
      created.push(fallbackPath);
      selectedSlugs.add(fallbackSlug);
      if (fallbackStem) selectedTopicStems.add(fallbackStem);
      return true;
    }

    for (const fallbackKeyword of fallbackKeywords) {
      if (created.length >= count) break;
      await createFallbackArticle(fallbackKeyword);
    }

    let fillIndex = 1;
    while (created.length < count) {
      const fillKeyword = `일상 관리 팁 ${fillIndex}`;
      const createdNow = await createFallbackArticle(fillKeyword);
      fillIndex += 1;
      if (!createdNow && fillIndex > 100) break;
    }
    await writeRunGeneratedPosts(created);
    logLines.push(`fallback-created: ${created.length}`);
    await fs.writeFile(logPath, logLines.join('\n'), 'utf8');
    console.log(`created articles: ${created.length} (fallback)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
