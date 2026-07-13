import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface ApartmentManifest {
  generatedAt: string;
  sourceDate: string;
  latestMonth: string;
  months: string[];
  stats: Record<string, number>;
  regions: Array<{ key: string; name: string; count: number; withFees: number; file: string }>;
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
  p: number;
  e: number;
  f: FeeTuple[];
}

export type ComparisonMetric = 'total' | 'common' | 'security' | 'cleaning' | 'maintenance' | 'heating' | 'reserve';

export interface ApartmentPageData {
  apartment: ApartmentEntry;
  titleSuffix: string;
  peerLabel: string;
  peerCount: number;
  percentiles: Record<ComparisonMetric, number>;
  nearby: Array<Pick<ApartmentEntry, 's' | 'n' | 'sg' | 'd' | 'h' | 'y' | 'tf' | 'ht'>>;
}

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
    const regions = await Promise.all(
      manifest.regions.map(async (region) => {
        const path = resolve('public', region.file.replace(/^\//, ''));
        return JSON.parse(await readFile(path, 'utf8')) as ApartmentEntry[];
      })
    );
    return regions.flat();
  })();
  return entriesPromise;
};

export const isPublishableApartment = (entry: ApartmentEntry) =>
  entry.f.length >= 4 &&
  entry.ma > 0 &&
  entry.tf > 0 &&
  entry.h > 0 &&
  entry.a.length >= 5 &&
  entry.n.length >= 2;

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
    const districtGroups = new Map<string, ApartmentEntry[]>();
    const peerGroups = new Map<string, ApartmentEntry[]>();
    const provinceGroups = new Map<string, ApartmentEntry[]>();
    const provinceBandGroups = new Map<string, ApartmentEntry[]>();
    const titleCounts = new Map<string, number>();

    for (const entry of entries) {
      const districtKey = `${entry.sd}|${entry.sg}`;
      const peerKey = `${districtKey}|${householdBand(entry.h)}`;
      districtGroups.set(districtKey, [...(districtGroups.get(districtKey) ?? []), entry]);
      peerGroups.set(peerKey, [...(peerGroups.get(peerKey) ?? []), entry]);
      provinceGroups.set(entry.sd, [...(provinceGroups.get(entry.sd) ?? []), entry]);
      const provinceBandKey = `${entry.sd}|${householdBand(entry.h)}`;
      provinceBandGroups.set(provinceBandKey, [...(provinceBandGroups.get(provinceBandKey) ?? []), entry]);
      const titleKey = `${entry.n}|${entry.sg}|${entry.d}`;
      titleCounts.set(titleKey, (titleCounts.get(titleKey) ?? 0) + 1);
    }

    const selectPeers = (entry: ApartmentEntry) => {
      const districtKey = `${entry.sd}|${entry.sg}`;
      const direct = peerGroups.get(`${districtKey}|${householdBand(entry.h)}`) ?? [];
      const district = districtGroups.get(districtKey) ?? direct;
      const provinceBand = provinceBandGroups.get(`${entry.sd}|${householdBand(entry.h)}`) ?? [];
      if (direct.length >= 10) return { peers: direct, label: `${entry.sg} · ${householdBand(entry.h)}` };
      if (district.length >= 2) return { peers: district, label: `${entry.sg} 전체` };
      if (provinceBand.length >= 2) return { peers: provinceBand, label: `${entry.sd} · ${householdBand(entry.h)}` };
      return { peers: provinceGroups.get(entry.sd) ?? district, label: `${entry.sd} 전체` };
    };

    const sortedMetrics = new Map<string, Record<ComparisonMetric, number[]>>();
    for (const [key, group] of peerGroups) {
      const sample = group[0];
      const effectiveGroup = selectPeers(sample).peers;
      sortedMetrics.set(
        key,
        Object.fromEntries(
          Object.entries(metricIndexes).map(([metric, index]) => [
            metric,
            effectiveGroup
              .map((item) => Number(item.f.at(-1)?.[index] ?? 0))
              .filter((value) => value > 0)
              .sort((a, b) => a - b)
          ])
        ) as Record<ComparisonMetric, number[]>
      );
    }

    return entries.map((apartment) => {
      const districtKey = `${apartment.sd}|${apartment.sg}`;
      const peerKey = `${districtKey}|${householdBand(apartment.h)}`;
      const selected = selectPeers(apartment);
      const peers = selected.peers;
      const values = sortedMetrics.get(peerKey)!;
      const latest = apartment.f.at(-1)!;
      const percentiles = Object.fromEntries(
        Object.entries(metricIndexes).map(([metric, index]) => [
          metric,
          percentile(values[metric as ComparisonMetric], Number(latest[index] ?? 0))
        ])
      ) as Record<ComparisonMetric, number>;
      const nearby = peers
        .filter((item) => item.c !== apartment.c)
        .sort((a, b) => Math.abs(a.h - apartment.h) - Math.abs(b.h - apartment.h) || a.n.localeCompare(b.n, 'ko'))
        .slice(0, 6)
        .map(({ s, n, sg, d, h, y, tf, ht }) => ({ s, n, sg, d, h, y, tf, ht }));

      return {
        apartment,
        titleSuffix: titleCounts.get(`${apartment.n}|${apartment.sg}|${apartment.d}`)! > 1
          ? `${apartment.sg} ${apartment.d} ${apartment.c}`
          : `${apartment.sg} ${apartment.d}`,
        peerLabel: selected.label,
        peerCount: peers.length,
        percentiles,
        nearby
      };
    });
  })();
  return pageDataPromise;
};
