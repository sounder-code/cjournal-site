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
const MAX_ATTEMPTS_PER_KEYWORD = Math.max(1, Number(process.env.ARTICLE_MAX_ATTEMPTS ?? '2'));

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

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7 }
    })
  });

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

function validateDraftLight(
  markdown: string,
  forbidden: string[],
  baseSlug: string
) {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(markdown);
  } catch {
    return { ok: false as const, reason: 'invalid frontmatter' };
  }

  const title = String(parsed.data.title ?? '').trim();
  const description = String(parsed.data.description ?? '').trim();
  const tags = Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [];
  const category = String(parsed.data.category ?? '').trim();
  const readingTime = Number(parsed.data.readingTimeMinutes ?? 0);
  const slug = slugify(String(parsed.data.slug ?? baseSlug)) || baseSlug;
  const content = parsed.content;

  if (!title || !description || !tags.length || !category || !Number.isFinite(readingTime) || readingTime <= 0) {
    return { ok: false as const, reason: 'missing required frontmatter fields' };
  }

  // Keep generation-stage validation light for throughput.
  if (!/업데이트:\s*\d{4}-\d{2}-\d{2}/.test(content)) return { ok: false as const, reason: 'missing update line' };
  if (!content.includes('<!-- RELATED_POSTS -->')) return { ok: false as const, reason: 'missing related placeholder' };
  if (/(AI가|인공지능이|생성형\s*AI|GPT|ChatGPT)/i.test(content)) {
    return { ok: false as const, reason: 'mentions AI generation' };
  }

  const hitForbidden = forbidden.find((word) => `${title}\n${content}`.includes(word));
  if (hitForbidden) {
    return { ok: false as const, reason: `forbidden word: ${hitForbidden}` };
  }

  return { ok: true as const, parsed, slug, title };
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
  const openaiClient = provider === 'openai' ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
  const created: string[] = [];
  const logLines: string[] = [];
  const selectedTitles: string[] = [...existingTitles];
  const selectedSlugs = new Set(existingSlugs);
  const keywordQueue = [...rawKeywords.keywords];

  async function processKeyword(keyword: string) {
    if (isUnsafeTopic(keyword)) return { keyword, ok: false as const, reason: 'unsafe keyword' };

    const baseSlug = slugify(keyword);
    if (!baseSlug) return { keyword, ok: false as const, reason: 'invalid slug keyword' };
    if (selectedSlugs.has(baseSlug)) return { keyword, ok: false as const, reason: 'duplicate slug keyword' };

    const basePrompt = [
      '한국어 정보형 블로그 글을 Markdown으로 작성하라.',
      `키워드: ${keyword}`,
      '필수 frontmatter: title, description, slug, publishedAt, updatedAt, tags, category, readingTimeMinutes, autoGenerated.',
      `publishedAt/updatedAt는 ${todayKST()}로 작성.`,
      '본문 규칙: 도입 1개, H2 4~6개(필수), H3 선택, FAQ 섹션에서 Q&A 3개 포함.',
      '최소 1200단어 이상.',
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

      const result = validateDraftLight(markdown, forbidden, baseSlug);
      if (!result.ok) {
        lastReason = result.reason;
        continue;
      }

      return { keyword, ok: true as const, slug: result.slug, title: result.title, parsed: result.parsed };
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
      if (similarity >= 0.7 || selectedSlugs.has(candidate.slug)) {
        logLines.push(`skip duplicate: ${candidate.keyword} (sim=${similarity.toFixed(2)}, slug=${candidate.slug})`);
        continue;
      }

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

      candidate.parsed.data.slug = candidate.slug;
      candidate.parsed.data.publishedAt = todayKST();
      candidate.parsed.data.updatedAt = todayKST();
      candidate.parsed.data.autoGenerated = true;

      const finalDoc = matter.stringify(candidate.parsed.content, candidate.parsed.data);
      const filePath = path.join(POSTS_DIR, `${candidate.slug}.md`);
      await fs.writeFile(filePath, finalDoc, 'utf8');

      created.push(filePath);
      selectedTitles.push(candidate.title);
      selectedSlugs.add(candidate.slug);
      logLines.push(`created: ${candidate.slug}`);
    }
  }

  const logPath = path.join(LOG_DIR, `generate-${Date.now()}.log`);
  logLines.unshift(`provider: ${provider}`);
  await fs.writeFile(logPath, logLines.join('\n'), 'utf8');
  await writeRunGeneratedPosts(created);
  console.log(`created articles: ${created.length}`);

  if (created.length === 0) {
    throw new Error('No newly created articles in this run');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
