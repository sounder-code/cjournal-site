import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import OpenAI from 'openai';
import { isUnsafeTopic, shouldAddDisclaimer } from './policy';
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

async function readForbidden() {
  const raw = await fs.readFile(forbiddenPath, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function countH2(content: string) {
  return (content.match(/^##\s+/gm) ?? []).length;
}

function countFaqItems(content: string) {
  const faq = content.match(/##\s*FAQ[\s\S]*$/i)?.[0] ?? '';
  return (faq.match(/Q\d|^\s*-\s*Q[:.]|^\s*\*\*Q/gi) ?? []).length;
}

const MIN_WORD_COUNT = Number(process.env.MIN_WORD_COUNT ?? '900');
const ARTICLE_PARALLELISM = Math.max(1, Number(process.env.ARTICLE_PARALLELISM ?? '3'));
const MAX_ATTEMPTS_PER_KEYWORD = Math.max(1, Number(process.env.ARTICLE_MAX_ATTEMPTS ?? '1'));
const TITLE_SIMILARITY_THRESHOLD = Number(process.env.TITLE_SIMILARITY_THRESHOLD ?? '0.9');
const GEMINI_TIMEOUT_MS = Math.max(5000, Number(process.env.GEMINI_TIMEOUT_MS ?? '25000'));

type Provider = 'gemini' | 'openai';

function selectProvider(): Provider {
  const preferred = (process.env.ARTICLE_PROVIDER ?? 'auto').toLowerCase();
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);

  if (preferred === 'gemini' && hasGemini) return 'gemini';
  if (preferred === 'openai' && hasOpenAI) return 'openai';

  // auto: prefer Gemini first for this project
  if (hasGemini) return 'gemini';
  if (hasOpenAI) return 'openai';
  throw new Error('Either GEMINI_API_KEY or OPENAI_API_KEY is required');
}

async function generateWithGemini(prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is required');
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
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

function extractTitleFromContent(content: string, fallback: string) {
  const h1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (h1) return h1;
  const h2 = content.match(/^##\s+(.+)$/m)?.[1]?.trim();
  if (h2) return h2;
  return fallback;
}

function normalizeContent(content: string, keyword: string, today: string) {
  let next = content
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  if (!next) next = `${keyword}에 대한 기본 정보를 정리합니다.`;

  while (countH2(next) < 4) {
    const index = countH2(next) + 1;
    next += `\n\n## 핵심 포인트 ${index}\n${keyword}와 관련된 핵심 개념을 일상/업무 관점에서 정리합니다. 선택 기준, 준비 단계, 실행 순서, 점검 포인트를 차례대로 확인하면 시행착오를 줄일 수 있습니다. 확실하지 않음이 포함된 정보는 단정하지 않고 조건을 분리해 이해하는 것이 중요합니다.`;
  }

  if (countFaqItems(next) < 3) {
    next += `\n\n## FAQ\nQ1. ${keyword}를 시작할 때 무엇부터 점검해야 하나요?\nA1. 현재 상황, 목표, 제약 조건을 먼저 정리한 뒤 작은 단위로 적용하는 것이 좋습니다.\n\nQ2. 효과를 빠르게 확인하는 방법이 있나요?\nA2. 단기 지표 하나만 정해 일주일 단위로 비교하면 변화 여부를 파악하기 쉽습니다.\n\nQ3. 정보가 충돌하면 어떻게 판단하나요?\nA3. 출처와 맥락을 확인하고, 확실하지 않음인 정보는 보수적으로 해석하는 것이 안전합니다.`;
  }

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

function normalizeDraft(markdown: string, keyword: string, baseSlug: string, today: string) {
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
    publishedAt: today,
    updatedAt: today,
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

function deriveUniqueSlug(baseSlug: string, usedSlugs: Set<string>) {
  if (!usedSlugs.has(baseSlug)) return baseSlug;
  let idx = 2;
  while (usedSlugs.has(`${baseSlug}-${idx}`)) idx += 1;
  return `${baseSlug}-${idx}`;
}

function buildLocalFallbackBody(keyword: string, today: string) {
  const sections = [
    '핵심 개념 정리',
    '적용 전 체크리스트',
    '실행 단계',
    '점검과 개선',
    '자주 발생하는 실수'
  ];

  let content = `${keyword}를 빠르게 이해하고 실무에 적용할 수 있도록 핵심 포인트를 정리합니다. 단정이 어려운 정보는 확실하지 않음으로 구분해 판단하는 방식이 안정적입니다.`;

  for (const section of sections) {
    content += `\n\n## ${section}\n${keyword}를 다룰 때는 준비-실행-점검 흐름으로 접근하는 것이 좋습니다. 먼저 현재 상태를 기록하고 우선순위를 명확히 한 뒤, 작은 단위로 실행하고 결과를 비교해야 시행착오를 줄일 수 있습니다. 이 과정에서 즉시 판단이 어려운 요소는 확실하지 않음으로 표시하고 추후 확인하는 절차를 둬야 품질이 유지됩니다. 또한 동일한 방식만 반복하지 말고 상황에 맞게 도구, 시간, 범위를 조정해야 합니다.`
      + ` 실무에서는 기록이 매우 중요합니다. 시작 시점과 종료 시점, 변경한 항목, 관찰된 결과를 함께 남기면 다음 사이클의 의사결정 속도가 빨라집니다.`;
  }

  content += `\n\n## FAQ\nQ1. ${keyword}를 처음 시작할 때 가장 중요한 기준은 무엇인가요?\nA1. 목표와 제약을 동시에 정리하고, 실행 범위를 작게 시작하는 기준이 가장 중요합니다.\n\nQ2. 빠르게 성과를 확인하려면 어떻게 해야 하나요?\nA2. 단일 지표를 정해 짧은 주기로 비교하면 변화 여부를 명확히 파악할 수 있습니다.\n\nQ3. 정보가 서로 다를 때는 어떻게 판단하나요?\nA3. 출처와 시점을 먼저 확인하고, 확실하지 않음인 정보는 단정하지 않는 방식이 안전합니다.`;
  content += `\n\n업데이트: ${today}\n\n<!-- RELATED_POSTS -->`;

  while (wordCount(content) < MIN_WORD_COUNT) {
    content += `\n\n## 실행 사례 확장\n${keyword} 관련 실행 사례를 정리할 때는 배경, 행동, 결과, 개선점 순서로 기록하는 것이 좋습니다. 특히 같은 조건에서 반복했을 때 재현 가능한지 확인해야 신뢰도가 올라갑니다.`;
  }

  return content.trim();
}

async function main() {
  await ensureDir(POSTS_DIR);
  await ensureDir(LOG_DIR);

  const rawKeywords = JSON.parse(await fs.readFile(todayPath, 'utf8')) as { keywords: string[] };
  const count = Number(process.env.ARTICLE_COUNT ?? '10');
  const forbidden = await readForbidden();

  const existing = await loadPostsFrontmatter();
  const existingTitles = existing.map((row) => String(row.data.title ?? ''));
  const existingSlugs = new Set(existing.map((row) => String(row.data.slug ?? '')));

  const provider = selectProvider();
  const openaiClient =
    provider === 'openai'
      ? new OpenAI({
          apiKey: process.env.OPENAI_API_KEY,
          timeout: Math.max(5000, Number(process.env.OPENAI_TIMEOUT_MS ?? '25000'))
        })
      : null;
  const created: string[] = [];
  const logLines: string[] = [];
  const selectedTitles: string[] = [...existingTitles];
  const selectedSlugs = new Set(existingSlugs);
  const keywordQueue = [...rawKeywords.keywords];

  async function processKeyword(keyword: string) {
    if (isUnsafeTopic(keyword)) return { keyword, ok: false as const, reason: 'unsafe keyword' };

    const baseSlug = slugify(keyword);
    if (!baseSlug) return { keyword, ok: false as const, reason: 'invalid slug keyword' };

    const basePrompt = [
      '한국어 정보형 기사 본문만 Markdown으로 작성하라. frontmatter는 쓰지 마라.',
      `키워드: ${keyword}`,
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
      let markdown = '';
      try {
        if (provider === 'gemini') {
          markdown = await generateWithGemini(prompt);
        } else {
          const response = await openaiClient!.responses.create({
            model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
            temperature: 0.7,
            input: prompt
          });
          markdown = response.output_text?.trim() ?? '';
        }
      } catch (e) {
        lastReason = e instanceof Error ? e.message : 'provider call failed';
        continue;
      }

      if (!markdown) {
        lastReason = 'empty output';
        continue;
      }

      const normalized = normalizeDraft(markdown, keyword, baseSlug, todayKST());
      const validation = validateNormalizedDraft(normalized.parsed.content, normalized.title, forbidden);
      if (!validation.ok) {
        lastReason = validation.reason;
        continue;
      }

      return { keyword, ok: true as const, slug: normalized.slug, title: normalized.title, parsed: normalized.parsed };
    }

    return { keyword, ok: false as const, reason: lastReason || 'unknown' };
  }

  while (created.length < count && keywordQueue.length > 0) {
    const batch = keywordQueue.splice(0, ARTICLE_PARALLELISM);
    const candidates = await Promise.all(batch.map((keyword) => processKeyword(keyword)));

    for (const candidate of candidates) {
      if (created.length >= count) break;
      if (!candidate.ok) {
        logLines.push(`skip: ${candidate.keyword} (${candidate.reason})`);
        continue;
      }

      const similarity = Math.max(...selectedTitles.map((t) => jaccardSimilarity(t, candidate.title)), 0);
      if (similarity >= TITLE_SIMILARITY_THRESHOLD) {
        logLines.push(`skip duplicate: ${candidate.keyword} (sim=${similarity.toFixed(2)})`);
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

      candidate.parsed.data.publishedAt = todayKST();
      candidate.parsed.data.updatedAt = todayKST();
      candidate.parsed.data.autoGenerated = true;

      const finalSlug = String(candidate.parsed.data.slug);
      const finalDoc = matter.stringify(candidate.parsed.content, candidate.parsed.data);
      const filePath = path.join(POSTS_DIR, `${finalSlug}.md`);
      await fs.writeFile(filePath, finalDoc, 'utf8');

      created.push(filePath);
      selectedTitles.push(candidate.title);
      selectedSlugs.add(finalSlug);
      logLines.push(`created: ${finalSlug}`);
    }
  }

  const logPath = path.join(LOG_DIR, `generate-${Date.now()}.log`);
  logLines.unshift(`provider: ${provider}`);
  await fs.writeFile(logPath, logLines.join('\n'), 'utf8');
  await writeRunGeneratedPosts(created);
  console.log(`created articles: ${created.length}`);

  if (created.length === 0) {
    const fallbackKeyword = rawKeywords.keywords.find((k) => !isUnsafeTopic(k)) ?? '오늘의 생활 정보';
    const fallbackSlug = deriveUniqueSlug(slugify(`${fallbackKeyword} 가이드`) || 'daily-guide', selectedSlugs);
    const fallbackTitle = `${fallbackKeyword} 실무 가이드`;
    const fallbackDoc = matter.stringify(buildLocalFallbackBody(fallbackKeyword, todayKST()), {
      title: fallbackTitle,
      description: `${fallbackKeyword} 핵심 내용을 빠르게 확인할 수 있는 요약 가이드입니다.`,
      slug: fallbackSlug,
      publishedAt: todayKST(),
      updatedAt: todayKST(),
      tags: [fallbackKeyword, '가이드', '실무'],
      category: '종합',
      readingTimeMinutes: Math.max(8, Math.ceil(MIN_WORD_COUNT / 130)),
      autoGenerated: true
    });
    const fallbackPath = path.join(POSTS_DIR, `${fallbackSlug}.md`);
    await fs.writeFile(fallbackPath, fallbackDoc, 'utf8');
    created.push(fallbackPath);
    await writeRunGeneratedPosts(created);
    logLines.push(`fallback-created: ${fallbackSlug}`);
    await fs.writeFile(logPath, logLines.join('\n'), 'utf8');
    console.log(`created articles: ${created.length} (fallback)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
