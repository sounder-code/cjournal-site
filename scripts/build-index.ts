import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { LOG_DIR, POSTS_DIR, ensureDir, loadPostsFrontmatter } from './utils';

type PostItem = {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  category: string;
  publishedAt: string;
  updatedAt: string;
  mtimeMs: number;
  readingTimeMinutes: number;
};

function score(item: PostItem) {
  const updated = Date.parse(item.updatedAt ?? '');
  const published = Date.parse(item.publishedAt ?? '');
  const u = Number.isNaN(updated) ? 0 : updated;
  const p = Number.isNaN(published) ? 0 : published;
  const m = Number.isFinite(item.mtimeMs) ? item.mtimeMs : 0;
  return Math.max(u, p, m);
}

function related(current: PostItem, all: PostItem[]) {
  return all
    .filter((item) => item.slug !== current.slug)
    .map((item) => ({
      item,
      overlap: item.tags.filter((tag) => current.tags.includes(tag)).length
    }))
    .filter((row) => row.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || score(b.item) - score(a.item))
    .slice(0, 3)
    .map((row) => row.item);
}

async function main() {
  await ensureDir(LOG_DIR);
  await ensureDir(POSTS_DIR);

  const rows = await loadPostsFrontmatter();
  const posts: PostItem[] = (
    await Promise.all(
      rows.map(async ({ file, data }) => {
        const stat = await fs.stat(file);
        return {
          slug: String(data.slug ?? ''),
          title: String(data.title ?? ''),
          description: String(data.description ?? ''),
          tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
          category: String(data.category ?? ''),
          publishedAt: String(data.publishedAt ?? ''),
          updatedAt: String(data.updatedAt ?? ''),
          mtimeMs: stat.mtimeMs,
          readingTimeMinutes: Number(data.readingTimeMinutes ?? 1)
        };
      })
    )
  ).filter((post) => post.slug && post.title);

  const latest = [...posts].sort((a, b) => score(b) - score(a)).slice(0, 50);
  const tagCounts: Record<string, number> = {};
  for (const post of posts) {
    for (const tag of post.tags) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }
  }

  const relatedMap: Record<string, string[]> = {};
  for (const post of posts) {
    relatedMap[post.slug] = related(post, posts).map((p) => p.slug);
  }

  const outPath = path.join(process.cwd(), 'src/content/posts-index.json');
  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        latest,
        tagCounts,
        related: relatedMap
      },
      null,
      2
    ),
    'utf8'
  );

  for (const row of rows) {
    if (!row.content.includes('<!-- RELATED_POSTS -->')) continue;
    const slug = String(row.data.slug ?? '');
    const relSlugs = relatedMap[slug] ?? [];
    const links = relSlugs
      .map((target) => {
        const targetPost = posts.find((p) => p.slug === target);
        if (!targetPost) return '';
        return `- [${targetPost.title}](/posts/${targetPost.slug}/)`;
      })
      .filter(Boolean)
      .join('\n');

    const replacement = links
      ? `## Related posts\n\n${links}`
      : '## Related posts\n\n- 관련 글이 준비 중입니다.';

    const updatedContent = row.content.replace('<!-- RELATED_POSTS -->', replacement);
    const doc = matter.stringify(updatedContent, row.data as Record<string, any>);
    await fs.writeFile(row.file, doc, 'utf8');
  }

  const logPath = path.join(LOG_DIR, `build-index-${Date.now()}.log`);
  await fs.writeFile(logPath, `indexed posts: ${posts.length}\n`, 'utf8');
  console.log(`index built: ${posts.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
