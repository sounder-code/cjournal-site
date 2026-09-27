import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { loadApartmentManifest, loadApartmentPageData } from '../src/lib/apartmentBulk';
const [manifest, pages] = await Promise.all([loadApartmentManifest(), loadApartmentPageData()]);
const reports = new Map(pages.map((page) => [page.apartment.s, page]));
let checked = 0;
for (const district of manifest.districts || []) {
  const path = district.file.replace('/data/apartments/maps/', 'data/comparisons/');
  const items = JSON.parse(await readFile(resolve('dist', path), 'utf8'));
  for (const item of items) {
    checked++;
    const report = reports.get(item.s);
    assert.equal(Boolean(item.comparison), Boolean(report?.comparisonEligible), item.s);
    if (report?.comparisonEligible) {
      assert.equal(item.comparison.month, report.apartment.lm, item.s);
      assert.equal(item.comparison.count, report.peerCount, item.s);
      assert.equal(item.comparison.tf, report.percentiles.total, item.s);
      assert.equal(item.comparison.cf, report.percentiles.common, item.s);
      assert.ok(item.comparisonMonths.some((fee: [string, number]) => fee[0] === item.lm && fee[1] === item.tf), item.s);
    }
    if (!item.tf) assert.equal(item.comparison, null, item.s);
  }
}
assert.equal(checked, manifest.stats.complexes);
console.log(`지도·리포트 비교값 일치: ${checked}개 단지`);
