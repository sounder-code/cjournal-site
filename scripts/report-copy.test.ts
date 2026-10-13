import test from 'node:test';
import assert from 'node:assert/strict';
import { apartmentReportDescription, hasPriorCalendarMonth, previousFeeCopy } from '../src/lib/apartmentReportCopy';

test('month comparison requires adjacent calendar months, including year rollover', () => {
  assert.equal(hasPriorCalendarMonth([['2025-12', 1000], ['2026-01', 1100]]), true);
  assert.equal(hasPriorCalendarMonth([['2026-06', 1000], ['2026-08', 1100]]), false);
  assert.equal(hasPriorCalendarMonth([['2026-08', 1000]]), false);
  assert.match(previousFeeCopy([['2026-06', 1000], ['2026-08', 1100]]), /전월 자료가 없어/);
  assert.match(previousFeeCopy([['2026-08', 1000]]), /전월 자료가 없어/);
  assert.match(previousFeeCopy([['2026-07', 1000], ['2026-08', 1100]]), /㎡당 100원 올랐습니다/);
  assert.match(previousFeeCopy([['2026-07', 1100], ['2026-08', 1000]]), /100원 내렸습니다/);
  assert.match(previousFeeCopy([['2026-07', 1000], ['2026-08', 1000]]), /변동이 없습니다/);
});

test('search description only promises available history and comparison', () => {
  const single = apartmentReportDescription('테스트', [['2026-08', 1000]], false, '지역');
  assert.doesNotMatch(single, /추이|비교/);
  assert.match(single, /2026-08 관리비는 ㎡당 1,000원/);
  const multiple = apartmentReportDescription('테스트', [['2026-06', 1000], ['2026-08', 1200]], true, '지역');
  assert.match(multiple, /공개된 2개월 추이, 지역 비교/);
});
