import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface Manifest {
  sourceDate: string;
  latestMonth: string;
  stats: {
    complexes: number;
    publishableComplexes: number;
    publishedFeeRows: number;
    duplicateComplexes: number;
    duplicateFeeRows: number;
    areaConflicts: number;
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
if (current.stats.duplicateComplexes || current.stats.duplicateFeeRows || current.stats.areaConflicts) {
  errors.push('중복 또는 면적 충돌이 발견되었습니다.');
}

if (errors.length) throw new Error(`K-apt 갱신 중단:\n- ${errors.join('\n- ')}`);
console.log(
  `갱신 비교 통과: ${previous.sourceDate}/${previous.latestMonth} -> ${current.sourceDate}/${current.latestMonth}, ` +
    `${current.stats.complexes.toLocaleString('ko-KR')}개 단지`
);
