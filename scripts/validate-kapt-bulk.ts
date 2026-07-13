import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(rootDir, process.env.KAPT_BULK_OUTPUT || 'public/data/apartments');
const manifest = JSON.parse(await readFile(resolve(dataDir, 'manifest.json'), 'utf8')) as {
  latestMonth: string;
  feeColumns: string[];
  stats: Record<string, number>;
  regions: Array<{ key: string; count: number; withFees: number; file: string }>;
};
const index = JSON.parse(await readFile(resolve(dataDir, 'index.json'), 'utf8')) as Array<{
  c: string;
  s: string;
  sd: string;
  lm: string;
  tf: number;
  cf: number;
  rf: number;
  q: number;
}>; 

const errors: string[] = [];
const assert = (condition: boolean, message: string) => {
  if (!condition) errors.push(message);
};

assert(index.length === manifest.stats.complexes, `인덱스 단지 수 불일치: ${index.length}`);
assert(new Set(index.map((item) => item.c)).size === index.length, '인덱스 단지코드 중복');
assert(new Set(index.map((item) => item.s)).size === index.length, '인덱스 슬러그 중복');
assert(index.filter((item) => item.q === 1).length === manifest.stats.publishableComplexes, '상세 페이지 대상 수 불일치');
assert(manifest.stats.duplicateComplexes === 0, '기본정보 단지코드 중복 발생');
assert(manifest.stats.duplicateFeeRows === 0, '단지-월 관리비 중복 발생');
assert(manifest.stats.areaConflicts === 0, '동일 단지의 관리비부과면적 충돌');
assert(manifest.latestMonth.length === 7, '최신 관리비 기준월 형식 오류');
assert(manifest.feeColumns.length === 14, '관리비 열 정의 개수 오류');

let regionComplexes = 0;
let regionWithFees = 0;
let detailFeeRows = 0;
let calculationErrors = 0;
let negativeAdjustmentValues = 0;
for (const region of manifest.regions) {
  const path = resolve(rootDir, region.file.replace(/^\//, 'public/'));
  const entries = JSON.parse(await readFile(path, 'utf8')) as Array<{
    c: string;
    lm: string;
    tf: number;
    cf: number;
    rf: number;
    f: Array<number[] | [string, ...number[]]>;
  }>;
  regionComplexes += entries.length;
  regionWithFees += entries.filter((entry) => entry.f.length > 0).length;
  assert(entries.length === region.count, `${region.key} 단지 수 불일치`);
  assert(entries.filter((entry) => entry.f.length > 0).length === region.withFees, `${region.key} 관리비 결합 수 불일치`);
  for (const entry of entries) {
    detailFeeRows += entry.f.length;
    const latest = entry.f.at(-1);
    if (latest) {
      assert(String(latest[0]) === entry.lm, `${entry.c} 최신월 불일치`);
      assert(Number(latest[1]) === entry.tf, `${entry.c} 최신 총관리비 불일치`);
    }
    for (const fee of entry.f) {
      assert(fee.length === manifest.feeColumns.length, `${entry.c} 관리비 열 개수 오류`);
      const total = Number(fee[1]);
      const components = Number(fee[2]) + Number(fee[3]) + Number(fee[4]);
      if (Math.abs(total - components) > 2) calculationErrors += 1;
      if (fee.slice(1).some((value) => !Number.isFinite(Number(value)))) errors.push(`${entry.c} 비정상 관리비`);
      if (Number(fee[1]) < 0 || Number(fee[2]) < 0) errors.push(`${entry.c} 총액 또는 공용관리비 음수`);
      negativeAdjustmentValues += fee.slice(1).filter((value) => Number(value) < 0).length;
    }
  }
}

assert(regionComplexes === manifest.stats.complexes, '지역 파일 전체 단지 수 불일치');
assert(regionWithFees === manifest.stats.complexesWithFees, '지역 파일 관리비 결합 수 불일치');
assert(detailFeeRows === manifest.stats.publishedFeeRows, '상세 관리비 행 수 불일치');
assert(calculationErrors === 0, `총관리비 산식 불일치 ${calculationErrors}건`);
assert(negativeAdjustmentValues === manifest.stats.negativeAdjustmentValues, '음수 정산값 집계 불일치');

if (errors.length) {
  console.error(errors.slice(0, 30).join('\n'));
  throw new Error(`K-apt 일괄 데이터 검증 실패: ${errors.length}건`);
}

console.log(
  `검증 완료: ${regionComplexes.toLocaleString('ko-KR')}개 단지, ${detailFeeRows.toLocaleString('ko-KR')}개 관리비 행, 최신월 ${manifest.latestMonth}, 음수 정산값 ${negativeAdjustmentValues.toLocaleString('ko-KR')}건`
);
