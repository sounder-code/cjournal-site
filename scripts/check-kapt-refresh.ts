import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface Manifest {
  version?: number;
  sourceDate: string;
  latestMonth: string;
  months?: string[];
  stats: {
    complexes: number;
    publishableComplexes: number;
    publishedFeeRows: number;
    duplicateComplexes: number;
    duplicateFeeRows: number;
    areaConflicts: number;
    invalidFeeMonths?: number;
    districtFiles?: number;
  };
  search?: string;
  searchMeta?: { count: number; withCoordinates: number };
  districts?: Array<{ count: number; withCoordinates: number; file: string }>;
  coordinateValidation?: {
    validCoordinates: number;
    invalidCoordinates: number;
    excludedFromMap: number;
  };
}

const previousPath = process.env.KAPT_PREVIOUS_MANIFEST;
if (!previousPath) throw new Error('KAPT_PREVIOUS_MANIFEST가 필요합니다.');

const readManifest = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as Manifest;
const previous = await readManifest(resolve(previousPath));
const current = await readManifest(resolve('public/data/apartments/manifest.json'));
const errors: string[] = [];

if (current.sourceDate < previous.sourceDate) errors.push('원본 기준일이 이전 데이터보다 오래되었습니다.');
if (current.latestMonth < previous.latestMonth) errors.push('최신 관리비 기준월이 뒤로 이동했습니다.');
if (current.stats.complexes < previous.stats.complexes * 0.97) errors.push('전체 단지 수가 3% 넘게 감소했습니다.');
if (current.stats.publishableComplexes < previous.stats.publishableComplexes * 0.95) {
  errors.push('상세 분석 가능 단지 수가 5% 넘게 감소했습니다.');
}
if (current.stats.publishedFeeRows < previous.stats.publishedFeeRows * 0.9) {
  errors.push('공개 관리비 행 수가 10% 넘게 감소했습니다.');
}
for (const month of previous.months ?? []) {
  if (!(current.months ?? []).includes(month)) errors.push(`기존 관리비 월 이력이 사라졌습니다: ${month}`);
}
if (
  current.stats.duplicateComplexes ||
  current.stats.duplicateFeeRows ||
  current.stats.areaConflicts ||
  current.stats.invalidFeeMonths
) {
  errors.push('중복 또는 면적 충돌이 발견되었습니다.');
}
if ((current.version ?? 0) >= 2) {
  if (!current.search || current.searchMeta?.count !== current.stats.complexes) {
    errors.push('검색 인덱스 단지 수가 전체 단지 수와 다릅니다.');
  }
  if (!current.districts?.length || current.districts.length !== current.stats.districtFiles) {
    errors.push('시군구 지도 파일 목록이 누락되었거나 건수가 다릅니다.');
  }
  if (current.districts?.reduce((sum, district) => sum + district.count, 0) !== current.stats.complexes) {
    errors.push('시군구 지도 파일의 전체 단지 합계가 다릅니다.');
  }
  if (
    current.districts?.reduce((sum, district) => sum + district.withCoordinates, 0) !==
    current.coordinateValidation?.validCoordinates
  ) {
    errors.push('시군구 지도 파일의 유효 좌표 합계가 다릅니다.');
  }
}
if (
  previous.coordinateValidation &&
  current.coordinateValidation &&
  current.coordinateValidation.validCoordinates < previous.coordinateValidation.validCoordinates * 0.98
) {
  errors.push('유효 지도 좌표가 이전보다 2% 넘게 감소했습니다.');
}
if (
  previous.coordinateValidation &&
  current.coordinateValidation &&
  current.coordinateValidation.invalidCoordinates >
    Math.max(previous.coordinateValidation.invalidCoordinates * 1.5, previous.coordinateValidation.invalidCoordinates + 10)
) {
  errors.push('비정상 좌표가 이전 갱신보다 크게 증가했습니다.');
}

if (errors.length) throw new Error(`K-apt 갱신 중단:\n- ${errors.join('\n- ')}`);
console.log(
  `갱신 비교 통과: ${previous.sourceDate}/${previous.latestMonth} -> ${current.sourceDate}/${current.latestMonth}, ` +
    `${current.stats.complexes.toLocaleString('ko-KR')}개 단지`
);
