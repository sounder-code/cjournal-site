import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadApartmentManifest, loadApartmentPageData } from '../src/lib/apartmentBulk';

const [manifest, pages, index] = await Promise.all([
  loadApartmentManifest(),
  loadApartmentPageData(),
  readFile(resolve('public/data/apartments/index.json'), 'utf8').then((text) => JSON.parse(text) as Array<{ c: string; s: string; q: number }>)
]);

const errors: string[] = [];
const assert = (condition: boolean, message: string) => {
  if (!condition) errors.push(message);
};

const slugs = new Set(pages.map(({ apartment }) => apartment.s));
const titles = pages.map(({ apartment, titleSuffix }) => `${apartment.n}|${titleSuffix}`);
const publishedIndex = index.filter((item) => item.q === 1);

assert(pages.length === manifest.stats.publishableComplexes, '매니페스트 상세 페이지 수 불일치');
assert(slugs.size === pages.length, '상세 페이지 슬러그 중복');
assert(new Set(titles).size === titles.length, '검색 제목 조합 중복');
assert(publishedIndex.length === pages.length, '전국 인덱스 상세 링크 수 불일치');
assert(publishedIndex.every((item) => slugs.has(item.s)), '인덱스가 존재하지 않는 상세 페이지를 가리킴');

for (const page of pages) {
  const { apartment, nearby, peerCount, percentiles } = page;
  assert(apartment.f.length >= 4, `${apartment.c}: 공개월 부족`);
  assert(apartment.f.every((fee, index) => index === 0 || fee[0] > apartment.f[index - 1][0]), `${apartment.c}: 발생월 정렬 오류`);
  assert(peerCount >= 2, `${apartment.c}: 비교군 부족`);
  assert(Object.values(percentiles).every((value) => value >= 1 && value <= 99), `${apartment.c}: 백분위 범위 오류`);
  assert(nearby.every((item) => slugs.has(item.s)), `${apartment.c}: 관련 단지 링크 오류`);
}

if (errors.length) {
  console.error(errors.slice(0, 30).join('\n'));
  throw new Error(`단지 상세 페이지 품질 검사 실패: ${errors.length}건`);
}

console.log(`품질 검사 완료: 상세 페이지 ${pages.length.toLocaleString('ko-KR')}개, 내부 링크 및 검색 제목 정상`);
