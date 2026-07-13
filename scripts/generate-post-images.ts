import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import matter from 'gray-matter';
import { LOG_DIR, POSTS_DIR, ensureDir, loadPostsFrontmatter, readRunGeneratedPosts } from './utils';

const OUT_DIR = path.join(process.cwd(), 'public/assets/posts');
const PROMPT_PATH = path.join(LOG_DIR, 'post-image-prompts.json');
const IMAGES_PER_POST = Number(process.env.IMAGES_PER_POST ?? '2');
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY ?? '').trim();
const GEMINI_PROMPT_MODEL = String(process.env.GEMINI_PROMPT_MODEL ?? 'gemini-2.5-flash').trim();
const TARGET_POST_SLUGS = new Set(
  String(process.env.TARGET_POST_SLUGS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
);

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
      // ignore
    }
  }
  return null;
}

async function generatePromptsWithGemini(title: string, description: string, excerpt: string) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required for image prompt generation');
  const prompt = [
    'Generate image prompts for a Korean news-style article.',
    'Return JSON only with this exact shape:',
    '{"prompts":["...", "..."]}',
    `Article title: ${title}`,
    `Article description: ${description || '(none)'}`,
    `Article excerpt: ${excerpt.slice(0, 800)}`,
    `Need exactly ${IMAGES_PER_POST} prompts.`,
    'Rules:',
    '- Write prompts in English only.',
    '- Each prompt must be specific to the article topic.',
    '- Photorealistic editorial style.',
    '- No text overlays, no logos, no watermark, no UI, no typography.',
    '- Avoid generic scene repetition.'
  ].join('\n');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_PROMPT_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 }
      })
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini prompt generation failed (${res.status}): ${body.slice(0, 240)}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
  const parsed = parseJsonObject(text);
  const prompts = Array.isArray(parsed?.prompts) ? parsed.prompts.map((v) => String(v).trim()).filter(Boolean) : [];
  if (prompts.length < IMAGES_PER_POST) {
    throw new Error(`Gemini returned insufficient prompts (${prompts.length}/${IMAGES_PER_POST})`);
  }
  return prompts.slice(0, IMAGES_PER_POST);
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
  let targets = posts.filter((row) => runFiles.has(row.file));
  if (TARGET_POST_SLUGS.size > 0) {
    targets = targets.filter((row) => TARGET_POST_SLUGS.has(String(row.data.slug ?? '').trim()));
  }

  if (targets.length === 0) {
    throw new Error('No target articles for image generation');
  }

  const prompts: PromptItem[] = [];
  for (const row of targets) {
    const slug = String(row.data.slug ?? '');
    const title = String(row.data.title ?? '').trim();
    const description = String(row.data.description ?? '').trim();
    if (!slug || !title) continue;
    console.log(`[image-prompt] generating via gemini: ${slug}`);
    const geminiPrompts = await generatePromptsWithGemini(title, description, row.content);
    for (let i = 1; i <= IMAGES_PER_POST; i += 1) {
      prompts.push({
        id: `${slug}-${i}`,
        prompt: geminiPrompts[i - 1] ?? geminiPrompts[0],
        size: '1024x768'
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
