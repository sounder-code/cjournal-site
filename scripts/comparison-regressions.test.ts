import test from 'node:test';
import assert from 'node:assert/strict';
import { commonMonthComparison } from '../src/lib/commonMonthComparison';
import { assertPublishedUrlsPreserved } from './publication-safety';
import { loadApartmentPageData, loadApartmentEntries, apartmentQualityReasons, householdBand } from '../src/lib/apartmentBulk';

test('direct comparison uses the latest common month, not latest individual bills', () => {
  const result = commonMonthComparison([
    { comparisonMonths: [['2026-06', 1000, 600, 100], ['2026-08', 9000, 8000, 100]] },
    { comparisonMonths: [['2026-06', 2000, 800, 100], ['2026-07', 3000, 900, 100]] }
  ]);
  assert.equal(result.month, '2026-06');
  assert.deepEqual(result.items.map((item) => item.tf), [1000, 2000]);
});

test('no common month or missing data never creates a ranking', () => {
  assert.equal(commonMonthComparison([{ comparisonMonths: [['2026-06', 1000, 600, 100]] }, { comparisonMonths: [] }]).month, null);
  assert.equal(commonMonthComparison([]).month, null);
});

test('URL preservation catches equal-count replacement, renaming and removal', () => {
  const old = [{ c: 'A1', s: 'old-a1', q: 1 }];
  assert.throws(() => assertPublishedUrlsPreserved(old, [{ c: 'A2', s: 'new-a2', q: 1 }]));
  assert.throws(() => assertPublishedUrlsPreserved(old, [{ c: 'A1', s: 'renamed-a1', q: 1 }]));
  assert.throws(() => assertPublishedUrlsPreserved(old, [{ c: 'A1', s: 'old-a1', q: 0 }]));
  assert.doesNotThrow(() => assertPublishedUrlsPreserved(old, [...old, { c: 'A2', s: 'new-a2', q: 1 }]));
});

test('restored Parkrio compares June to June; all published pages retain one-month cohorts', async () => {
  const [pages, entries] = await Promise.all([loadApartmentPageData(), loadApartmentEntries()]);
  const page = pages.find((page) => page.apartment.c === 'A13824006')!;
  assert.ok(page);
  const apartment = page.apartment;
  const peers = entries.filter((entry) => entry.q === 1 && entry.sd === apartment.sd && entry.sg === apartment.sg && householdBand(entry.h) === householdBand(apartment.h))
    .map((entry) => ({ entry, fee: entry.f.find((fee) => fee[0] === apartment.lm) }))
    .filter(({ entry, fee }) => fee && apartmentQualityReasons(entry, fee).length === 0);
  const values = peers.map(({ fee }) => fee![1]).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : Math.round((values[middle - 1] + values[middle]) / 2);
  assert.equal(page.peerMedianTotal, median);
  assert.equal(page.peerCount, peers.length);
  assert.ok(pages.every((page) => !page.comparisonEligible || page.peerCount >= 2));
});
