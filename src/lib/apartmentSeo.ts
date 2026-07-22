import type { ApartmentEntry } from './apartmentBulk';
import adminCenters from '@/data/admin-centers.json';

export interface RegionalApartmentFee {
  apartment: ApartmentEntry;
  month: string;
  total: number;
  previousTotal: number | null;
  delta: number | null;
}

export interface RegionalFeeInsights {
  referenceMonth: string;
  latestAvailableMonth: string;
  coverageCount: number;
  excludedCount: number;
  medianFee: number;
  minFee: number;
  maxFee: number;
  rising: RegionalApartmentFee[];
  falling: RegionalApartmentFee[];
  low: RegionalApartmentFee[];
  high: RegionalApartmentFee[];
}

export const districtSegment = (district: string) => district || '전체';

const districtNameByKey = new Map(
  adminCenters.districts.map((item) => [
    `${item.province}|${item.district.replaceAll('시', '')}`,
    item.district
  ])
);

export const displayDistrictName = (province: string, district: string) => {
  if (!district) return province === '세종특별자치시' ? '세종시 전체' : '지역 전체';
  const official = districtNameByKey.get(`${province}|${district.replaceAll('시', '')}`) || district;
  return official.replace(/^(.+시)(.+구)$/, '$1 $2');
};

export const regionHubPath = (province: string) =>
  `/apartments/regions/${province}/`;

export const districtHubPath = (province: string, district: string) =>
  `/apartments/regions/${province}/${districtSegment(district)}/`;

export const median = (values: number[]) => {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

export const latestTotal = (apartment: ApartmentEntry) =>
  Number(apartment.f.at(-1)?.[1] ?? apartment.tf ?? 0);

export const apartmentMedian = (apartments: ApartmentEntry[]) =>
  median(apartments.map(latestTotal));

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

const previousMonth = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return '';
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * Selects the newest month whose coverage is at least 90% of the best-covered
 * month. This keeps partially released next-month data out of regional ranks.
 */
export const regionalFeeInsights = (
  apartments: ApartmentEntry[],
  itemLimit = 3
): RegionalFeeInsights => {
  const histories = apartments.map((apartment) => {
    const fees = new Map<string, number>();
    for (const fee of apartment.f) {
      const month = String(fee?.[0] ?? '');
      const total = Number(fee?.[1] ?? 0);
      if (monthPattern.test(month) && Number.isFinite(total) && total > 0) {
        fees.set(month, total);
      }
    }
    return { apartment, fees };
  });

  const monthCoverage = new Map<string, number>();
  for (const { fees } of histories) {
    for (const month of fees.keys()) {
      monthCoverage.set(month, (monthCoverage.get(month) ?? 0) + 1);
    }
  }

  const monthEntries = [...monthCoverage].sort(([a], [b]) => a.localeCompare(b));
  const latestAvailableMonth = monthEntries.at(-1)?.[0] ?? '';
  const maximumCoverage = Math.max(0, ...monthEntries.map(([, count]) => count));
  const minimumReferenceCoverage = Math.ceil(maximumCoverage * 0.9);
  const referenceMonth = monthEntries
    .filter(([, count]) => count >= minimumReferenceCoverage)
    .at(-1)?.[0] ?? latestAvailableMonth;
  const priorMonth = previousMonth(referenceMonth);

  const rows: RegionalApartmentFee[] = referenceMonth
    ? histories.flatMap(({ apartment, fees }) => {
        const total = fees.get(referenceMonth);
        if (!total) return [];
        const previousTotal = priorMonth ? fees.get(priorMonth) ?? null : null;
        return [{
          apartment,
          month: referenceMonth,
          total,
          previousTotal,
          delta: previousTotal === null ? null : total - previousTotal
        }];
      })
    : [];

  const medianFee = median(rows.map((row) => row.total));
  const applySummaryRange = rows.length >= 10 && medianFee > 0;
  const minimumSummaryFee = medianFee * 0.25;
  const maximumSummaryFee = medianFee * 4;
  const summaryRows = applySummaryRange
    ? rows.filter((row) => row.total >= minimumSummaryFee && row.total <= maximumSummaryFee)
    : rows;
  const rankingLimit = summaryRows.length >= 2
    ? Math.min(Math.max(1, itemLimit), Math.max(1, Math.floor(summaryRows.length / 2)))
    : 0;
  const byTotal = summaryRows.slice().sort((a, b) =>
    a.total - b.total || a.apartment.n.localeCompare(b.apartment.n, 'ko')
  );
  const comparable = summaryRows.filter((row) =>
    row.delta !== null &&
    row.previousTotal !== null &&
    (!applySummaryRange || (
      row.previousTotal >= minimumSummaryFee &&
      row.previousTotal <= maximumSummaryFee
    ))
  );

  return {
    referenceMonth,
    latestAvailableMonth,
    coverageCount: rows.length,
    excludedCount: rows.length - summaryRows.length,
    medianFee,
    minFee: byTotal.at(0)?.total ?? 0,
    maxFee: byTotal.at(-1)?.total ?? 0,
    rising: comparable
      .filter((row) => Number(row.delta) > 0)
      .sort((a, b) => Number(b.delta) - Number(a.delta) || b.total - a.total)
      .slice(0, itemLimit),
    falling: comparable
      .filter((row) => Number(row.delta) < 0)
      .sort((a, b) => Number(a.delta) - Number(b.delta) || a.total - b.total)
      .slice(0, itemLimit),
    low: byTotal.slice(0, rankingLimit),
    high: byTotal.slice(-rankingLimit).reverse()
  };
};
