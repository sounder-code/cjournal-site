import fs from 'node:fs/promises';
import path from 'node:path';
import { LOG_DIR, POSTS_DIR, ensureDir, loadPostsFrontmatter, readRunGeneratedPosts, wordCount } from './utils';

const forbiddenPath = path.join(process.cwd(), 'src/content/keywords/forbidden.txt');

type Result = {
  file: string;
  slug: string;
  title: string;
  score: number;
  passed: boolean;
  reasons: string[];
};

function todayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
}

function countH2(content: string) {
  return (content.match(/^##\s+/gm) ?? []).length;
}

function faqCount(content: string) {
  const faq = content.match(/##\s*FAQ[\s\S]*$/i)?.[0] ?? '';
  return (faq.match(/Q\d|\*\*Q|^-\s*Q[:.]/gim) ?? []).length;
}

const MIN_WORD_COUNT = Number(process.env.MIN_WORD_COUNT ?? '900');

async function main() {
  await ensureDir(LOG_DIR);
  await ensureDir(POSTS_DIR);

  const forbidden = (await fs.readFile(forbiddenPath, 'utf8'))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const posts = await loadPostsFrontmatter();
  const today = todayKST();
  const runFiles = new Set(await readRunGeneratedPosts());
  const targets = posts.filter((row) => runFiles.has(row.file));

  if (targets.length === 0) {
    throw new Error('No newly created articles in this run');
  }

  const slugCounts = new Map<string, number>();
  const titleCounts = new Map<string, number>();
  for (const row of posts) {
    const slug = String(row.data.slug ?? '');
    const title = String(row.data.title ?? '');
    if (slug) slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1);
    if (title) titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }
  const results: Result[] = [];

  for (const row of targets) {
    const { file, data, content } = row;
    const reasons: string[] = [];
    let score = 100;

    const wc = wordCount(content);
    if (wc < MIN_WORD_COUNT) {
      score -= 25;
      reasons.push(`wordCount ${wc} < ${MIN_WORD_COUNT}`);
    }

    const h2 = countH2(content);
    if (h2 < 4) {
      score -= 20;
      reasons.push(`H2 ${h2} < 4`);
    }

    const faq = faqCount(content);
    if (faq < 3) {
      score -= 20;
      reasons.push(`FAQ ${faq} < 3`);
    }

    const hitForbidden = forbidden.find((word) => content.includes(word) || String(data.title ?? '').includes(word));
    if (hitForbidden) {
      score -= 25;
      reasons.push(`forbidden word: ${hitForbidden}`);
    }

    const slug = String(data.slug ?? '');
    const title = String(data.title ?? '');

    if ((slugCounts.get(slug) ?? 0) > 1) {
      score -= 20;
      reasons.push('duplicate slug');
    }
    if ((titleCounts.get(title) ?? 0) > 1) {
      score -= 20;
      reasons.push('duplicate title');
    }

    results.push({
      file,
      slug,
      title,
      score: Math.max(0, score),
      passed: score >= 75,
      reasons
    });
  }

  results.sort((a, b) => b.score - a.score);
  const keep = results.filter((r) => r.passed).slice(0, 5);
  const keepSet = new Set(keep.map((r) => r.file));

  for (const row of results) {
    if (!keepSet.has(row.file)) {
      await fs.rm(row.file, { force: true });
    }
  }

  const report = {
    date: today,
    generated: targets.length,
    kept: keep.length,
    results
  };

  const reportPath = path.join(LOG_DIR, `quality-${Date.now()}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`quality keep: ${keep.length} / ${targets.length}`);

  if (keep.length === 0) {
    throw new Error('No article passed quality gate');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
