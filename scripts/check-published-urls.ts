import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { assertPublishedUrlsPreserved } from './publication-safety';

const base = process.env.PUBLICATION_BASE_SHA || 'HEAD';
if (/^0+$/.test(base)) throw new Error('기존 공개 URL을 비교할 기준 커밋이 필요합니다.');
const previous = JSON.parse(execFileSync('git', ['show', `${base}:public/data/apartments/index.json`], { maxBuffer: 32 * 1024 * 1024 }).toString());
const current = JSON.parse(await readFile('public/data/apartments/index.json', 'utf8'));
assertPublishedUrlsPreserved(previous, current);
console.log(`기존 공개 URL ${previous.filter((item: { q: number }) => item.q === 1).length}개 보존 확인`);
