import { apartmentComplexes } from '../src/data/apartments';
import { generatedApartmentComplexes, generatedSource } from '../src/data/apartments.generated';

const isRealMode = generatedApartmentComplexes.length > 0;
const source = isRealMode ? generatedSource : 'sample-fallback';
const minComplexes = Number(process.env.KAPT_MIN_COMPLEXES || '10');
const errors: string[] = [];

if (isRealMode && apartmentComplexes.length < minComplexes) {
  errors.push(`실데이터 단지 수가 너무 적습니다: ${apartmentComplexes.length}`);
}

for (const apartment of apartmentComplexes) {
  if (!apartment.slug || !apartment.name) errors.push(`단지 식별값 누락: ${apartment.slug || apartment.name}`);
  if (!apartment.monthlyFees.length) errors.push(`${apartment.name}: monthlyFees 없음`);
  if (!apartment.households || apartment.households < 1) errors.push(`${apartment.name}: 세대수 이상`);
  if (apartment.approvalYear < 1900 || apartment.approvalYear > new Date().getFullYear()) {
    errors.push(`${apartment.name}: 사용승인년도 이상 ${apartment.approvalYear}`);
  }
  for (const fee of apartment.monthlyFees) {
    if (!fee.month || !/^\d{4}-\d{2}$/.test(fee.month)) errors.push(`${apartment.name}: 기준월 형식 이상 ${fee.month}`);
    if (fee.totalFeePerM2 <= 0) errors.push(`${apartment.name} ${fee.month}: 총관리비 0 이하`);
  }
}

if (errors.length) {
  console.error(JSON.stringify({ source, errors }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    source,
    mode: isRealMode ? 'generated' : 'sample-fallback',
    apartmentCount: apartmentComplexes.length,
    latestMonths: Array.from(new Set(apartmentComplexes.map((apartment) => apartment.monthlyFees.at(-1)?.month))).sort()
  }, null, 2));
}
