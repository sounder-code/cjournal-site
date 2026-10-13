import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadApartmentPageData, loadApartmentEntries } from '../src/lib/apartmentBulk';

// Run after an unpacked local build; checks the shared template for every report.
const [pages, entries] = await Promise.all([loadApartmentPageData(), loadApartmentEntries()]);
const bySlug = new Map(entries.map((entry) => [entry.s, entry]));
for (const page of pages) {
  const apartment = page.apartment;
  const html = await readFile(`dist/apartments/${apartment.s}/index.html`, 'utf8');
  const faq = html.split('비교 순위는 어떻게 계산하나요?</summary>')[1]?.split('</details>')[0];
  assert.ok(faq, `${apartment.c}: missing FAQ`);
  if (!page.comparisonEligible) {
    assert.ok(!faq.includes('위이며'), `${apartment.c}: excluded ranking leaked into FAQ`);
    assert.ok(faq.includes('표시하지 않습니다'), `${apartment.c}: missing exclusion explanation`);
  }
  assert.equal((html.match(/공개 기간 중 가장 높았던 달은/g) || []).length, 1, apartment.c);
  assert.ok(html.includes('data-estimator-area-label'), `${apartment.c}: missing area label`);
  for (const neighbor of page.nearby) {
    const fee = bySlug.get(neighbor.s)?.f.find((fee) => fee[0] === apartment.lm);
    assert.equal(neighbor.tf, fee?.[1], `${apartment.c}: nearby comparison month mismatch`);
  }
}
console.log(`공통 리포트 문구·동일월 비교 검증: ${pages.length}개 통과`);
