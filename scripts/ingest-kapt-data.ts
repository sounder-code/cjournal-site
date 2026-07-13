import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type MetricKey =
  | 'totalFeePerM2'
  | 'commonFeePerM2'
  | 'securityFee'
  | 'cleaningFee'
  | 'repairMaintenanceFee'
  | 'heatingFee'
  | 'reserveFee';

interface RawRow {
  [key: string]: string | number | null | undefined;
}

interface NormalizedRow {
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
  month: string;
  totalFeePerM2: number;
  commonFeePerM2: number;
  individualFeePerM2: number;
  reserveFee: number;
  generalManagementFee: number;
  securityFee: number;
  cleaningFee: number;
  repairMaintenanceFee: number;
  elevatorFee: number;
  electricityFee: number;
  waterFee: number;
  heatingFee: number;
  hotWaterFee: number;
}

interface Coordinate {
  latitude: number;
  longitude: number;
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(rootDir, 'src/data/apartments.generated.ts');
const coordinatePath = resolve(rootDir, 'src/data/apartment-coordinates.json');
const sourceFile = process.env.KAPT_SOURCE_FILE;
const apiUrl = process.env.KAPT_API_URL;
const apiKey = process.env.KAPT_SERVICE_KEY;
const limit = Number(process.env.KAPT_LIMIT || '0');
const failOnEmpty = process.env.KAPT_FAIL_ON_EMPTY !== '0';

const keyAliases = {
  code: ['kaptCode', 'kapt_code', '단지코드', '코드', 'code'],
  name: ['kaptName', 'kapt_name', '단지명', '아파트명', 'name'],
  sido: ['sido', '시도', '광역시도', '법정동시도명'],
  sigungu: ['sigungu', '시군구', '시군구명', '법정동시군구명'],
  dong: ['dong', '읍면동', '동', '법정동읍면동명'],
  address: ['address', '도로명주소', '주소', 'kaptAddr', 'kapt_addr'],
  households: ['households', '세대수', 'kaptdaCnt', '세대수(세대)'],
  buildings: ['buildings', '동수', 'kaptDongCnt'],
  approvalYear: ['approvalYear', '사용승인년도', '사용승인일', 'kaptUsedate'],
  heatingType: ['heatingType', '난방방식', 'codeHeatNm'],
  managementType: ['managementType', '관리방식', 'codeMgrNm'],
  month: ['month', '발생월', '기준월', 'searchDate', '관리비부과년월'],
  totalFeePerM2: ['totalFeePerM2', '총관리비_m2', '총관리비㎡당', 'sumC', '합계'],
  commonFeePerM2: ['commonFeePerM2', '공용관리비_m2', '공용관리비㎡당', 'commC'],
  individualFeePerM2: ['individualFeePerM2', '개별사용료_m2', '개별사용료㎡당', 'indvC'],
  reserveFee: ['reserveFee', '장기수선충당금_m2', '장기수선충당금㎡당', 'reserveC'],
  generalManagementFee: ['generalManagementFee', '일반관리비_m2', '일반관리비㎡당'],
  securityFee: ['securityFee', '경비비_m2', '경비비㎡당'],
  cleaningFee: ['cleaningFee', '청소비_m2', '청소비㎡당'],
  repairMaintenanceFee: ['repairMaintenanceFee', '수선유지비_m2', '수선유지비㎡당'],
  elevatorFee: ['elevatorFee', '승강기유지비_m2', '승강기유지비㎡당'],
  electricityFee: ['electricityFee', '전기료_m2', '전기료㎡당'],
  waterFee: ['waterFee', '수도료_m2', '수도료㎡당'],
  heatingFee: ['heatingFee', '난방비_m2', '난방비㎡당'],
  hotWaterFee: ['hotWaterFee', '급탕비_m2', '급탕비㎡당']
} as const;

const metricKeys: MetricKey[] = [
  'totalFeePerM2',
  'commonFeePerM2',
  'securityFee',
  'cleaningFee',
  'repairMaintenanceFee',
  'heatingFee',
  'reserveFee'
];

const metricLabels: Record<MetricKey, string> = {
  totalFeePerM2: '총 관리비',
  commonFeePerM2: '공용관리비',
  securityFee: '경비비',
  cleaningFee: '청소비',
  repairMaintenanceFee: '수선유지비',
  heatingFee: '난방비',
  reserveFee: '장기수선충당금'
};

const pick = (row: RawRow, aliases: readonly string[]) => {
  for (const key of aliases) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
};

const toNumber = (value: unknown) => {
  const normalized = String(value ?? '').replace(/[^\d.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
};

const toText = (value: unknown, fallback = '') => String(value ?? fallback).trim() || fallback;

const toMonth = (value: unknown) => {
  const raw = String(value ?? '').replace(/[^\d]/g, '');
  if (raw.length >= 6) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}`;
  return new Date().toISOString().slice(0, 7);
};

const toApprovalYear = (value: unknown) => {
  const raw = String(value ?? '').replace(/[^\d]/g, '');
  const year = Number(raw.slice(0, 4));
  return Number.isFinite(year) && year > 1900 ? year : new Date().getFullYear();
};

const slugify = (code: string, name: string) => {
  const base = `${name}-${code}`
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `apartment-${code}`;
};

const parseCsv = (text: string): RawRow[] => {
  const rows: string[][] = [];
  let cell = '';
  let current: string[] = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      current.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      current.push(cell);
      if (current.some((item) => item.trim())) rows.push(current);
      current = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  current.push(cell);
  if (current.some((item) => item.trim())) rows.push(current);

  const [headers = [], ...body] = rows;
  return body.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), row[index]?.trim() ?? '']))
  );
};

const readRows = async (): Promise<RawRow[]> => {
  if (sourceFile) {
    const absolute = resolve(rootDir, sourceFile);
    const text = await readFile(absolute, 'utf8');
    if (absolute.endsWith('.json')) {
      const json = JSON.parse(text);
      if (Array.isArray(json)) return json;
      if (Array.isArray(json.items)) return json.items;
      if (Array.isArray(json.response?.body?.items?.item)) return json.response.body.items.item;
      throw new Error('JSON에서 row 배열을 찾지 못했습니다.');
    }
    return parseCsv(text);
  }

  if (apiUrl && apiKey) {
    const url = new URL(apiUrl);
    url.searchParams.set('serviceKey', apiKey);
    url.searchParams.set('_type', 'json');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`K-apt API 요청 실패: ${response.status} ${response.statusText}`);
    const json = await response.json();
    const items = json.response?.body?.items?.item ?? json.items ?? json;
    return Array.isArray(items) ? items : [items];
  }

  throw new Error('KAPT_SOURCE_FILE 또는 KAPT_API_URL/KAPT_SERVICE_KEY가 필요합니다.');
};

const normalizeRow = (row: RawRow): NormalizedRow => {
  const code = toText(pick(row, keyAliases.code), toText(pick(row, keyAliases.name)));
  const commonFeePerM2 = toNumber(pick(row, keyAliases.commonFeePerM2));
  const individualFeePerM2 = toNumber(pick(row, keyAliases.individualFeePerM2));
  const reserveFee = toNumber(pick(row, keyAliases.reserveFee));
  const total = toNumber(pick(row, keyAliases.totalFeePerM2)) || commonFeePerM2 + individualFeePerM2 + reserveFee;

  return {
    code,
    name: toText(pick(row, keyAliases.name), '이름 미확인 단지'),
    sido: toText(pick(row, keyAliases.sido), '지역 미확인'),
    sigungu: toText(pick(row, keyAliases.sigungu), '시군구 미확인'),
    dong: toText(pick(row, keyAliases.dong), '동 미확인'),
    address: toText(pick(row, keyAliases.address), '주소 미확인'),
    households: toNumber(pick(row, keyAliases.households)),
    buildings: toNumber(pick(row, keyAliases.buildings)),
    approvalYear: toApprovalYear(pick(row, keyAliases.approvalYear)),
    heatingType: toText(pick(row, keyAliases.heatingType), '난방방식 미확인'),
    managementType: toText(pick(row, keyAliases.managementType), '관리방식 미확인'),
    month: toMonth(pick(row, keyAliases.month)),
    totalFeePerM2: total,
    commonFeePerM2,
    individualFeePerM2,
    reserveFee,
    generalManagementFee: toNumber(pick(row, keyAliases.generalManagementFee)),
    securityFee: toNumber(pick(row, keyAliases.securityFee)),
    cleaningFee: toNumber(pick(row, keyAliases.cleaningFee)),
    repairMaintenanceFee: toNumber(pick(row, keyAliases.repairMaintenanceFee)),
    elevatorFee: toNumber(pick(row, keyAliases.elevatorFee)),
    electricityFee: toNumber(pick(row, keyAliases.electricityFee)),
    waterFee: toNumber(pick(row, keyAliases.waterFee)),
    heatingFee: toNumber(pick(row, keyAliases.heatingFee)),
    hotWaterFee: toNumber(pick(row, keyAliases.hotWaterFee))
  };
};

const householdBand = (households: number) => {
  if (households < 300) return '300세대 미만';
  if (households < 500) return '300~499세대';
  if (households < 1000) return '500~999세대';
  if (households < 1500) return '1000~1499세대';
  return '1500세대 이상';
};

const ageBand = (approvalYear: number) => {
  const age = new Date().getFullYear() - approvalYear;
  if (age <= 5) return '0~5년차';
  if (age <= 10) return '6~10년차';
  if (age <= 20) return '11~20년차';
  if (age <= 30) return '21~30년차';
  return '31년차 이상';
};

const percentile = (values: number[], value: number) => {
  const filtered = values.filter((item) => Number.isFinite(item) && item > 0).sort((a, b) => a - b);
  if (filtered.length <= 1 || value <= 0) return 50;
  const lowerOrEqual = filtered.filter((item) => item <= value).length;
  return Math.max(1, Math.min(99, Math.round((lowerOrEqual / filtered.length) * 100)));
};

const emptyMetricBuckets = (): Record<MetricKey, number[]> => ({
  totalFeePerM2: [],
  commonFeePerM2: [],
  securityFee: [],
  cleaningFee: [],
  repairMaintenanceFee: [],
  heatingFee: [],
  reserveFee: []
});

const buildComplexes = (rows: NormalizedRow[], coordinates: Record<string, Coordinate>) => {
  const byCode = new Map<string, NormalizedRow[]>();
  for (const row of rows) {
    if (!row.code || !row.name || !row.month) continue;
    const bucket = byCode.get(row.code) ?? [];
    bucket.push(row);
    byCode.set(row.code, bucket);
  }

  const latestRows = [...byCode.values()].map((items) => items.slice().sort((a, b) => a.month.localeCompare(b.month)).at(-1)!);

  const comparisonPool = (row: NormalizedRow) => {
    const levels = [
      {
        label: `${row.sido} ${row.sigungu} · ${householdBand(row.households)} · ${row.heatingType} · ${ageBand(row.approvalYear)}`,
        rows: latestRows.filter((item) =>
          item.sigungu === row.sigungu &&
          householdBand(item.households) === householdBand(row.households) &&
          item.heatingType === row.heatingType &&
          ageBand(item.approvalYear) === ageBand(row.approvalYear)
        )
      },
      {
        label: `${row.sido} ${row.sigungu} · ${row.heatingType}`,
        rows: latestRows.filter((item) => item.sigungu === row.sigungu && item.heatingType === row.heatingType)
      },
      {
        label: `${row.sido} ${row.sigungu} 전체`,
        rows: latestRows.filter((item) => item.sigungu === row.sigungu)
      },
      {
        label: `${row.sido} 전체`,
        rows: latestRows.filter((item) => item.sido === row.sido)
      }
    ];
    return levels.find((level) => level.rows.length >= 5) ?? levels.at(-1)!;
  };

  return [...byCode.entries()].map(([code, items], _index, all) => {
    const sorted = items.slice().sort((a, b) => a.month.localeCompare(b.month));
    const latest = sorted.at(-1)!;
    const pool = comparisonPool(latest);
    const peerGroup = `${pool.label} (${pool.rows.length}개 단지)`;
    const values = emptyMetricBuckets();
    for (const row of pool.rows) {
      for (const key of metricKeys) values[key].push(row[key]);
    }
    const percentileByMetric = Object.fromEntries(
      metricKeys.map((key) => [key, percentile(values[key], latest[key])])
    ) as Record<MetricKey, number>;
    const topMetric = metricKeys
      .map((key) => ({ key, value: percentileByMetric[key] }))
      .filter(({ key }) => latest[key] > 0)
      .sort((a, b) => b.value - a.value)[0];
    const selectedTopMetric = topMetric ?? { key: 'totalFeePerM2' as MetricKey, value: percentileByMetric.totalFeePerM2 };
    const topLabel = metricLabels[selectedTopMetric.key];
    const levelText = selectedTopMetric.value >= 85 ? '매우 높은 편' : selectedTopMetric.value >= 65 ? '높은 편' : '평균 범위';
    const nearbySlugs = all
      .map(([otherCode, otherRows]) => ({ code: otherCode, row: otherRows.at(-1)! }))
      .filter((item) => item.code !== code && item.row.sigungu === latest.sigungu)
      .slice(0, 3)
      .map((item) => slugify(item.code, item.row.name));

    return {
      slug: slugify(code, latest.name),
      name: latest.name,
      sido: latest.sido,
      sigungu: latest.sigungu,
      dong: latest.dong,
      address: latest.address,
      households: latest.households,
      buildings: latest.buildings,
      approvalYear: latest.approvalYear,
      heatingType: latest.heatingType,
      managementType: latest.managementType,
      latitude: coordinates[code]?.latitude,
      longitude: coordinates[code]?.longitude,
      peerGroup,
      percentileByMetric,
      headline: `${topLabel}가 비교군에서 ${levelText}`,
      summary: `${peerGroup} 기준으로 최근 관리비 항목을 비교했습니다.`,
      insights: [
        {
          metric: selectedTopMetric.key,
          percentile: selectedTopMetric.value,
          title: `${topLabel} ${levelText}`,
          body: `공개자료 기준 ${pool.rows.length}개 단지에서의 상대적 위치입니다. 월별 추세와 단지 규모를 함께 확인하세요.`
        }
      ],
      monthlyFees: sorted.slice(-12).map((row) => ({
        month: row.month,
        totalFeePerM2: row.totalFeePerM2,
        commonFeePerM2: row.commonFeePerM2,
        individualFeePerM2: row.individualFeePerM2,
        reserveFee: row.reserveFee,
        generalManagementFee: row.generalManagementFee,
        securityFee: row.securityFee,
        cleaningFee: row.cleaningFee,
        repairMaintenanceFee: row.repairMaintenanceFee,
        elevatorFee: row.elevatorFee,
        electricityFee: row.electricityFee,
        waterFee: row.waterFee,
        heatingFee: row.heatingFee,
        hotWaterFee: row.hotWaterFee
      })),
      nearbySlugs
    };
  });
};

const main = async () => {
  const rawRows = await readRows();
  const coordinates = JSON.parse(await readFile(coordinatePath, 'utf8')) as Record<string, Coordinate>;
  const normalized = rawRows.map(normalizeRow).filter((row) => row.code && row.name);
  const limited = limit > 0 ? normalized.slice(0, limit) : normalized;
  const complexes = buildComplexes(limited, coordinates);
  if (failOnEmpty && complexes.length === 0) {
    throw new Error('생성된 단지가 0개입니다. 원천 필드명 또는 API 응답 구조를 확인하세요.');
  }
  const source = sourceFile ? `file:${sourceFile}` : `api:${apiUrl}`;
  const generatedAt = new Date().toISOString();
  const body = `import type { ApartmentComplex } from './apartments';

export const generatedAt = ${JSON.stringify(generatedAt)};
export const generatedSource = ${JSON.stringify(source)};
export const generatedApartmentComplexes = ${JSON.stringify(complexes, null, 2)} satisfies ApartmentComplex[];
`;

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, body);
  console.log(`Generated ${complexes.length} apartment complexes -> ${outputPath}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
