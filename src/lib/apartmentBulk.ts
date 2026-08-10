import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface ApartmentManifest {
  generatedAt: string;
  sourceDate: string;
  latestMonth: string;
  months: string[];
  index: string;
  search?: string | {
    file: string;
    count: number;
    withCoordinates?: number;
    fields?: string[];
  };
  stats: Record<string, number>;
  regions: Array<{ key: string; name: string; count: number; withFees: number; file: string }>;
  districts?: Array<{
    province: string;
    district: string;
    count: number;
    withCoordinates?: number;
    file: string;
    householdBands?: Record<string, number>;
    bands?: Record<string, number>;
  }>;
}

export type FeeTuple = [
  month: string,
  total: number,
  common: number,
  individual: number,
  reserve: number,
  general: number,
  security: number,
  cleaning: number,
  maintenance: number,
  elevator: number,
  electricity: number,
  water: number,
  heating: number,
  hotWater: number
];

export interface ApartmentEntry {
  c: string;
  s: string;
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
  q?: number;
  la?: number;
  lo?: number;
  p: number;
  e: number;
  f: FeeTuple[];
}

export type ComparisonMetric = 'total' | 'common' | 'security' | 'cleaning' | 'maintenance' | 'heating' | 'reserve';

export interface ApartmentPageData {
  apartment: ApartmentEntry;
  indexable: boolean;
  comparisonEligible: boolean;
  qualityReasons: string[];
  titleSuffix: string;
  peerLabel: string;
  peerCount: number;
  peerRank: number;
  peerMedianTotal: number;
  percentiles: Record<ComparisonMetric, number>;
  nearby: Array<Pick<ApartmentEntry, 's' | 'n' | 'sg' | 'd' | 'h' | 'y' | 'tf' | 'ht' | 'la' | 'lo'>>;
}

export const APARTMENT_REPORT_UPDATED = '2026-08-07';

const manifestPath = resolve('public/data/apartments/manifest.json');
let manifestPromise: Promise<ApartmentManifest> | undefined;
let entriesPromise: Promise<ApartmentEntry[]> | undefined;
let pageDataPromise: Promise<ApartmentPageData[]> | undefined;

export const apartmentSlug = (name: string, code: string) =>
  `${name}-${code}`
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const householdBand = (households: number) => {
  if (households < 300) return '300세대 미만';
  if (households < 500) return '300~499세대';
  if (households < 1000) return '500~999세대';
  if (households < 1500) return '1,000~1,499세대';
  return '1,500세대 이상';
};

export const loadApartmentManifest = () => {
  manifestPromise ??= readFile(manifestPath, 'utf8').then((text) => JSON.parse(text) as ApartmentManifest);
  return manifestPromise;
};

