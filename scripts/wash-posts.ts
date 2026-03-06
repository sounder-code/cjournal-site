import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const POSTS_DIR = path.join(process.cwd(), 'src/content/posts');

const BROKEN_REPLACEMENTS: Array<[RegExp, string]> = [
  [/[정주장단]유의미한 개선인/g, '정기적인'],
  [/[정주장단]유의미한 개선으로/g, '정기적으로'],
  [/[정주장단]유의미한 개선/g, '정기 점검'],
  [/미 미치지/g, '미치지'],
  [/영향을 미 미칠/g, '영향을 미칠'],
  [/영향을 미 미치/g, '영향을 미치'],
  [/추천를/g, '추천을'],
  [/요금를/g, '요금을'],
  [/비용를/g, '비용을'],
];

const DESCRIPTION_PATTERNS = [
  '{topic} 관련 핵심을 빠르게 정리해 실무에 바로 적용할 수 있도록 구성했습니다.',
  '{topic} 관련 내용을 처음 보는 독자도 이해할 수 있도록 개념, 사례, 체크포인트를 압축했습니다.',
  '{topic}에서 중요한 결정 포인트를 중심으로 실제 활용 방법까지 정리했습니다.',
  '{topic} 관련 내용을 실전 관점에서 풀어보고, 바로 써먹을 수 있는 점검 항목을 담았습니다.',
  '{topic}의 기본 구조부터 리스크 포인트까지 한 번에 확인할 수 있도록 정리했습니다.',
  '{topic} 관련 실행 단계를 중심으로 설명하고, 놓치기 쉬운 함정까지 함께 짚었습니다.',
];

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

function rewriteDescription(topic: string, seedKey: string): string {
  const idx = hashSeed(seedKey) % DESCRIPTION_PATTERNS.length;
  return DESCRIPTION_PATTERNS[idx].replace('{topic}', topic);
}

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

function normalizeInlineText(input: string): string {
  let out = input;
  for (const [pattern, replacement] of BROKEN_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out.trim();
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
    const nextData = { ...parsed.data } as Record<string, unknown>;
    const currentDescription = normalizeInlineText(String(nextData.description ?? ''));
    const genericDescriptionPattern =
      /의 핵심 개념과 적용 방법, 점검 포인트를 정리한 실무형 안내서입니다\.$/;
    const priorWashPattern =
      /(핵심만 빠르게 정리해|관련 내용을 처음 보는 독자도 이해할 수 있도록|중요한 결정 포인트를 중심으로|실전 관점에서 풀어보고|기본 구조부터 리스크 포인트까지|실행 단계 중심으로 설명하고)/;
    const shouldRewriteDescription =
      genericDescriptionPattern.test(currentDescription) || priorWashPattern.test(currentDescription);
    if (shouldRewriteDescription) {
      const tags = Array.isArray(nextData.tags) ? nextData.tags.map((v) => String(v)) : [];
      const topic =
        (tags[0] && tags[0] !== '가이드' && tags[0] !== '실무' ? tags[0] : '') ||
        (genericDescriptionPattern.test(currentDescription)
          ? String(currentDescription).replace(genericDescriptionPattern, '').trim()
          : String(nextData.title ?? nextData.slug ?? file).trim());
      const seed = String(nextData.slug ?? file);
      nextData.description = rewriteDescription(topic, seed);
    } else if (currentDescription) {
      nextData.description = currentDescription;
    }

    const dataChanged = JSON.stringify(nextData) !== JSON.stringify(parsed.data);
    const contentChanged = nextContent !== parsed.content;
    if (!contentChanged && !dataChanged) continue;

    const nextRaw = matter.stringify(nextContent, nextData, { lineWidth: 0 });
    fs.writeFileSync(fullPath, nextRaw, 'utf8');
    changed += 1;
    console.log(`washed: ${file}`);
  }

  console.log(`wash complete: changed ${changed}/${files.length}`);
}

main();
