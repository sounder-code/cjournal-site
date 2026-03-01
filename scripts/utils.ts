import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

export const ROOT = process.cwd();
export const POSTS_DIR = path.join(ROOT, 'src/content/posts');
export const LOG_DIR = path.join(ROOT, 'logs');
export const RUN_GENERATED_POSTS_PATH = path.join(LOG_DIR, 'run-generated-posts.json');

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readLines(filePath: string): Promise<string[]> {
  const raw = await fs.readFile(filePath, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

export async function listPostFiles() {
  await ensureDir(POSTS_DIR);
  const files = await fs.readdir(POSTS_DIR);
  return files.filter((file) => file.endsWith('.md')).map((file) => path.join(POSTS_DIR, file));
}

export async function loadPostsFrontmatter() {
  const files = await listPostFiles();
  const rows: Array<{ file: string; data: Record<string, any>; content: string }> = [];
  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = matter(raw);
    rows.push({ file, data: parsed.data as Record<string, any>, content: parsed.content });
  }
  return rows;
}

export async function writeRunGeneratedPosts(files: string[]) {
  await ensureDir(LOG_DIR);
  await fs.writeFile(
    RUN_GENERATED_POSTS_PATH,
    JSON.stringify({ files, generatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

export async function readRunGeneratedPosts(): Promise<string[]> {
  try {
    const raw = await fs.readFile(RUN_GENERATED_POSTS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { files?: unknown };
    if (!Array.isArray(parsed.files)) return [];
    return parsed.files
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .map((file) => path.resolve(ROOT, file));
  } catch {
    return [];
  }
}

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function wordCount(text: string): number {
  const cleaned = text.replace(/[#>*`\-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 0;
  const spaceTokens = cleaned.split(' ').filter(Boolean).length;
  const koChars = (cleaned.match(/[가-힣]/g) ?? []).length;
  // Korean drafts often use fewer spaces; estimate "word-like" volume from Hangul length.
  const koEstimatedWords = Math.floor(koChars / 2);
  return Math.max(spaceTokens, koEstimatedWords);
}

export function tokenizeKo(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1)
  );
}

export function jaccardSimilarity(a: string, b: string): number {
  const sa = tokenizeKo(a);
  const sb = tokenizeKo(b);
  const union = new Set([...sa, ...sb]);
  let intersection = 0;
  for (const token of sa) {
    if (sb.has(token)) intersection += 1;
  }
  return union.size === 0 ? 0 : intersection / union.size;
}