export const loadApartmentEntries = () => {
  entriesPromise ??= (async () => {
    const manifest = await loadApartmentManifest();
    const [regions, searchEntries] = await Promise.all([
      Promise.all(
      manifest.regions.map(async (region) => {
        const path = resolve('public', region.file.replace(/^\//, ''));
        return JSON.parse(await readFile(path, 'utf8')) as ApartmentEntry[];
      })
      ),
      manifest.search
        ? readFile(resolve('public', (typeof manifest.search === 'string' ? manifest.search : manifest.search.file).replace(/^\//, '')), 'utf8')
          .then((text) => JSON.parse(text) as Array<Pick<ApartmentEntry, 'c' | 'la' | 'lo'>>)
        : Promise.resolve([])
    ]);
    const coordinates = new Map(searchEntries.map((entry) => [entry.c, { la: entry.la, lo: entry.lo }]));
    return regions.flat().map((entry) => {
      const coordinate = coordinates.get(entry.c);
      return coordinate ? { ...entry, ...coordinate } : entry;
    });
  })();
  return entriesPromise;
};

export const isPublishableApartment = (entry: ApartmentEntry) =>
  entry.q === 1 &&
  entry.f.length >= 5 &&
  entry.ma > 0 &&
  entry.tf > 0 &&
  entry.h > 0 &&
  entry.a.length >= 5 &&
  entry.n.length >= 2;

const latestFee = (entry: ApartmentEntry) => entry.f.at(-1);

export const apartmentQualityReasons = (entry: ApartmentEntry) => {
  const fee = latestFee(entry);
  if (!fee) return ['최근 관리비가 공개되지 않았습니다.'];

  const reasons: string[] = [];
  if (fee[1] < 500 || fee[1] > 10_000) {
    reasons.push('총 관리비 공개 단가가 일반적인 비교 범위를 크게 벗어납니다.');
  }
  if (fee[2] <= 0) {
    reasons.push('공용관리비 합계가 공개되지 않았습니다.');
  }
  if (fee.slice(5).filter((value) => Number(value) > 0).length < 4) {
    reasons.push('세부 관리비 항목의 공개 범위가 충분하지 않습니다.');
  }
  return reasons;
};

export const isComparableApartment = (entry: ApartmentEntry) =>
  isPublishableApartment(entry) && apartmentQualityReasons(entry).length === 0;

export const compareApartmentDiscoveryPriority = (left: ApartmentEntry, right: ApartmentEntry) =>
  String(right.f.at(-1)?.[0] ?? '').localeCompare(String(left.f.at(-1)?.[0] ?? '')) ||
  right.f.length - left.f.length ||
  right.h - left.h ||
  left.n.localeCompare(right.n, 'ko') ||
  left.c.localeCompare(right.c);

const metricIndexes: Record<ComparisonMetric, number> = {
  total: 1,
  common: 2,
  reserve: 4,
  security: 6,
  cleaning: 7,
  maintenance: 8,
  heating: 12
};

const percentile = (sorted: number[], value: number) => {
  if (!value || sorted.length < 2) return 50;
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sorted[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return Math.max(1, Math.min(99, Math.round((low / sorted.length) * 100)));
};

export const loadApartmentPageData = () => {
  pageDataPromise ??= (async () => {
    const entries = (await loadApartmentEntries()).filter(isPublishableApartment);
    const comparisonEntries = entries.filter(isComparableApartment);
    const districtGroups = new Map<string, ApartmentEntry[]>();
    const peerGroups = new Map<string, ApartmentEntry[]>();
    const provinceGroups = new Map<string, ApartmentEntry[]>();
    const provinceBandGroups = new Map<string, ApartmentEntry[]>();
    const titleCounts = new Map<string, number>();

    for (const entry of comparisonEntries) {
      const districtKey = `${entry.sd}|${entry.sg}`;
      const peerKey = `${districtKey}|${householdBand(entry.h)}`;
      districtGroups.set(districtKey, [...(districtGroups.get(districtKey) ?? []), entry]);
      peerGroups.set(peerKey, [...(peerGroups.get(peerKey) ?? []), entry]);
      provinceGroups.set(entry.sd, [...(provinceGroups.get(entry.sd) ?? []), entry]);
      const provinceBandKey = `${entry.sd}|${householdBand(entry.h)}`;
      provinceBandGroups.set(provinceBandKey, [...(provinceBandGroups.get(provinceBandKey) ?? []), entry]);
    }

    for (const entry of entries) {
      const titleKey = `${entry.n}|${entry.sg}|${entry.d}`;
      titleCounts.set(titleKey, (titleCounts.get(titleKey) ?? 0) + 1);
    }

    const districtLabel = (entry: ApartmentEntry) =>
      entry.sg || (entry.sd === '세종특별자치시' ? '세종시' : entry.sd);

    const selectPeers = (entry: ApartmentEntry) => {
      const districtKey = `${entry.sd}|${entry.sg}`;
      const direct = peerGroups.get(`${districtKey}|${householdBand(entry.h)}`) ?? [];
      const district = districtGroups.get(districtKey) ?? direct;
      const provinceBand = provinceBandGroups.get(`${entry.sd}|${householdBand(entry.h)}`) ?? [];
      if (direct.length >= 10) return { peers: direct, label: `${districtLabel(entry)} · ${householdBand(entry.h)}` };
      if (district.length >= 2) return { peers: district, label: `${districtLabel(entry)} 전체` };
      if (provinceBand.length >= 2) return { peers: provinceBand, label: `${entry.sd} · ${householdBand(entry.h)}` };
      return { peers: provinceGroups.get(entry.sd) ?? district, label: `${entry.sd} 전체` };
    };

    const sortedMetrics = new Map<string, Record<ComparisonMetric, number[]>>();
    return entries.map((apartment) => {
      const districtKey = `${apartment.sd}|${apartment.sg}`;
      const peerKey = `${districtKey}|${householdBand(apartment.h)}`;
      const selected = selectPeers(apartment);
      const peers = selected.peers;
      if (!sortedMetrics.has(peerKey)) {
        sortedMetrics.set(
          peerKey,
          Object.fromEntries(
            Object.entries(metricIndexes).map(([metric, index]) => [
              metric,
              peers
                .map((item) => Number(item.f.at(-1)?.[index] ?? 0))
                .filter((value) => value > 0)
                .sort((a, b) => a - b)
            ])
          ) as Record<ComparisonMetric, number[]>
        );
      }
      const values = sortedMetrics.get(peerKey)!;
      const latest = apartment.f.at(-1)!;
      const totalValues = values.total;
      const peerRank = totalValues.findIndex((value) => value >= latest[1]) + 1;
      const medianIndex = Math.floor(totalValues.length / 2);
      const peerMedianTotal = totalValues.length % 2
        ? totalValues[medianIndex]
        : Math.round((totalValues[medianIndex - 1] + totalValues[medianIndex]) / 2);
      const percentiles = Object.fromEntries(
        Object.entries(metricIndexes).map(([metric, index]) => [
          metric,
          percentile(values[metric as ComparisonMetric], Number(latest[index] ?? 0))
        ])
      ) as Record<ComparisonMetric, number>;
      const nearby = peers
        .filter((item) => item.c !== apartment.c)
        .sort((a, b) => Math.abs(a.h - apartment.h) - Math.abs(b.h - apartment.h) || a.n.localeCompare(b.n, 'ko'))
        .slice(0, 8)
        .map(({ s, n, sg, d, h, y, tf, ht, la, lo }) => ({ s, n, sg, d, h, y, tf, ht, la, lo }));
      const qualityReasons = apartmentQualityReasons(apartment);
      const comparisonEligible = qualityReasons.length === 0;
      const indexable = comparisonEligible &&
        apartment.f.length >= 6 &&
        apartment.h >= 500 &&
        peers.length >= 10 &&
        nearby.length >= 8;
      const locationLabel = [districtLabel(apartment), apartment.d].filter(Boolean).join(' ');

      return {
        apartment,
        indexable,
        comparisonEligible,
        qualityReasons,
        titleSuffix: titleCounts.get(`${apartment.n}|${apartment.sg}|${apartment.d}`)! > 1
          ? `${locationLabel} ${apartment.c}`
          : locationLabel,
        peerLabel: selected.label,
        peerCount: peers.length,
        peerRank: peerRank || peers.length,
        peerMedianTotal,
        percentiles,
        nearby
      };
    });
  })();
  return pageDataPromise;
};
