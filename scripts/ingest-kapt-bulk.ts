import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(rootDir, process.env.KAPT_BULK_MANIFEST || 'data/kapt/raw/latest.json');
const outputDir = resolve(rootDir, process.env.KAPT_BULK_OUTPUT || 'public/data/apartments');

type CellValue = string | number | boolean | Date | null | undefined;

interface BasicComplex {
  code: string;
  name: string;
  sido: string;
  sigungu: string;
  dong: string;
  address: string;
  households: number;
  buildings: number;
  approvalYear: number;
  heatingType: string;
  managementType: string;
  parking: number;
  elevators: number;
}

interface FeeRow {
  month: string;
  totalFeePerM2: number;
  commonFeePerM2: number;
  individualFeePerM2: number;
  reserveFeePerM2: number;
  generalFeePerM2: number;
  securityFeePerM2: number;
  cleaningFeePerM2: number;
  maintenanceFeePerM2: number;
  elevatorFeePerM2: number;
  electricityFeePerM2: number;
  waterFeePerM2: number;
  heatingFeePerM2: number;
  hotWaterFeePerM2: number;
}

interface RawManifest {
  sourceDate: string;
  sources: Record<'basic' | 'area' | 'fee', { path: string; fileName: string }>;
}

const text = (value: CellValue) => String(value ?? '').trim();
const number = (value: CellValue) => {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
const rounded = (value: number) => Math.round(value);
const keyForRegion = (sido: string) =>
  sido
    .toLowerCase()
    .replace(/특별자치도|특별자치시|특별시|광역시|도$/g, '')
    .replace(/[^a-z0-9가-힣]+/g, '-');
const normalizeSido = (sido: string, sigungu: string, address: string) => {
  if (sido !== '전남광주통합특별시') return sido;
  if (address.startsWith('광주광역시')) return '광주광역시';
  if (address.startsWith('전라남도')) return '전라남도';
  return ['광산구', '남구', '동구', '북구', '서구'].includes(sigungu) ? '광주광역시' : '전라남도';
};
const slugify = (name: string, code: string) =>
  `${name}-${code}`
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '');

const rowObject = (headers: string[], values: CellValue[]) =>
  Object.fromEntries(headers.map((header, index) => [header, values[index + 1]])) as Record<string, CellValue>;

async function* rowsFromWorkbook(filePath: string) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    styles: 'ignore',
    hyperlinks: 'ignore'
  });

  for await (const worksheet of workbook) {
    let headers: string[] = [];
    for await (const row of worksheet) {
      const values = row.values as CellValue[];
      if (row.number === 2) {
        headers = values.slice(1).map(text);
        continue;
      }
      if (row.number > 2 && headers.length) yield rowObject(headers, values);
    }
  }
}

const rawManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RawManifest;
const basicPath = resolve(rootDir, rawManifest.sources.basic.path);
const areaPath = resolve(rootDir, rawManifest.sources.area.path);
const feePath = resolve(rootDir, rawManifest.sources.fee.path);

const complexes = new Map<string, BasicComplex>();
let basicRows = 0;
let duplicateComplexes = 0;
for await (const row of rowsFromWorkbook(basicPath)) {
  basicRows += 1;
  const code = text(row['단지코드']);
  if (!code || !text(row['단지명'])) continue;
  if (complexes.has(code)) duplicateComplexes += 1;
  const rawSido = text(row['시도']);
  const sigungu = text(row['시군구']);
  const rawAddress = text(row['도로명주소']) || text(row['법정동주소']);
  const sido = normalizeSido(rawSido, sigungu, rawAddress);
  const address = rawAddress.replace(/^전남광주통합특별시/, sido);
  complexes.set(code, {
    code,
    name: text(row['단지명']),
    sido,
    sigungu,
    dong: text(row['동리']) || text(row['읍면']),
    address,
    households: rounded(number(row['세대수'])),
    buildings: rounded(number(row['동수'])),
    approvalYear: Number(text(row['사용승인일']).replace(/\D/g, '').slice(0, 4)) || 0,
    heatingType: text(row['난방방식']),
    managementType: text(row['관리방식']),
    parking: rounded(number(row['총주차대수'])),
    elevators:
      rounded(number(row['승강기(승객용)'])) +
      rounded(number(row['승강기(화물용)'])) +
      rounded(number(row['승강기(승객+화물)']))
  });
}

