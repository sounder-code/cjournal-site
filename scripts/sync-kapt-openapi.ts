import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type RawItem = Record<string, unknown>;

interface ComplexSeed {
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
  managedArea: number;
}

interface NormalizedFeeRow extends ComplexSeed {
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

interface ServiceDefinition {
  base: string;
  operations: Record<string, string>;
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(rootDir, process.env.KAPT_API_OUTPUT || 'tmp/kapt-openapi.normalized.json');
const progressPath = resolve(rootDir, 'tmp/kapt-openapi.progress.json');
const limit = Math.max(1, Number(process.env.KAPT_COMPLEX_LIMIT || '12'));
const monthCount = Math.max(1, Math.min(12, Number(process.env.KAPT_MONTHS || '6')));
const minHouseholds = Math.max(1, Number(process.env.KAPT_MIN_HOUSEHOLDS || '300'));
const targetSido = process.env.KAPT_TARGET_SIDO || '서울특별시';
const mergeExisting = process.env.KAPT_MERGE_EXISTING !== '0';
const requestDelay = Math.max(0, Number(process.env.KAPT_REQUEST_DELAY_MS || '80'));
const concurrency = Math.max(1, Math.min(8, Number(process.env.KAPT_CONCURRENCY || '5')));

const common: ServiceDefinition = {
  base: 'https://apis.data.go.kr/1613000/AptCmnuseManageCostServiceV2',
  operations: {
    generalManagementFee: 'getHsmpLaborCostInfoV2,getHsmpOfcrkCostInfoV2,getHsmpTaxdueInfoV2,getHsmpClothingCostInfoV2,getHsmpEduTraingCostInfoV2,getHsmpVhcleMntncCostInfoV2,getHsmpConsignManageFeeInfoV2,getHsmpEtcCostInfoV2',
    securityFee: 'getHsmpGuardCostInfoV2',
    cleaningFee: 'getHsmpCleaningCostInfoV2,getHsmpDisinfectionCostInfoV2',
    repairMaintenanceFee: 'getHsmpRepairsCostInfoV2,getHsmpFacilityMntncCostInfoV2,getHsmpSafetyCheckUpCostInfoV2,getHsmpDisasterPreventionCostInfoV2,getHsmpHomeNetworkMntncCostInfoV2',
    elevatorFee: 'getHsmpElevatorMntncCostInfoV2'
  }
};

const individual: ServiceDefinition = {
  base: 'https://apis.data.go.kr/1613000/AptIndvdlzManageCostServiceV2',
  operations: {
    electricityFee: 'getHsmpElectricityCostInfoV2',
    waterFee: 'getHsmpWaterCostInfoV2',
    heatingFee: 'getHsmpHeatCostInfoV2',
    hotWaterFee: 'getHsmpHotWaterCostInfoV2',
    otherIndividualFee: 'getHsmpGasRentalFeeInfoV2,getHsmpDomesticWasteFeeInfoV2,getHsmpMovingInRepresentationMtgInfoV2,getHsmpBuildingInsuranceFeeInfoV2,getHsmpElectionOrpnsInfoV2,getHsmpWaterPurifierTankFeeInfoV2'
  }
};

const reserve: ServiceDefinition = {
  base: 'https://apis.data.go.kr/1613000/AptRepairsCostServiceV2',
  operations: {
    reserveFee: 'getHsmpMonthFeeInfoV2'
  }
};

const sleep = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const readLocalKey = async () => {
  if (process.env.KAPT_SERVICE_KEY) return process.env.KAPT_SERVICE_KEY;
  try {
    const text = await readFile(resolve(rootDir, '.env.local'), 'utf8');
    const line = text.split(/\r?\n/).find((item) => item.trim().startsWith('KAPT_SERVICE_KEY='));
    return line?.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
  } catch {
    return undefined;
  }
};

const toNumber = (value: unknown) => {
  const number = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number : 0;
};

const monthOffset = (month: string, offset: number) => {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(4, 6)) - 1 + offset;
  const date = new Date(Date.UTC(year, monthIndex, 1));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const defaultLatestMonth = () => {
  const now = new Date();
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  return `${candidate.getUTCFullYear()}${String(candidate.getUTCMonth() + 1).padStart(2, '0')}`;
};

const buildMonths = () => {
  const latest = process.env.KAPT_TO_MONTH || defaultLatestMonth();
  if (!/^\d{6}$/.test(latest)) throw new Error('KAPT_TO_MONTH는 YYYYMM 형식이어야 합니다.');
  return Array.from({ length: monthCount }, (_, index) => monthOffset(latest, index - monthCount + 1));
};

const getItem = (json: any): RawItem | null => {
  const item = json?.response?.body?.item ?? json?.response?.body?.items?.item ?? json?.response?.body?.items;
  if (Array.isArray(item)) return item[0] ?? null;
  return item && typeof item === 'object' ? item : null;
};

const getItems = (json: any): RawItem[] => {
  const items = json?.response?.body?.items?.item ?? json?.response?.body?.items ?? json?.items ?? [];
  if (Array.isArray(items)) return items;
  return items && typeof items === 'object' ? [items] : [];
};

const fetchJson = async (base: string, operation: string, params: Record<string, string>, key: string) => {
  const url = new URL(`${base}/${operation}`);
  url.searchParams.set('serviceKey', key);
  url.searchParams.set('_type', 'json');
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (requestDelay) await sleep(requestDelay);
  if (!response.ok) throw new Error(`${operation}: HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trim().startsWith('{')) throw new Error(`${operation}: ${text.trim().slice(0, 80)}`);
  const json = JSON.parse(text);
  const code = json?.response?.header?.resultCode;
  if (code && code !== '00') throw new Error(`${operation}: ${code} ${json.response.header.resultMsg}`);
  return json;
};

const currencyTotal = (item: RawItem | null) => {
  if (!item) return 0;
  return Object.entries(item).reduce((total, [key, value]) => {
    if (/^(kapt|search|result|code|name)/i.test(key)) return total;
    if (typeof value !== 'number' && !/^[-\d,.]+$/.test(String(value ?? ''))) return total;
    return total + toNumber(value);
  }, 0);
};

const perSquareMeter = (amount: number, area: number) => area > 0 ? Math.round(amount / area) : 0;
const emptyMetrics = (): Record<string, number> => ({});

const operationEntries = (service: ServiceDefinition) =>
  Object.entries(service.operations).flatMap(([metric, value]) =>
    value.split(',').map((operation) => ({ metric, operation }))
  );

const mapLimit = async <T, R>(items: T[], worker: (item: T) => Promise<R>) => {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
};

const probeService = async (service: ServiceDefinition, key: string, code: string, month: string) => {
  const [{ operation }] = operationEntries(service);
  try {
    await fetchJson(service.base, operation, { kaptCode: code, searchDate: month }, key);
    return true;
  } catch (error) {
    console.warn(`[skip] ${new URL(service.base).pathname.split('/').at(-1)}: ${(error as Error).message}`);
    return false;
  }
};

const fetchServiceMetrics = async (
  service: ServiceDefinition,
  key: string,
  code: string,
  month: string,
  area: number
) => {
  const result: Record<string, number> = {};
  const values = await mapLimit(operationEntries(service), async ({ metric, operation }) => {
    try {
      const item = getItem(await fetchJson(service.base, operation, { kaptCode: code, searchDate: month }, key));
      return { metric, amount: currencyTotal(item) };
    } catch (error) {
      console.warn(`[warn] ${code} ${month} ${operation}: ${(error as Error).message}`);
      return { metric, amount: 0 };
    }
  });
  for (const { metric, amount } of values) {
    result[metric] = (result[metric] ?? 0) + amount;
  }
  for (const metric of Object.keys(result)) result[metric] = perSquareMeter(result[metric], area);
  return result;
};

const fetchSeeds = async (key: string) => {
  const list: RawItem[] = [];
  for (let pageNo = 1; pageNo <= 30; pageNo += 1) {
    const listJson = await fetchJson(
      'https://apis.data.go.kr/1613000/AptListService3',
      'getTotalAptList3',
      { pageNo: String(pageNo), numOfRows: '1000' },
      key
    );
    const pageItems = getItems(listJson);
    const regionalItems = pageItems.filter((item) => String(item.as1 ?? '').trim() === targetSido);
    list.push(...regionalItems);
    console.log(`[list ${pageNo}] ${regionalItems.length} ${targetSido} 단지`);
    if (pageItems.length < 1000 || (pageNo > 1 && regionalItems.length === 0)) break;
    if (regionalItems.length > 0 && String(pageItems.at(-1)?.as1 ?? '').trim() !== targetSido) break;
  }

  const byDistrict = new Map<string, RawItem[]>();
  for (const item of list) {
    const district = String(item.as2 ?? '지역 미확인').trim();
    const bucket = byDistrict.get(district) ?? [];
    bucket.push(item);
    byDistrict.set(district, bucket);
  }
  const candidateTarget = Math.min(list.length, Math.max(75, limit * 3));
  const candidates: RawItem[] = [];
  const districts = [...byDistrict.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
  for (let offset = 0; candidates.length < candidateTarget; offset += 1) {
    let added = 0;
    for (const district of districts) {
      const item = byDistrict.get(district)?.[offset];
      if (!item) continue;
      candidates.push(item);
      added += 1;
      if (candidates.length >= candidateTarget) break;
    }
    if (added === 0) break;
  }
  console.log(`[list] ${targetSido} ${list.length}개 중 ${candidates.length}개 기본정보 점검`);
  const inspected = await mapLimit(candidates, async (item): Promise<ComplexSeed | null> => {
    const code = String(item.kaptCode ?? '');
    if (!code) return null;
    try {
      const json = await fetchJson(
        'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4',
        'getAphusBassInfoV4',
        { kaptCode: code },
        key
      );
      const detail = getItem(json);
      const households = toNumber(detail?.kaptdaCnt ?? detail?.hoCnt);
      const managedArea = toNumber(detail?.kaptMarea ?? detail?.kaptTarea);
      if (!detail || households < minHouseholds || managedArea <= 0) return null;
      return {
        code,
        name: String(detail.kaptName ?? item.kaptName ?? '이름 미확인 단지').trim(),
        sido: String(item.as1 ?? '').trim(),
        sigungu: String(item.as2 ?? '').trim(),
        dong: String(item.as3 ?? '').trim(),
        address: String(detail.doroJuso ?? detail.kaptAddr ?? '').trim(),
        households,
        buildings: toNumber(detail.kaptDongCnt),
        approvalYear: Number(String(detail.kaptUsedate ?? '').slice(0, 4)) || new Date().getFullYear(),
        heatingType: String(detail.codeHeatNm ?? '미확인').trim(),
        managementType: String(detail.codeMgrNm ?? '미확인').trim(),
        managedArea
      };
    } catch (error) {
      console.warn(`[warn] basic ${code}: ${(error as Error).message}`);
      return null;
    }
  });
  const seeds = inspected.filter((item): item is ComplexSeed => Boolean(item)).slice(0, limit);
  seeds.forEach((seed, index) => console.log(`[seed ${index + 1}/${seeds.length}] ${seed.name}`));
  return seeds;
};

const main = async () => {
  const key = await readLocalKey();
  if (!key) throw new Error('KAPT_SERVICE_KEY가 .env.local 또는 환경변수에 필요합니다.');
  const months = buildMonths();
  const seeds = await fetchSeeds(key);
  if (!seeds.length) throw new Error('수집할 공동주택을 찾지 못했습니다.');

  const probe = seeds[0];
  const [commonEnabled, individualEnabled, reserveEnabled] = await Promise.all([
    probeService(common, key, probe.code, months.at(-1)!),
    probeService(individual, key, probe.code, months.at(-1)!),
    probeService(reserve, key, probe.code, months.at(-1)!)
  ]);
  const enabled = { common: commonEnabled, individual: individualEnabled, reserve: reserveEnabled };
  console.log(`[services] ${JSON.stringify(enabled)}`);

  let existingRows: NormalizedFeeRow[] = [];
  if (mergeExisting) {
    try {
      existingRows = JSON.parse(await readFile(outputPath, 'utf8'));
      console.log(`[merge] 기존 ${existingRows.length}개 월별 행 유지`);
    } catch {
      existingRows = [];
    }
  }
  const rows: NormalizedFeeRow[] = [];
  const mergedRows = () => {
    const byKey = new Map(existingRows.map((row) => [`${row.code}:${row.month}`, row]));
    for (const row of rows) byKey.set(`${row.code}:${row.month}`, row);
    return [...byKey.values()].sort((a, b) => a.code.localeCompare(b.code) || a.month.localeCompare(b.month));
  };
  for (const [index, seed] of seeds.entries()) {
    for (const month of months) {
      const [commonMetrics, individualMetrics, reserveMetrics] = await Promise.all([
        enabled.common ? fetchServiceMetrics(common, key, seed.code, month, seed.managedArea) : emptyMetrics(),
        enabled.individual ? fetchServiceMetrics(individual, key, seed.code, month, seed.managedArea) : emptyMetrics(),
        enabled.reserve ? fetchServiceMetrics(reserve, key, seed.code, month, seed.managedArea) : emptyMetrics()
      ]);
      const commonFeePerM2 = Object.values(commonMetrics).reduce<number>((sum, value) => sum + value, 0);
      const individualFeePerM2 = Object.values(individualMetrics).reduce<number>((sum, value) => sum + value, 0);
      const reserveFee = reserveMetrics.reserveFee ?? 0;
      if (commonFeePerM2 + individualFeePerM2 + reserveFee <= 0) {
        console.warn(`[skip] ${seed.name} ${month}: 공개된 관리비가 없습니다.`);
        continue;
      }
      rows.push({
        ...seed,
        month: `${month.slice(0, 4)}-${month.slice(4, 6)}`,
        totalFeePerM2: commonFeePerM2 + individualFeePerM2 + reserveFee,
        commonFeePerM2,
        individualFeePerM2,
        reserveFee,
        generalManagementFee: commonMetrics.generalManagementFee ?? 0,
        securityFee: commonMetrics.securityFee ?? 0,
        cleaningFee: commonMetrics.cleaningFee ?? 0,
        repairMaintenanceFee: commonMetrics.repairMaintenanceFee ?? 0,
        elevatorFee: commonMetrics.elevatorFee ?? 0,
        electricityFee: individualMetrics.electricityFee ?? 0,
        waterFee: individualMetrics.waterFee ?? 0,
        heatingFee: individualMetrics.heatingFee ?? 0,
        hotWaterFee: individualMetrics.hotWaterFee ?? 0
      });
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(mergedRows(), null, 2)}\n`);
    await writeFile(progressPath, `${JSON.stringify({ updatedAt: new Date().toISOString(), enabled, months, completed: index + 1, total: seeds.length }, null, 2)}\n`);
    console.log(`[complex ${index + 1}/${seeds.length}] ${seed.name}`);
  }

  console.log(`Saved ${mergedRows().length} merged rows (${rows.length} refreshed) for ${seeds.length} complexes -> ${outputPath}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
