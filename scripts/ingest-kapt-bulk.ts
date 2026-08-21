import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import {
  type AdminCenter,
  type Coordinate,
  validateApartmentCoordinates
} from './kapt-coordinate-validation.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(rootDir, process.env.KAPT_BULK_MANIFEST || 'data/kapt/raw/latest.json');
const outputDir = resolve(rootDir, process.env.KAPT_BULK_OUTPUT || 'public/data/apartments');
const indexNowChangeSetPath = resolve(rootDir, process.env.KAPT_INDEXNOW_CHANGESET || 'data/kapt/indexnow-changes.json');
const feeRootDir = resolve(rootDir, process.env.KAPT_FEE_ROOT || 'data/kapt/raw');
const coordinateThresholdKm = Number(process.env.KAPT_COORDINATE_MAX_KM || 80);
const maxPublishableComplexes = Number(process.env.KAPT_MAX_PUBLISHABLE_COMPLEXES || 19000);
if (!Number.isFinite(coordinateThresholdKm) || coordinateThresholdKm <= 0) {
  throw new Error('KAPT_COORDINATE_MAX_KM는 0보다 큰 숫자여야 합니다.');
}
if (!Number.isInteger(maxPublishableComplexes) || maxPublishableComplexes <= 0) {
  throw new Error('KAPT_MAX_PUBLISHABLE_COMPLEXES는 0보다 큰 정수여야 합니다.');
}

/**
 * Historical fee inputs:
 * - Default: fee.xlsx files below data/kapt/raw are discovered and sorted oldest to newest.
 * - Override: set KAPT_FEE_FILES to a comma/newline-separated list ordered oldest to newest.
 *   Example: KAPT_FEE_FILES="data/kapt/raw/2024/fee.xlsx,data/kapt/raw/20260710/fee.xlsx"
 * Later files replace an earlier row with the same apartment code and YYYYMM month.
 */

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

interface AdminCenterFile {
  districts: AdminCenter[];
}

interface FeeSourceFile {
  path: string;
  sourceDate: string;
  fileName: string;
  rows: number;
}

interface ApartmentSummary {
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
  md?: string;
  la?: number;
  lo?: number;
}

interface PreviousApartmentSnapshot {
  fingerprint: string;
  slug: string;
  province: string;
  district: string;
  publishable: boolean;
  modifiedDate: string;
}

interface CurrentApartmentSnapshot extends PreviousApartmentSnapshot {
  code: string;
}

type HouseholdBand = 'under-300' | '300-499' | '500-999' | '1000-1499' | 'over-1500';

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
const keyForDistrict = (sigungu: string) =>
  (sigungu || '세종시')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
const householdBand = (households: number): HouseholdBand => {
  if (households < 300) return 'under-300';
  if (households < 500) return '300-499';
  if (households < 1000) return '500-999';
  if (households < 1500) return '1000-1499';
  return 'over-1500';
};
const emptyHouseholdBands = (): Record<HouseholdBand, number> => ({
  'under-300': 0,
  '300-499': 0,
  '500-999': 0,
  '1000-1499': 0,
  'over-1500': 0
});
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

const isoDateFromCompact = (value: string) => {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return '';
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(iso) ? iso : '';
};

const apartmentFingerprint = (entry: Record<string, unknown>) => {
  const fields = [
    'c', 's', 'q', 'n', 'sd', 'sg', 'd', 'a', 'h', 'b', 'y', 'ht', 'mt',
    'ma', 'lm', 'tf', 'cf', 'rf', 'p', 'e', 'f'
  ];
  return createHash('sha256')
    .update(JSON.stringify(fields.map((field) => entry[field] ?? null)))
    .digest('hex');
};

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

const walkFeeFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFeeFiles(path)));
    else if (entry.isFile() && entry.name.toLowerCase() === 'fee.xlsx') files.push(path);
  }
  return files;
};

const sourceDateFromPath = (path: string, fallback = '') => {
  const token = path
    .split(/[\\/]/)
    .reverse()
    .find((part) => /^\d{4}(?:\d{2})?(?:\d{2})?$/.test(part));
  return token || fallback;
};

const configuredFeeFiles = (process.env.KAPT_FEE_FILES || '')
  .split(/[\n,]/)
  .map((path) => path.trim())
  .filter(Boolean)
  .map((path) => resolve(rootDir, path));

const rawManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RawManifest;
const sourceModifiedDate = isoDateFromCompact(rawManifest.sourceDate) || new Date().toISOString().slice(0, 10);
const previousManifest = await readFile(resolve(outputDir, 'manifest.json'), 'utf8')
  .then((value) => JSON.parse(value) as {
    generatedAt?: string;
    sourceDate?: string;
    regions?: Array<{ key: string }>;
  })
  .catch(() => undefined);
const previousFallbackModifiedDate = isoDateFromCompact(previousManifest?.sourceDate || '') || sourceModifiedDate;
const previousApartments = new Map<string, PreviousApartmentSnapshot>();

for (const region of previousManifest?.regions ?? []) {
  const entries = await readFile(resolve(outputDir, 'regions', `${region.key}.json`), 'utf8')
    .then((value) => JSON.parse(value) as Array<Record<string, unknown>>)
    .catch(() => []);
  for (const entry of entries) {
    const code = String(entry.c || '').trim();
    if (!code) continue;
    previousApartments.set(code, {
      fingerprint: apartmentFingerprint(entry),
      slug: String(entry.s || ''),
      province: String(entry.sd || ''),
      district: String(entry.sg || ''),
      publishable: entry.q === 1,
      modifiedDate: /^\d{4}-\d{2}-\d{2}$/.test(String(entry.md || ''))
        ? String(entry.md)
        : previousFallbackModifiedDate
    });
  }
}

const coordinates = JSON.parse(
  await readFile(resolve(rootDir, 'src/data/apartment-coordinates.json'), 'utf8')
) as Record<string, Coordinate>;
const adminCenters = JSON.parse(
  await readFile(resolve(rootDir, 'src/data/admin-centers.json'), 'utf8')
) as AdminCenterFile;
const basicPath = resolve(rootDir, rawManifest.sources.basic.path);
const areaPath = resolve(rootDir, rawManifest.sources.area.path);
const manifestFeePath = resolve(rootDir, rawManifest.sources.fee.path);

const autoDiscoveredFeeFiles = configuredFeeFiles.length ? [] : await walkFeeFiles(feeRootDir);
if (!configuredFeeFiles.length && !autoDiscoveredFeeFiles.includes(manifestFeePath)) {
  autoDiscoveredFeeFiles.push(manifestFeePath);
}
const feePaths = [...new Set(configuredFeeFiles.length ? configuredFeeFiles : autoDiscoveredFeeFiles)];
if (!feePaths.length) throw new Error('관리비 원본 fee.xlsx를 찾지 못했습니다.');

const feeSourceFiles = await Promise.all(
  feePaths.map(async (path): Promise<FeeSourceFile & { modifiedAt: number }> => {
    const fileStat = await stat(path).catch(() => undefined);
    if (!fileStat?.isFile()) throw new Error(`관리비 원본을 읽을 수 없습니다: ${path}`);
    return {
      path,
      sourceDate: sourceDateFromPath(path, path === manifestFeePath ? rawManifest.sourceDate : ''),
      fileName: basename(path),
      rows: 0,
      modifiedAt: fileStat.mtimeMs
    };
  })
);
if (!configuredFeeFiles.length) {
  feeSourceFiles.sort(
    (a, b) =>
      a.sourceDate.padEnd(8, '0').localeCompare(b.sourceDate.padEnd(8, '0')) ||
      a.modifiedAt - b.modifiedAt ||
      a.path.localeCompare(b.path)
  );
}

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

