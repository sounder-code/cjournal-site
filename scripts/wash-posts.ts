import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const POSTS_DIR = path.join(process.cwd(), 'src/content/posts');

const BROKEN_REPLACEMENTS: Array<[RegExp, string]> = [
  [/[정주장단]유의미한 개선인/g, '정기적인'],
  [/[정주장단]유의미한 개선으로/g, '정기적으로'],
  [/[정주장단]유의미한 개선/g, '정기 점검'],
  [/미 미치지/g, '미치지'],
];

function normalizeText(input: string): string {
  let out = input.replace(/\r\n/g, '\n');

  for (const [pattern, replacement] of BROKEN_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }

  // Remove noisy repeated memo blocks from malformed generations.
  out = out.replace(
    /(?:^|\n)(?:추가 점검 메모 \d+\..*(?:\n|$)){2,}/g,
    '\n'
  );

  // Remove exact duplicated adjacent headings.
  out = out.replace(
    /^(#{2,3}\s+.+)\n+([\s\S]*?)\n+\1\n+\2(?=\n|$)/gm,
    '$1\n\n$2'
  );

  // Normalize excessive separators and spacing.
  out = out.replace(/\n-{3,}\n-{3,}\n/g, '\n---\n');
  out = out.replace(/\n{3,}/g, '\n\n');

  return `${out.trim()}\n`;
}

function main() {
  const files = fs
    .readdirSync(POSTS_DIR)
    .filter((name) => name.endsWith('.md') && name !== '.gitkeep')
    .sort((a, b) => a.localeCompare(b, 'ko'));

  let changed = 0;
  for (const file of files) {
    const fullPath = path.join(POSTS_DIR, file);
    const raw = fs.readFileSync(fullPath, 'utf8');
    const parsed = matter(raw);
    const nextContent = normalizeText(parsed.content);
    if (nextContent === parsed.content) continue;
    const nextRaw = matter.stringify(nextContent, parsed.data, { lineWidth: 0 });
    fs.writeFileSync(fullPath, nextRaw, 'utf8');
    changed += 1;
    console.log(`washed: ${file}`);
  }

  console.log(`wash complete: changed ${changed}/${files.length}`);
}

main();
