import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import matter from 'gray-matter';
import { LOG_DIR, POSTS_DIR, ensureDir, loadPostsFrontmatter, readRunGeneratedPosts } from './utils';

const OUT_DIR = path.join(process.cwd(), 'public/assets/posts');
const PROMPT_PATH = path.join(LOG_DIR, 'post-image-prompts.json');
const IMAGES_PER_POST = Number(process.env.IMAGES_PER_POST ?? '2');
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY ?? '').trim();
const GEMINI_API_BASE = String(process.env.GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com/v1beta').trim();
const GEMINI_TEXT_MODEL = String(process.env.GEMINI_TEXT_MODEL ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash').trim();
const GEMINI_TIMEOUT_MS = Math.max(5000, Number(process.env.GEMINI_TIMEOUT_MS ?? '25000'));

type PromptItem = {
  id: string;
  prompt: string;
  size: string;
};

function imageLine(slug: string, index: number, title: string) {
  return `![${title} 관련 이미지 ${index}](/assets/posts/${slug}-${index}.png)`;
}

function hasPostImage(content: string, slug: string, index: number) {
  return content.includes(`/assets/posts/${slug}-${index}.png`);
}

type TopicKind = 'productivity' | 'home' | 'travel' | 'health' | 'finance' | 'generic';

function detectTopic(title: string, description: string): TopicKind {
  const text = `${title} ${description}`.toLowerCase();
  if (/(메모|기록|목표|계획|집중|시간\s*관리|업무|회의|루틴|생산성)/.test(text)) return 'productivity';
  if (/(실내|환기|청소|수납|집|가정|주방|생활)/.test(text)) return 'home';
  if (/(여행|공항|숙소|짐|체크리스트)/.test(text)) return 'travel';
  if (/(수면|건강|운동|식단|위생)/.test(text)) return 'health';
  if (/(예산|가계부|비용|절약|구독|지출|가격|요금)/.test(text)) return 'finance';
  return 'generic';
}

function pickScene(topic: TopicKind, index: number) {
  const scenesByTopic: Record<TopicKind, string[]> = {
    productivity: [
      'hands arranging blank index cards on a clean desk, natural daylight, no writing visible',
      'blank notebook and pen on a wooden desk with a simple cup, tidy workspace, no visible text',
      'minimal workspace with closed laptop, notebook closed, soft side light, no labels or screens'
    ],
    home: [
      'open window with sheer curtains and indoor plants, bright natural light, calm interior',
      'neat living room corner with folded fabrics and simple storage boxes without labels',
      'kitchen counter with plain containers and clean sink area, no packaging or text'
    ],
    travel: [
      'packed suitcase with plain clothing and travel pouches without logos, clean hotel room light',
      'flat lay of travel essentials in plain cases and bottles with no labels',
      'airport-style waiting area scene focused on luggage silhouette and window light, no signs visible'
    ],
    health: [
      'cozy bedroom with neatly arranged bedding and soft morning light, no printed materials',
      'yoga mat and water glass in a minimal room, no brand marks or labels',
      'clean bathroom shelf with plain towels and unlabeled containers'
    ],
    finance: [
      'person organizing plain envelopes and blank paper cards on a desk, no writing visible',
      'simple home desk scene with calculator turned away and blank notebook closed',
      'minimal planning setup with plain folders and divider trays, no text or numbers visible'
    ],
    generic: [
      'minimal interior with natural light and clean composition, no objects with writing',
      'plain tabletop still life with ceramic cup and fruit bowl, no labels or packaging',
      'calm room corner with chair, curtain, and shadow pattern, no screens or signs'
    ]
  };
  const scenes = scenesByTopic[topic];
  return scenes[(Math.max(1, index) - 1) % scenes.length];
}

function buildPrompt(title: string, description: string, index: number) {
  const topic = detectTopic(title, description);
  const scene = pickScene(topic, index);
  return [
    `Create a realistic photo.`,
    `Concept: ${title}.`,
    `Context: ${description}.`,
    `Topic style: ${topic}.`,
    `Scene: ${scene}.`,
    `STRICT CONTENT RULES: choose objects that naturally have no writing.`,
    `Do not include screens, posters, signs, books, newspapers, packages, keyboard, remote controls, dashboards, appliances, devices, or any product labels.`,
    `STRICT NEGATIVE RULES: no text, no letters, no numbers, no symbols, no logo, no watermark, no caption, no title card, no subtitle, no UI mockup, no poster layout, no banner layout, no infographic, no signage, no labels.`,
    `Korean/English text must not appear anywhere in the image.`,
    `Style: natural daylight photography, clean composition, muted colors, 16:9 landscape.`
  ].join('\n');
}

function extractGeminiText(json: any): string {
  const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
  for (const c of candidates) {
    const parts = Array.isArray(c?.content?.parts) ? c.content.parts : [];
    const text = parts.map((p: any) => String(p?.text ?? '')).join('').trim();
    if (text) return text;
  }
  return '';
}

async function buildPromptViaGemini(title: string, description: string, index: number) {
  const topic = detectTopic(title, description);
  const scene = pickScene(topic, index);
  const fallbackPrompt = buildPrompt(title, description, index);
  if (!GEMINI_API_KEY) return fallbackPrompt;

  const instruction = [
    'Write one high-quality image generation prompt in English for a photorealistic editorial image.',
    `Article title: ${title}`,
    `Article summary: ${description}`,
    `Topic kind: ${topic}`,
    `Preferred scene direction: ${scene}`,
    'Hard constraints:',
    '- Keep strong relevance to the article topic and practical context.',
    '- No text, letters, numbers, logos, watermarks, labels, signs, UI, screens, documents, packaging.',
    '- Avoid objects likely to include writing.',
    '- Natural composition and realistic lighting.',
    'Output only the prompt text with no markdown, no explanations.',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(GEMINI_TEXT_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: instruction }] }],
        generationConfig: { temperature: 0.4 }
      }),
      signal: controller.signal
    });
    if (!res.ok) return fallbackPrompt;
    const json = await res.json();
    const prompt = extractGeminiText(json);
    if (!prompt) return fallbackPrompt;
    return prompt;
  } catch {
    return fallbackPrompt;
  } finally {
    clearTimeout(timer);
  }
}

