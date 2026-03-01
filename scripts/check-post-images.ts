import fs from 'node:fs/promises';
import path from 'node:path';
import { loadPostsFrontmatter, readRunGeneratedPosts } from './utils';

const MIN_IMAGES = Number(process.env.MIN_IMAGES_PER_POST ?? '3');
const MAX_IMAGES = Number(process.env.MAX_IMAGES_PER_POST ?? '5');

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const posts = await loadPostsFrontmatter();
  const runFiles = new Set(await readRunGeneratedPosts());
  const targets = posts.filter((row) => runFiles.has(row.file));

  if (targets.length === 0) {
    throw new Error('No newly created articles in this run');
  }

  const failures: string[] = [];

  for (const row of targets) {
    const slug = String(row.data.slug ?? '');
    if (!slug) continue;

    const markdownMatches = row.content.match(new RegExp(`/assets/posts/${slug}-\\d+\\.png`, 'g')) ?? [];
    const markdownCount = new Set(markdownMatches).size;

    let fileCount = 0;
    for (let i = 1; i <= MAX_IMAGES; i += 1) {
      const filePath = path.join(process.cwd(), 'public/assets/posts', `${slug}-${i}.png`);
      if (await exists(filePath)) fileCount += 1;
    }

    if (markdownCount < MIN_IMAGES || fileCount < MIN_IMAGES) {
      failures.push(`${slug}: markdown=${markdownCount}, files=${fileCount}, expected>=${MIN_IMAGES}`);
    }
  }

  if (failures.length > 0) {
    console.error('post image validation failed');
    for (const line of failures) console.error(`- ${line}`);
    process.exit(1);
  }

  console.log(`post image validation passed (${targets.length} posts)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