const managementAreas = new Map<string, number>();
let areaRows = 0;
let areaConflicts = 0;
for await (const row of rowsFromWorkbook(areaPath)) {
  areaRows += 1;
  const code = text(row['단지코드']);
  const area = number(row['관리비부과면적']);
  if (!code || area <= 0) continue;
  const previous = managementAreas.get(code);
  if (previous && Math.abs(previous - area) > 0.01) areaConflicts += 1;
  managementAreas.set(code, area);
}

const fees = new Map<string, FeeRow[]>();
const seenFeeKeys = new Set<string>();
const months = new Set<string>();
let feeRows = 0;
let duplicateFeeRows = 0;
let feeRowsWithoutArea = 0;
let feeRowsWithoutComplex = 0;
let negativeAdjustmentValues = 0;
for await (const row of rowsFromWorkbook(feePath)) {
  feeRows += 1;
  const code = text(row['단지코드']);
  const rawMonth = text(row['발생년월(YYYYMM)']).replace(/\D/g, '').slice(0, 6);
  if (!code || rawMonth.length !== 6) continue;
  if (!complexes.has(code)) feeRowsWithoutComplex += 1;
  const area = managementAreas.get(code) ?? 0;
  if (area <= 0) {
    feeRowsWithoutArea += 1;
    continue;
  }
  const uniqueKey = `${code}:${rawMonth}`;
  if (seenFeeKeys.has(uniqueKey)) {
    duplicateFeeRows += 1;
    continue;
  }
  seenFeeKeys.add(uniqueKey);
  const perM2 = (value: number) => rounded(value / area);
  const common = number(row['공용관리비계']);
  const individual = number(row['개별사용료계']);
  const reserve = number(row['장충금 월부과액']);
  const general =
    number(row['인건비']) +
    number(row['제사무비']) +
    number(row['제세공과금']) +
    number(row['피복비']) +
    number(row['교육훈련비']) +
    number(row['차량유지비']) +
    number(row['그밖의부대비용']);
  const month = `${rawMonth.slice(0, 4)}-${rawMonth.slice(4, 6)}`;
  const item: FeeRow = {
    month,
    totalFeePerM2: perM2(common + individual + reserve),
    commonFeePerM2: perM2(common),
    individualFeePerM2: perM2(individual),
    reserveFeePerM2: perM2(reserve),
    generalFeePerM2: perM2(general),
    securityFeePerM2: perM2(number(row['경비비'])),
    cleaningFeePerM2: perM2(number(row['청소비'])),
    maintenanceFeePerM2: perM2(number(row['수선비']) + number(row['시설유지비'])),
    elevatorFeePerM2: perM2(number(row['승강기유지비'])),
    electricityFeePerM2: perM2(number(row['전기료(공용)']) + number(row['전기료(전용)'])),
    waterFeePerM2: perM2(number(row['수도료(공용)']) + number(row['수도료(전용)'])),
    heatingFeePerM2: perM2(number(row['난방비(공용)']) + number(row['난방비(전용)'])),
    hotWaterFeePerM2: perM2(number(row['급탕비(공용)']) + number(row['급탕비(전용)']))
  };
  negativeAdjustmentValues += Object.values(item).filter(
    (value) => typeof value === 'number' && value < 0
  ).length;
  const bucket = fees.get(code) ?? [];
  bucket.push(item);
  fees.set(code, bucket);
  months.add(month);
}

for (const rows of fees.values()) rows.sort((a, b) => a.month.localeCompare(b.month));