const feeRowsByKey = new Map<string, FeeRow>();
const feeSourceByKey = new Map<string, string>();
let feeRows = 0;
let duplicateFeeRows = 0;
let supersededFeeRows = 0;
let feeRowsWithoutArea = 0;
let feeRowsWithoutComplex = 0;
let invalidFeeMonths = 0;
for (const source of feeSourceFiles) {
  const seenInSource = new Set<string>();
  for await (const row of rowsFromWorkbook(source.path)) {
    source.rows += 1;
    feeRows += 1;
    const code = text(row['단지코드']);
    const rawMonthDigits = text(row['발생년월(YYYYMM)']).replace(/\D/g, '');
    const rawMonth = rawMonthDigits.slice(0, 6);
    const monthNumber = Number(rawMonth.slice(4, 6));
    if (!code) continue;
    if (rawMonthDigits.length !== 6 || monthNumber < 1 || monthNumber > 12) {
      invalidFeeMonths += 1;
      continue;
    }
    if (!complexes.has(code)) feeRowsWithoutComplex += 1;
    const area = managementAreas.get(code) ?? 0;
    if (area <= 0) {
      feeRowsWithoutArea += 1;
      continue;
    }
    const uniqueKey = `${code}:${rawMonth}`;
    if (seenInSource.has(uniqueKey)) {
      duplicateFeeRows += 1;
      continue;
    }
    seenInSource.add(uniqueKey);

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
    const item: FeeRow = {
      month: `${rawMonth.slice(0, 4)}-${rawMonth.slice(4, 6)}`,
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
    if (feeRowsByKey.has(uniqueKey) && feeSourceByKey.get(uniqueKey) !== source.path) {
      supersededFeeRows += 1;
    }
    feeRowsByKey.set(uniqueKey, item);
    feeSourceByKey.set(uniqueKey, source.path);
  }
}

const fees = new Map<string, FeeRow[]>();
const months = new Set<string>();
let negativeAdjustmentValues = 0;
for (const [key, item] of feeRowsByKey) {
  const code = key.split(':', 1)[0];
  const bucket = fees.get(code) ?? [];
  bucket.push(item);
  fees.set(code, bucket);
  if (complexes.has(code)) {
    months.add(item.month);
    negativeAdjustmentValues += Object.values(item).filter(
      (value) => typeof value === 'number' && value < 0
    ).length;
  }
}
for (const rows of fees.values()) rows.sort((a, b) => a.month.localeCompare(b.month));

const eligibleComplexes = [...complexes.values()].filter((complex) => {
  const isSejong = complex.sido === '세종특별자치시';
  return Boolean(complex.sido && (complex.sigungu || isSejong));
});
const excludedInvalidRegionComplexes = complexes.size - eligibleComplexes.length;

const coordinateValidation = validateApartmentCoordinates({
  apartments: eligibleComplexes.map((complex) => ({
    code: complex.code,
    sido: complex.sido,
    sigungu: complex.sigungu
  })),
  coordinates,
  adminCenters: adminCenters.districts,
  thresholdKm: coordinateThresholdKm
});

const isPublishableCandidate = (complex: BasicComplex) => {
  const monthlyFees = fees.get(complex.code) ?? [];
  const latest = monthlyFees.at(-1);
  return monthlyFees.length >= 5 &&
    (managementAreas.get(complex.code) ?? 0) > 0 &&
    Number(latest?.totalFeePerM2 ?? 0) > 0 &&
    complex.households > 0 &&
    complex.address.length >= 5 &&
    complex.name.length >= 2;
};
const publishableCandidates = eligibleComplexes.filter(isPublishableCandidate);
const publishableCodes = new Set(
  [...publishableCandidates]
    .sort((a, b) => {
      const aFees = fees.get(a.code) ?? [];
      const bFees = fees.get(b.code) ?? [];
      return String(bFees.at(-1)?.month ?? '').localeCompare(String(aFees.at(-1)?.month ?? '')) ||
        bFees.length - aFees.length ||
        Number(coordinateValidation.validCoordinates.has(b.code)) - Number(coordinateValidation.validCoordinates.has(a.code)) ||
        b.households - a.households ||
        a.code.localeCompare(b.code);
    })
    .slice(0, maxPublishableComplexes)
    .map((complex) => complex.code)
);

const byRegion = new Map<string, Array<Record<string, unknown>>>();
const byDistrict = new Map<string, ApartmentSummary[]>();
const index: ApartmentSummary[] = [];
const currentApartments = new Map<string, CurrentApartmentSnapshot>();
let complexesWithArea = 0;
let complexesWithFees = 0;
let publishedFeeRows = 0;
let publishableComplexes = 0;
for (const complex of eligibleComplexes) {
  const area = managementAreas.get(complex.code) ?? 0;
  const monthlyFees = fees.get(complex.code) ?? [];
  const latest = monthlyFees.at(-1);
  if (area > 0) complexesWithArea += 1;
  if (monthlyFees.length) complexesWithFees += 1;
  publishedFeeRows += monthlyFees.length;
  const isPublishable = publishableCodes.has(complex.code);
  if (isPublishable) publishableComplexes += 1;
  const regionKey = keyForRegion(complex.sido) || 'unknown';
  const coordinate = coordinateValidation.validCoordinates.get(complex.code);
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
  const feeTuples = monthlyFees.map((fee) => [
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
  ]);
  const detail = {
    ...summary,
    p: complex.parking,
    e: complex.elevators,
    f: feeTuples
  };
  const fingerprint = apartmentFingerprint(detail);
  const previous = previousApartments.get(complex.code);
  const modifiedDate = previous?.fingerprint === fingerprint
    ? previous.modifiedDate
    : sourceModifiedDate;
  const indexedSummary: ApartmentSummary = {
    ...summary,
    md: modifiedDate,
    ...(coordinate ? { la: coordinate.latitude, lo: coordinate.longitude } : {})
  };
  currentApartments.set(complex.code, {
    code: complex.code,
    fingerprint,
    slug: summary.s,
    province: summary.sd,
    district: summary.sg,
    publishable: summary.q === 1,
    modifiedDate
  });
  index.push(indexedSummary);
  const districtKey = `${complex.sido}\u001f${complex.sigungu}`;
  byDistrict.set(districtKey, [...(byDistrict.get(districtKey) ?? []), indexedSummary]);
  const details = byRegion.get(regionKey) ?? [];
  details.push({
    ...detail,
    md: modifiedDate
  });
  byRegion.set(regionKey, details);
}

index.sort((a, b) => String(a.sd).localeCompare(String(b.sd), 'ko') || String(a.n).localeCompare(String(b.n), 'ko'));
await rm(outputDir, { recursive: true, force: true });
await mkdir(resolve(outputDir, 'regions'), { recursive: true });
await mkdir(resolve(outputDir, 'maps'), { recursive: true });
await writeFile(resolve(outputDir, 'index.json'), JSON.stringify(index));

const searchRecords = index.map((entry) => ({
  c: entry.c,
  s: entry.s,
  n: entry.n,
  sd: entry.sd,
  sg: entry.sg,
  d: entry.d,
  a: entry.a,
  h: entry.h,
  tf: entry.tf,
  cf: entry.cf,
  rf: entry.rf,
  q: entry.q,
  ...(entry.la !== undefined && entry.lo !== undefined ? { la: entry.la, lo: entry.lo } : {})
}));
await writeFile(resolve(outputDir, 'search.json'), JSON.stringify(searchRecords));

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

const districtManifest = [];
for (const [compositeKey, entries] of [...byDistrict].sort(([a], [b]) => a.localeCompare(b, 'ko'))) {
  const [province, rawDistrict] = compositeKey.split('\u001f');
  const label = rawDistrict || '세종시';
  const regionKey = keyForRegion(province) || 'unknown';
  const districtFileKey = keyForDistrict(rawDistrict);
  const directory = resolve(outputDir, 'maps', regionKey);
  await mkdir(directory, { recursive: true });
  entries.sort((a, b) => a.n.localeCompare(b.n, 'ko') || a.c.localeCompare(b.c));
  await writeFile(resolve(directory, `${districtFileKey}.json`), JSON.stringify(entries));

  const householdBands = emptyHouseholdBands();
  for (const entry of entries) householdBands[householdBand(entry.h)] += 1;
  districtManifest.push({
    key: `${regionKey}/${districtFileKey}`,
    province,
    district: rawDistrict,
    label,
    count: entries.length,
    withFees: entries.filter((entry) => Boolean(entry.lm)).length,
    withCoordinates: entries.filter((entry) => entry.la !== undefined && entry.lo !== undefined).length,
    householdBands,
    file: `/data/apartments/maps/${regionKey}/${districtFileKey}.json`
  });
}

const sortedMonths = [...months].sort();
const hasPreviousDataset = previousApartments.size > 0;
const changedApartments = hasPreviousDataset
  ? [...currentApartments.values()].filter((current) =>
      previousApartments.get(current.code)?.fingerprint !== current.fingerprint
    )
  : [];
const removedApartments = hasPreviousDataset
  ? [...previousApartments.entries()]
      .filter(([code]) => !currentApartments.has(code))
      .map(([code, previous]) => ({ code, ...previous }))
  : [];
const hasDatasetChanges = changedApartments.length > 0 || removedApartments.length > 0;
const generatedAt = hasDatasetChanges || !previousManifest?.generatedAt
  ? new Date().toISOString()
  : previousManifest.generatedAt;
const outputManifest = {
  version: 2,
  generatedAt,
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
    complexes: index.length,
    sourceComplexes: complexes.size,
    excludedInvalidRegionComplexes,
    complexesWithArea,
    complexesWithFees,
    duplicateComplexes,
    duplicateFeeRows,
    supersededFeeRows,
    feeSourceFiles: feeSourceFiles.length,
    areaConflicts,
    feeRowsWithoutArea,
    feeRowsWithoutComplex,
    invalidFeeMonths,
    publishedFeeRows,
    publishableCandidates: publishableCandidates.length,
    publishableLimit: maxPublishableComplexes,
    publishableComplexes,
    negativeAdjustmentValues,
    districtFiles: districtManifest.length
  },
  index: '/data/apartments/index.json',
  search: '/data/apartments/search.json',
  searchMeta: {
    file: '/data/apartments/search.json',
    count: searchRecords.length,
    withCoordinates: searchRecords.filter((entry) => entry.la !== undefined && entry.lo !== undefined).length,
    fields: ['c', 's', 'n', 'sd', 'sg', 'd', 'a', 'h', 'tf', 'cf', 'rf', 'q', 'la?', 'lo?']
  },
  regions: regionManifest,
  districts: districtManifest,
  coordinateValidation: coordinateValidation.stats,
  feeHistory: {
    discovery: configuredFeeFiles.length ? 'KAPT_FEE_FILES' : 'auto',
    files: feeSourceFiles.map((source) => ({
      sourceDate: source.sourceDate,
      fileName: source.fileName,
      path: relative(rootDir, source.path).replaceAll('\\', '/'),
      rows: source.rows
    }))
  }
};
await writeFile(resolve(outputDir, 'manifest.json'), `${JSON.stringify(outputManifest, null, 2)}\n`);

