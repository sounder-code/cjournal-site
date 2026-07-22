import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AdminCenter,
  type Coordinate,
  type CoordinateValidationStats,
  validateApartmentCoordinates
} from './kapt-coordinate-validation.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(rootDir, process.env.KAPT_BULK_OUTPUT || 'public/data/apartments');
const publicDataPrefix = '/data/apartments/';
const outputPath = (file: string) =>
  file.startsWith(publicDataPrefix)
    ? resolve(dataDir, file.slice(publicDataPrefix.length))
    : resolve(rootDir, file.replace(/^\//, 'public/'));

type HouseholdBand = 'under-300' | '300-499' | '500-999' | '1000-1499' | 'over-1500';
type HouseholdBands = Record<HouseholdBand, number>;

interface ApartmentIndexEntry {
  c: string;
  s: string;
  q: number;
  n: string;
  sd: string;
  sg: string;
  d: string;
  a: string;
  h: number;
  b: number;
  y: number;
  ht: string;
  mt: string;
  ma: number;
  lm: string;
  tf: number;
  cf: number;
  rf: number;
  la?: number;
  lo?: number;
}

type SearchEntry = Pick<
  ApartmentIndexEntry,
  'c' | 's' | 'n' | 'sd' | 'sg' | 'd' | 'a' | 'h' | 'tf' | 'cf' | 'rf' | 'q' | 'la' | 'lo'
>;

interface Manifest {
  version: number;
  latestMonth: string;
  months: string[];
  feeColumns: string[];
  stats: Record<string, number>;
  index: string;
  search: string;
  searchMeta: { file: string; count: number; withCoordinates: number; fields: string[] };
  regions: Array<{ key: string; count: number; withFees: number; file: string }>;
  districts: Array<{
    key: string;
    province: string;
    district: string;
    label?: string;
    count: number;
    withFees: number;
    withCoordinates: number;
    householdBands: HouseholdBands;
    file: string;
  }>;
  coordinateValidation: CoordinateValidationStats;
  feeHistory: {
    discovery: 'auto' | 'KAPT_FEE_FILES';
    files: Array<{ sourceDate: string; fileName: string; path: string; rows: number }>;
  };
}

interface RegionEntry extends ApartmentIndexEntry {
  p: number;
  e: number;
  f: Array<[string, ...number[]]>;
}

const manifest = JSON.parse(await readFile(resolve(dataDir, 'manifest.json'), 'utf8')) as Manifest;
const index = JSON.parse(await readFile(resolve(dataDir, 'index.json'), 'utf8')) as ApartmentIndexEntry[];
const search = JSON.parse(
  await readFile(outputPath(manifest.search), 'utf8')
) as SearchEntry[];
const coordinates = JSON.parse(
  await readFile(resolve(rootDir, 'src/data/apartment-coordinates.json'), 'utf8')
) as Record<string, Coordinate>;
const adminCenters = JSON.parse(
  await readFile(resolve(rootDir, 'src/data/admin-centers.json'), 'utf8')
) as { districts: AdminCenter[] };

const errors: string[] = [];
const assert = (condition: boolean, message: string) => {
  if (!condition) errors.push(message);
};
const hasCoordinate = (entry: { la?: number; lo?: number }) =>
  Number.isFinite(Number(entry.la)) && Number.isFinite(Number(entry.lo));
const householdBand = (households: number): HouseholdBand => {
  if (households < 300) return 'under-300';
  if (households < 500) return '300-499';
  if (households < 1000) return '500-999';
  if (households < 1500) return '1000-1499';
  return 'over-1500';
};
const emptyHouseholdBands = (): HouseholdBands => ({
  'under-300': 0,
  '300-499': 0,
  '500-999': 0,
  '1000-1499': 0,
  'over-1500': 0
});
const sameScalarFields = (actual: Record<string, unknown>, expected: Record<string, unknown>) => {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (actualKeys.join('|') !== expectedKeys.join('|')) return false;
  return expectedKeys.every((key) => actual[key] === expected[key]);
};

assert(manifest.version >= 2, 'manifest 버전이 지연 로딩 계약을 반영하지 않음');
assert(index.length === manifest.stats.complexes, `인덱스 단지 수 불일치: ${index.length}`);
assert(new Set(index.map((item) => item.c)).size === index.length, '인덱스 단지코드 중복');
assert(new Set(index.map((item) => item.s)).size === index.length, '인덱스 슬러그 중복');
assert(index.filter((item) => item.q === 1).length === manifest.stats.publishableComplexes, '상세 페이지 대상 수 불일치');
assert(manifest.stats.duplicateComplexes === 0, '기본정보 단지코드 중복 발생');
assert(manifest.stats.duplicateFeeRows === 0, '같은 원본 안에 단지-월 관리비 중복 발생');
assert(manifest.stats.invalidFeeMonths === 0, '원본 관리비 월 형식 오류 발생');
assert(manifest.stats.areaConflicts === 0, '동일 단지의 관리비부과면적 충돌');
assert(manifest.latestMonth.length === 7, '최신 관리비 기준월 형식 오류');
assert(manifest.feeColumns.length === 14, '관리비 열 정의 개수 오류');
assert(manifest.months.length > 0, '관리비 월 이력이 비어 있음');
assert(new Set(manifest.months).size === manifest.months.length, 'manifest 관리비 월 중복');
assert(
  manifest.months.every((month, indexValue) => !indexValue || manifest.months[indexValue - 1] < month),
  'manifest 관리비 월 정렬 오류'
);
assert(manifest.months.at(-1) === manifest.latestMonth, 'manifest 최신월과 월 목록 불일치');

const indexByCode = new Map(index.map((entry) => [entry.c, entry]));
for (const entry of index) {
  assert(Object.hasOwn(entry, 'la') === Object.hasOwn(entry, 'lo'), `${entry.c} 전국 인덱스 좌표 쌍 불완전`);
}
const searchRequiredFields = ['c', 's', 'n', 'sd', 'sg', 'd', 'a', 'h', 'tf', 'cf', 'rf', 'q'];
const searchAllowedFields = new Set([...searchRequiredFields, 'la', 'lo']);
assert(manifest.search === manifest.searchMeta.file, '검색 파일 URL과 메타데이터 경로 불일치');
assert(search.length === manifest.searchMeta.count, '검색 파일 manifest 건수 불일치');
assert(search.length === index.length, '검색 파일 전체 단지 수 불일치');
assert(new Set(search.map((entry) => entry.c)).size === search.length, '검색 파일 단지코드 중복');
assert(new Set(search.map((entry) => entry.s)).size === search.length, '검색 파일 슬러그 중복');
assert(
  manifest.searchMeta.fields.join('|') ===
    ['c', 's', 'n', 'sd', 'sg', 'd', 'a', 'h', 'tf', 'cf', 'rf', 'q', 'la?', 'lo?'].join('|'),
  '검색 파일 필드 선언 불일치'
);
for (const entry of search) {
  const expected = indexByCode.get(entry.c);
  assert(Boolean(expected), `${entry.c} 검색 레코드가 전국 인덱스에 없음`);
  assert(searchRequiredFields.every((field) => Object.hasOwn(entry, field)), `${entry.c} 검색 필수 필드 누락`);
  assert(Object.keys(entry).every((field) => searchAllowedFields.has(field)), `${entry.c} 검색 파일 불필요 필드 포함`);
  if (!expected) continue;
  assert(Object.hasOwn(entry, 'la') === Object.hasOwn(entry, 'lo'), `${entry.c} 검색 좌표 쌍 불완전`);
  assert(hasCoordinate(entry) === hasCoordinate(expected), `${entry.c} 검색 좌표 유효성 불일치`);
  const expectedSearch = Object.fromEntries(
    Object.keys(entry).map((field) => [field, expected[field as keyof ApartmentIndexEntry]])
  );
  assert(sameScalarFields(entry as unknown as Record<string, unknown>, expectedSearch), `${entry.c} 검색 요약값 불일치`);
}
const searchWithCoordinates = search.filter(hasCoordinate).length;
assert(searchWithCoordinates === manifest.searchMeta.withCoordinates, '검색 파일 좌표 건수 불일치');

let regionComplexes = 0;
let regionWithFees = 0;
let detailFeeRows = 0;
let calculationErrors = 0;
let negativeAdjustmentValues = 0;
const regionCodes = new Set<string>();
const outputMonths = new Set<string>();
for (const region of manifest.regions) {
  const entries = JSON.parse(await readFile(outputPath(region.file), 'utf8')) as RegionEntry[];
  regionComplexes += entries.length;
  regionWithFees += entries.filter((entry) => entry.f.length > 0).length;
  assert(entries.length === region.count, `${region.key} 단지 수 불일치`);
  assert(entries.filter((entry) => entry.f.length > 0).length === region.withFees, `${region.key} 관리비 결합 수 불일치`);
  for (const entry of entries) {
    assert(!regionCodes.has(entry.c), `${entry.c} 지역 파일 간 단지 중복`);
    regionCodes.add(entry.c);
    detailFeeRows += entry.f.length;
    const latest = entry.f.at(-1);
    if (latest) {
      assert(String(latest[0]) === entry.lm, `${entry.c} 최신월 불일치`);
      assert(Number(latest[1]) === entry.tf, `${entry.c} 최신 총관리비 불일치`);
    }
    let previousMonth = '';
    for (const fee of entry.f) {
      const month = String(fee[0]);
      assert(/^\d{4}-\d{2}$/.test(month), `${entry.c} 관리비 월 형식 오류`);
      assert(!previousMonth || previousMonth < month, `${entry.c} 관리비 월 중복 또는 정렬 오류`);
      previousMonth = month;
      outputMonths.add(month);
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
assert([...outputMonths].sort().join('|') === manifest.months.join('|'), '출력 관리비 월 이력과 manifest 불일치');

const districtKeys = new Set<string>();
const districtFiles = new Set<string>();
const districtCodes = new Set<string>();
let districtComplexes = 0;
let districtWithCoordinates = 0;
for (const district of manifest.districts) {
  assert(!districtKeys.has(district.key), `${district.key} 시군구 키 중복`);
  assert(!districtFiles.has(district.file), `${district.file} 시군구 파일 경로 중복`);
  districtKeys.add(district.key);
  districtFiles.add(district.file);
  const entries = JSON.parse(await readFile(outputPath(district.file), 'utf8')) as ApartmentIndexEntry[];
  districtComplexes += entries.length;
  const withCoordinates = entries.filter(hasCoordinate).length;
  districtWithCoordinates += withCoordinates;
  assert(entries.length === district.count, `${district.key} 지도 단지 수 불일치`);
  assert(withCoordinates === district.withCoordinates, `${district.key} 지도 좌표 수 불일치`);
  assert(entries.filter((entry) => Boolean(entry.lm)).length === district.withFees, `${district.key} 지도 관리비 결합 수 불일치`);

  const expectedBands = emptyHouseholdBands();
  for (const entry of entries) {
    assert(!districtCodes.has(entry.c), `${entry.c} 시군구 지도 파일 간 중복`);
    districtCodes.add(entry.c);
    expectedBands[householdBand(Number(entry.h))] += 1;
    assert(entry.sd === district.province, `${entry.c} 시군구 파일 시도 불일치`);
    assert(entry.sg === district.district, `${entry.c} 시군구 파일 이름 불일치`);
    const expected = indexByCode.get(entry.c);
    assert(Boolean(expected), `${entry.c} 시군구 지도 레코드가 전국 인덱스에 없음`);
    if (expected) {
      assert(
        sameScalarFields(
          entry as unknown as Record<string, unknown>,
          expected as unknown as Record<string, unknown>
        ),
        `${entry.c} 시군구 지도 요약값 불일치`
      );
    }
  }
  for (const band of Object.keys(expectedBands) as HouseholdBand[]) {
    assert(expectedBands[band] === district.householdBands[band], `${district.key} ${band} 세대수 밴드 불일치`);
  }
  assert(Object.values(district.householdBands).reduce((sum, value) => sum + value, 0) === district.count, `${district.key} 세대수 밴드 합계 불일치`);
}
assert(districtComplexes === index.length, '시군구 지도 파일 전체 단지 수 불일치');
assert(districtCodes.size === index.length, '시군구 지도 파일 단지 누락');
assert(manifest.districts.length === manifest.stats.districtFiles, '시군구 지도 파일 manifest 건수 불일치');

const expectedCoordinateValidation = validateApartmentCoordinates({
  apartments: index.map((entry) => ({ code: entry.c, sido: entry.sd, sigungu: entry.sg })),
  coordinates,
  adminCenters: adminCenters.districts,
  thresholdKm: manifest.coordinateValidation.thresholdKm
});
for (const key of Object.keys(expectedCoordinateValidation.stats) as Array<keyof CoordinateValidationStats>) {
  assert(
    expectedCoordinateValidation.stats[key] === manifest.coordinateValidation[key],
    `좌표 통계 ${key} 불일치`
  );
}
for (const entry of index) {
  const expected = expectedCoordinateValidation.validCoordinates.get(entry.c);
  assert(Boolean(expected) === hasCoordinate(entry), `${entry.c} 좌표 유효성 반영 오류`);
  if (expected && hasCoordinate(entry)) {
    assert(entry.la === expected.latitude && entry.lo === expected.longitude, `${entry.c} 좌표값 불일치`);
  }
}
assert(districtWithCoordinates === expectedCoordinateValidation.stats.validCoordinates, '시군구 지도 유효 좌표 합계 불일치');
assert(searchWithCoordinates === expectedCoordinateValidation.stats.validCoordinates, '검색 파일 유효 좌표 합계 불일치');

assert(manifest.feeHistory.files.length === manifest.stats.feeSourceFiles, '관리비 원본 파일 수 불일치');
assert(
  manifest.feeHistory.files.reduce((sum, file) => sum + file.rows, 0) === manifest.stats.feeRows,
  '관리비 원본 행 수 합계 불일치'
);
if (manifest.feeHistory.discovery === 'auto') {
  assert(
    manifest.feeHistory.files.every(
      (file, indexValue) =>
        !indexValue ||
        manifest.feeHistory.files[indexValue - 1].sourceDate.padEnd(8, '0') <= file.sourceDate.padEnd(8, '0')
    ),
    '자동 탐색 관리비 원본 순서 오류'
  );
}

if (errors.length) {
  console.error(errors.slice(0, 40).join('\n'));
  throw new Error(`K-apt 일괄 데이터 검증 실패: ${errors.length}건`);
}

console.log(
  `검증 완료: ${regionComplexes.toLocaleString('ko-KR')}개 단지, ${detailFeeRows.toLocaleString('ko-KR')}개 관리비 행, ` +
    `${manifest.districts.length.toLocaleString('ko-KR')}개 시군구 청크, 유효 좌표 ${districtWithCoordinates.toLocaleString('ko-KR')}개, ` +
    `최신월 ${manifest.latestMonth}`
);