const byRegion = new Map<string, Array<Record<string, unknown>>>();
const index: Array<Record<string, unknown>> = [];
let complexesWithArea = 0;
let complexesWithFees = 0;
let publishedFeeRows = 0;
let publishableComplexes = 0;
for (const complex of complexes.values()) {
  const area = managementAreas.get(complex.code) ?? 0;
  const monthlyFees = fees.get(complex.code) ?? [];
  const latest = monthlyFees.at(-1);
  if (area > 0) complexesWithArea += 1;
  if (monthlyFees.length) complexesWithFees += 1;
  publishedFeeRows += monthlyFees.length;
  const isPublishable =
    monthlyFees.length >= 5 &&
    area > 0 &&
    Number(latest?.totalFeePerM2 ?? 0) > 0 &&
    complex.households > 0 &&
    complex.address.length >= 5 &&
    complex.name.length >= 2;
  if (isPublishable) publishableComplexes += 1;
  const regionKey = keyForRegion(complex.sido) || 'unknown';
  const summary = {
    c: complex.code,
    s: slugify(complex.name, complex.code),
    q: isPublishable ? 1 : 0,
    n: complex.name,
    sd: complex.sido,
    sg: complex.sigungu,
    d: complex.dong,
    a: complex.address,
    h: complex.households,
    b: complex.buildings,
    y: complex.approvalYear,
    ht: complex.heatingType,
    mt: complex.managementType,
    ma: rounded(area),
    lm: latest?.month ?? '',
    tf: latest?.totalFeePerM2 ?? 0,
    cf: latest?.commonFeePerM2 ?? 0,
    rf: latest?.reserveFeePerM2 ?? 0
  };
  index.push(summary);
  const details = byRegion.get(regionKey) ?? [];
  details.push({
    ...summary,
    p: complex.parking,
    e: complex.elevators,
    f: monthlyFees.map((fee) => [
      fee.month,
      fee.totalFeePerM2,
      fee.commonFeePerM2,
      fee.individualFeePerM2,
      fee.reserveFeePerM2,
      fee.generalFeePerM2,
      fee.securityFeePerM2,
      fee.cleaningFeePerM2,
      fee.maintenanceFeePerM2,
      fee.elevatorFeePerM2,
      fee.electricityFeePerM2,
      fee.waterFeePerM2,
      fee.heatingFeePerM2,
      fee.hotWaterFeePerM2
    ])
  });
  byRegion.set(regionKey, details);
}

index.sort((a, b) => String(a.sd).localeCompare(String(b.sd), 'ko') || String(a.n).localeCompare(String(b.n), 'ko'));
await rm(outputDir, { recursive: true, force: true });
await mkdir(resolve(outputDir, 'regions'), { recursive: true });
await writeFile(resolve(outputDir, 'index.json'), JSON.stringify(index));

const regionManifest = [];
for (const [key, entries] of [...byRegion].sort(([a], [b]) => a.localeCompare(b, 'ko'))) {
  entries.sort((a, b) => String(a.n).localeCompare(String(b.n), 'ko'));
  await writeFile(resolve(outputDir, 'regions', `${key}.json`), JSON.stringify(entries));
  regionManifest.push({
    key,
    name: String(entries[0]?.sd ?? '지역 미확인'),
    count: entries.length,
    withFees: entries.filter((entry) => Array.isArray(entry.f) && entry.f.length > 0).length,
    file: `/data/apartments/regions/${key}.json`
  });
}

const sortedMonths = [...months].sort();
const outputManifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sourceDate: rawManifest.sourceDate,
  source: 'K-apt 주간 일괄 공개자료',
  units: { fee: '원/m2', area: 'm2' },
  feeColumns: [
    'month',
    'totalFeePerM2',
    'commonFeePerM2',
    'individualFeePerM2',
    'reserveFeePerM2',
    'generalFeePerM2',
    'securityFeePerM2',
    'cleaningFeePerM2',
    'maintenanceFeePerM2',
    'elevatorFeePerM2',
    'electricityFeePerM2',
    'waterFeePerM2',
    'heatingFeePerM2',
    'hotWaterFeePerM2'
  ],
  months: sortedMonths,
  latestMonth: sortedMonths.at(-1) ?? '',
  stats: {
    basicRows,
    areaRows,
    feeRows,
    complexes: complexes.size,
    complexesWithArea,
    complexesWithFees,
    duplicateComplexes,
    duplicateFeeRows,
    areaConflicts,
    feeRowsWithoutArea,
    feeRowsWithoutComplex,
    publishedFeeRows,
    publishableComplexes,
    negativeAdjustmentValues
  },
  index: '/data/apartments/index.json',
  regions: regionManifest
};
await writeFile(resolve(outputDir, 'manifest.json'), `${JSON.stringify(outputManifest, null, 2)}\n`);

console.log(JSON.stringify(outputManifest.stats, null, 2));
console.log(`전국 ${complexes.size.toLocaleString('ko-KR')}개 단지, ${feeRows.toLocaleString('ko-KR')}개 관리비 행 변환 완료`);