const changedUrls = new Set<string>();
const removedUrls = new Set<string>();
const affectedProvinces = new Set<string>();
const affectedDistricts = new Set<string>();
const regionPath = (province: string) =>
  `/apartments/regions/${encodeURIComponent(province)}/`;
const districtPath = (province: string, district: string) =>
  `/apartments/regions/${encodeURIComponent(province)}/${encodeURIComponent(district || '전체')}/`;
const apartmentPath = (slug: string) => `/apartments/${encodeURIComponent(slug)}/`;

if (hasPreviousDataset && hasDatasetChanges) {
  changedUrls.add('/');
  for (const current of changedApartments) {
    const previous = previousApartments.get(current.code);
    if (current.publishable) {
      changedUrls.add(apartmentPath(current.slug));
      affectedProvinces.add(current.province);
      affectedDistricts.add(`${current.province}\u001f${current.district}`);
    }
    if (previous?.publishable) {
      affectedProvinces.add(previous.province);
      affectedDistricts.add(`${previous.province}\u001f${previous.district}`);
      if (!current.publishable || previous.slug !== current.slug) {
        removedUrls.add(apartmentPath(previous.slug));
      }
    }
  }
  for (const previous of removedApartments) {
    if (!previous.publishable) continue;
    removedUrls.add(apartmentPath(previous.slug));
    affectedProvinces.add(previous.province);
    affectedDistricts.add(`${previous.province}\u001f${previous.district}`);
  }
  if (affectedProvinces.size || affectedDistricts.size) changedUrls.add('/apartments/');
  for (const province of affectedProvinces) changedUrls.add(regionPath(province));
  for (const composite of affectedDistricts) {
    const [province, district] = composite.split('\u001f');
    changedUrls.add(districtPath(province, district));
  }
}