function insertImages(content: string, slug: string, title: string) {
  let updated = content;
  const missing: number[] = [];

  for (let i = 1; i <= IMAGES_PER_POST; i += 1) {
    if (!hasPostImage(updated, slug, i)) missing.push(i);
  }
  if (!missing.length) return updated;

  const headingMatches = [...updated.matchAll(/^##\s+.+$/gm)];
  if (headingMatches.length > 0) {
    const selectedHeadingIdx: number[] = [];
    for (let i = 0; i < missing.length; i += 1) {
      const ratio = (i + 1) / (missing.length + 1);
      let idx = Math.min(headingMatches.length - 1, Math.max(0, Math.floor(ratio * headingMatches.length)));
      if (selectedHeadingIdx.length > 0) {
        idx = Math.max(idx, selectedHeadingIdx[selectedHeadingIdx.length - 1] + 1);
      }
      idx = Math.min(idx, headingMatches.length - 1);
      selectedHeadingIdx.push(idx);
    }

    const insertions = missing
      .map((imageIdx, i) => ({
        imageIdx,
        pos: headingMatches[selectedHeadingIdx[i]]?.index ?? -1
      }))
      .filter((row) => row.pos >= 0)
      .sort((a, b) => b.pos - a.pos);

    for (const row of insertions) {
      updated = `${updated.slice(0, row.pos).trimEnd()}\n\n${imageLine(slug, row.imageIdx, title)}\n\n${updated.slice(row.pos)}`;
    }
  } else {
    for (const imageIdx of missing) {
      updated = `${updated.trimEnd()}\n\n${imageLine(slug, imageIdx, title)}\n`;
    }
  }

  return updated;
}

async function runNodeScript(scriptPath: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`image generator exited with code ${code}`));
    });
  });
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function backfillMissingImages(slug: string) {
  const existing: string[] = [];
  const missing: string[] = [];
  for (let i = 1; i <= IMAGES_PER_POST; i += 1) {
    const imagePath = path.join(OUT_DIR, `${slug}-${i}.png`);
    if (await fileExists(imagePath)) existing.push(imagePath);
    else missing.push(imagePath);
  }
  if (existing.length === 0 || missing.length === 0) return 0;

  let filled = 0;
  for (const target of missing) {
    await fs.copyFile(existing[0], target);
    filled += 1;
  }
  return filled;
}

async function main() {
  await ensureDir(LOG_DIR);
  await ensureDir(POSTS_DIR);
  await ensureDir(OUT_DIR);

  const posts = await loadPostsFrontmatter();
  const runFiles = new Set(await readRunGeneratedPosts());
  const targets = posts.filter((row) => runFiles.has(row.file));

  if (targets.length === 0) {
    throw new Error('No newly created articles in this run');
  }

  const prompts: PromptItem[] = [];
  for (const row of targets) {
    const slug = String(row.data.slug ?? '');
    const title = String(row.data.title ?? '').trim();
    const description = String(row.data.description ?? '').trim();
    if (!slug || !title) continue;
    for (let i = 1; i <= IMAGES_PER_POST; i += 1) {
      const prompt = await buildPromptViaGemini(title, description, i);
      prompts.push({
        id: `${slug}-${i}`,
        prompt,
        size: '1536x1024'
      });
    }
  }

  await fs.writeFile(PROMPT_PATH, JSON.stringify(prompts, null, 2), 'utf8');
  let generationFailed = false;
  try {
    await runNodeScript(path.join(process.cwd(), 'scripts/generate-nanobanana-images.mjs'), [PROMPT_PATH, OUT_DIR]);
  } catch (error) {
    generationFailed = true;
    console.warn(`[warn] image generator step failed, trying backfill: ${error instanceof Error ? error.message : String(error)}`);
  }

  let backfilled = 0;
  for (const row of targets) {
    const slug = String(row.data.slug ?? '');
    if (!slug) continue;
    backfilled += await backfillMissingImages(slug);
  }
  if (backfilled > 0) console.log(`backfilled missing images: ${backfilled}`);
  if (generationFailed) {
    console.log('continue after generator failure; final image integrity will be checked by check:images');
  }

  for (const row of targets) {
    const slug = String(row.data.slug ?? '');
    const title = String(row.data.title ?? '').trim();
    if (!slug || !title) continue;
    const nextContent = insertImages(row.content, slug, title);
    if (nextContent === row.content) continue;
    const updatedDoc = matter.stringify(nextContent, row.data);
    await fs.writeFile(row.file, updatedDoc, 'utf8');
  }

  console.log(`generated and attached images: posts=${targets.length}, perPost=${IMAGES_PER_POST}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