const changeSet = {
  version: 1,
  generatedAt,
  sourceDate: rawManifest.sourceDate,
  baselineOnly: !hasPreviousDataset,
  urls: [...changedUrls].sort(),
  removedUrls: [...removedUrls].sort(),
  stats: {
    changedApartments: changedApartments.length,
    removedApartments: removedApartments.length,
    affectedDistricts: affectedDistricts.size,
    affectedProvinces: affectedProvinces.size
  }
};
await mkdir(dirname(indexNowChangeSetPath), { recursive: true });
const hasExistingChangeSet = await stat(indexNowChangeSetPath)
  .then((value) => value.isFile())
  .catch(() => false);
if (!hasExistingChangeSet || !hasPreviousDataset || hasDatasetChanges) {
  await writeFile(indexNowChangeSetPath, `${JSON.stringify(changeSet, null, 2)}\n`);
}

console.log(JSON.stringify(outputManifest.stats, null, 2));
console.log(JSON.stringify({ indexNow: changeSet.stats, submittedUrls: changeSet.urls.length, removedUrls: changeSet.removedUrls.length }, null, 2));
console.log(JSON.stringify({ coordinateValidation: outputManifest.coordinateValidation }, null, 2));
console.log(
  `전국 ${index.length.toLocaleString('ko-KR')}개 단지, 원본 ${feeRows.toLocaleString('ko-KR')}개/병합 ${publishedFeeRows.toLocaleString('ko-KR')}개 관리비 행 변환 완료` +
    (excludedInvalidRegionComplexes ? ` (지역 누락 ${excludedInvalidRegionComplexes.toLocaleString('ko-KR')}개 제외)` : '')
);
